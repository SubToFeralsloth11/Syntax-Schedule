const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const tasksPath = path.join(__dirname, 'tasks.json');
const settingsPath = path.join(__dirname, 'settings.json');
const historyPath = path.join(__dirname, 'history.json');

let mainWindow;
let tray;
let isQuitting = false;

const defaultSettings = {
  theme: 'system',
  accentColor: '#4f46e5',
  fontSize: 15,
  autoNotify: true,
  notificationSound: true,
  autoStart: false,
  defaultEarlyWarning: 'none',
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00'
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.ico'),
    show: false,
    titleBarStyle: 'default',
    autoHideMenuBar: true
  });

  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'New Task',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate-to', 'add');
        }
      }
    },
    {
      label: 'Snooze All (10 min)',
      click: () => {
        let tasks = readTasks();
        const snoozeTime = new Date(Date.now() + 10 * 60 * 1000);
        tasks.forEach(t => { if (!t.completed) t.snoozeUntil = snoozeTime.toISOString(); });
        writeTasks(tasks);
        broadcast('tasks-updated', tasks);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Syntax Schedule');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// File helpers
function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing', filePath, err);
  }
}

function readTasks() { return readJson(tasksPath, []); }
function writeTasks(tasks) { writeJson(tasksPath, tasks); }
function readSettings() { return { ...defaultSettings, ...readJson(settingsPath, {}) }; }
function writeSettings(settings) { writeJson(settingsPath, settings); }
function readHistory() { return readJson(historyPath, []); }
function writeHistory(history) { writeJson(historyPath, history); }

function broadcast(type, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(type, data);
  }
}

// Notification helper
function sendNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      icon: path.join(__dirname, 'icon.ico')
    }).show();
  }
}

function isQuietHours(settings) {
  if (!settings.quietHoursEnabled) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = (settings.quietHoursStart || '23:00').split(':').map(Number);
  const [endH, endM] = (settings.quietHoursEnd || '07:00').split(':').map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function logNotification(taskId, taskTitle, type, message) {
  const history = readHistory();
  history.unshift({
    id: Date.now().toString(),
    taskId,
    taskTitle,
    type,
    message,
    time: new Date().toISOString()
  });
  if (history.length > 100) history.pop();
  writeHistory(history);
  broadcast('history-updated', history);
}

// Early warning parser
function parseEarlyWarning(value) {
  switch (value) {
    case '15-min': return 15 * 60 * 1000;
    case '1-hour': return 60 * 60 * 1000;
    case '1-day': return 24 * 60 * 60 * 1000;
    case '1-week': return 7 * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

// IPC handlers
ipcMain.handle('get-tasks', () => readTasks());

ipcMain.handle('add-task', (event, task) => {
  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  broadcast('tasks-updated', tasks);
  return tasks;
});

ipcMain.handle('delete-task', (event, id) => {
  let tasks = readTasks().filter(t => t.id !== id);
  writeTasks(tasks);
  broadcast('tasks-updated', tasks);
  return tasks;
});

ipcMain.handle('update-task', (event, updatedTask) => {
  let tasks = readTasks();
  const index = tasks.findIndex(t => t.id === updatedTask.id);
  if (index !== -1) {
    tasks[index] = updatedTask;
    writeTasks(tasks);
    broadcast('tasks-updated', tasks);
  }
  return tasks;
});

ipcMain.handle('send-notification', (event, task) => {
  sendNotification(task.title, task.description || 'Your task is due!');
  logNotification(task.id, task.title, 'manual', 'Manual notification triggered');
  return true;
});

ipcMain.handle('snooze-task', (event, id, minutes) => {
  let tasks = readTasks();
  const task = tasks.find(t => t.id === id);
  if (task) {
    const snoozeTime = new Date(Date.now() + minutes * 60 * 1000);
    task.snoozeUntil = snoozeTime.toISOString();
    writeTasks(tasks);
    broadcast('tasks-updated', tasks);
    return true;
  }
  return false;
});

ipcMain.handle('get-settings', () => readSettings());

ipcMain.handle('save-settings', (event, newSettings) => {
  const settings = { ...readSettings(), ...newSettings };
  writeSettings(settings);

  // Auto-start
  app.setLoginItemSettings({
    openAtLogin: settings.autoStart,
    path: app.getPath('exe')
  });

  broadcast('settings-updated', settings);
  return settings;
});

ipcMain.handle('get-history', () => readHistory());

ipcMain.handle('clear-history', () => {
  writeHistory([]);
  broadcast('history-updated', []);
  return [];
});

ipcMain.handle('export-tasks', async () => {
  const tasks = readTasks();
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'syntax-schedule-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, JSON.stringify(tasks, null, 2));
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

ipcMain.handle('import-tasks', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const data = fs.readFileSync(result.filePaths[0], 'utf8');
      const imported = JSON.parse(data);
      if (Array.isArray(imported)) {
        writeTasks(imported);
        broadcast('tasks-updated', imported);
        return { success: true, count: imported.length };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false };
});

ipcMain.handle('get-templates', () => {
  const settings = readSettings();
  return settings.templates || [];
});

ipcMain.handle('save-template', (event, template) => {
  const settings = readSettings();
  settings.templates = settings.templates || [];
  settings.templates.push(template);
  writeSettings(settings);
  return settings.templates;
});

ipcMain.handle('delete-template', (event, id) => {
  const settings = readSettings();
  if (settings.templates) {
    settings.templates = settings.templates.filter(t => t.id !== id);
    writeSettings(settings);
  }
  return settings.templates || [];
});

// Window controls
ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    const fs = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!fs);
    return !fs;
  }
  return false;
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    } else {
      mainWindow.maximize();
      return true;
    }
  }
  return false;
});

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.hide();
});

// Scheduler loop
function startScheduler() {
  setInterval(() => {
    const now = new Date();
    const settings = readSettings();
    if (!settings.autoNotify) return;
    const quiet = isQuietHours(settings);

    let tasks = readTasks();
    let changed = false;

    tasks.forEach(task => {
      if (task.completed) return;

      // Handle snooze
      if (task.snoozeUntil) {
        if (now >= new Date(task.snoozeUntil)) {
          task.snoozeUntil = null;
          changed = true;
        } else {
          return; // Still snoozed, skip this task
        }
      }

      // Early warning notification
      if (task.earlyWarning && task.earlyWarning !== 'none' && !task.earlyNotified) {
        const due = new Date(task.dueDate);
        const earlyMs = parseEarlyWarning(task.earlyWarning);
        const earlyTime = new Date(due.getTime() - earlyMs);
        if (now >= earlyTime && now < due) {
          if (!quiet) {
            sendNotification(`Upcoming: ${task.title}`, `Due ${due.toLocaleString()}`);
            if (settings.notificationSound && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('play-sound');
            }
          }
          logNotification(task.id, task.title, 'early', `Early warning: due ${due.toLocaleString()}`);
          task.earlyNotified = true;
          changed = true;
        }
      }

      // Main due notification
      if (!task.notified && task.notificationTime) {
        const notifyTime = new Date(task.notificationTime);
        if (now >= notifyTime) {
          if (!quiet) {
            sendNotification(task.title, task.description || 'Your task is due!');
            if (settings.notificationSound && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('play-sound');
            }
          }
          logNotification(task.id, task.title, 'due', 'Task is now due');

          if (task.recurring && task.recurring !== 'none') {
            const nextDate = new Date(notifyTime);
            if (task.recurring === 'daily') nextDate.setDate(nextDate.getDate() + 1);
            else if (task.recurring === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
            else if (task.recurring === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
            task.notificationTime = nextDate.toISOString();
            task.dueDate = nextDate.toISOString();
            task.notified = false;
            task.earlyNotified = false;
          } else {
            task.notified = true;
          }
          changed = true;
        }
      }
    });

    if (changed) {
      writeTasks(tasks);
      broadcast('tasks-updated', tasks);
    }
  }, 1000);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  startScheduler();

  // Ensure auto-start matches settings
  const settings = readSettings();
  app.setLoginItemSettings({
    openAtLogin: settings.autoStart,
    path: app.getPath('exe')
  });
});

app.on('window-all-closed', (e) => {
  if (!isQuitting) {
    e.preventDefault();
  } else {
    if (process.platform !== 'darwin') app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

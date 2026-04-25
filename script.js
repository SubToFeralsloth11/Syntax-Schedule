// Environment detection
const isElectron = typeof window !== 'undefined' && window.process && window.process.type === 'renderer';
let ipcRenderer = null;
if (isElectron) {
  try { ipcRenderer = window.require('electron').ipcRenderer; } catch (e) {}
}

// Simple event emitter for web fallback
const webEvents = {};
function webOn(channel, handler) {
  if (!webEvents[channel]) webEvents[channel] = [];
  webEvents[channel].push(handler);
}
function webEmit(channel, data) {
  if (webEvents[channel]) webEvents[channel].forEach(h => h({ sender: {} }, data));
}

// Web storage helpers
const LS_TASKS = 'ss_tasks';
const LS_SETTINGS = 'ss_settings';
const LS_HISTORY = 'ss_history';
function lsGet(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
const defaultWebSettings = {
  theme: 'system', accentColor: '#4f46e5', fontSize: 15, autoNotify: true,
  notificationSound: true, autoStart: false, defaultEarlyWarning: 'none',
  quietHoursEnabled: false, quietHoursStart: '23:00', quietHoursEnd: '07:00'
};
function webLogHistory(taskId, taskTitle, type, message) {
  const history = lsGet(LS_HISTORY, []);
  history.unshift({ id: Date.now().toString(), taskId, taskTitle, type, message, time: new Date().toISOString() });
  if (history.length > 100) history.pop();
  lsSet(LS_HISTORY, history);
  webEmit('history-updated', history);
}

const webHandlers = {
  'get-tasks': () => lsGet(LS_TASKS, []),
  'add-task': (task) => {
    const tasks = lsGet(LS_TASKS, []);
    tasks.push(task);
    lsSet(LS_TASKS, tasks);
    webEmit('tasks-updated', tasks);
    return tasks;
  },
  'delete-task': (id) => {
    const tasks = lsGet(LS_TASKS, []).filter(t => t.id !== id);
    lsSet(LS_TASKS, tasks);
    webEmit('tasks-updated', tasks);
    return tasks;
  },
  'update-task': (updatedTask) => {
    const tasks = lsGet(LS_TASKS, []);
    const idx = tasks.findIndex(t => t.id === updatedTask.id);
    if (idx !== -1) { tasks[idx] = updatedTask; lsSet(LS_TASKS, tasks); webEmit('tasks-updated', tasks); }
    return tasks;
  },
  'get-settings': () => ({ ...defaultWebSettings, ...lsGet(LS_SETTINGS, {}) }),
  'save-settings': (newSettings) => {
    const settings = { ...lsGet(LS_SETTINGS, {}), ...newSettings };
    if (newSettings.templates) settings.templates = newSettings.templates;
    lsSet(LS_SETTINGS, settings);
    webEmit('settings-updated', settings);
    return settings;
  },
  'get-history': () => lsGet(LS_HISTORY, []),
  'clear-history': () => { lsSet(LS_HISTORY, []); webEmit('history-updated', []); return []; },
  'send-notification': (task) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(task.title, { body: task.description || 'Your task is due!', icon: 'icon.ico' });
    }
    webLogHistory(task.id, task.title, 'manual', 'Manual notification triggered');
    return true;
  },
  'snooze-task': (id, minutes) => {
    const tasks = lsGet(LS_TASKS, []);
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      lsSet(LS_TASKS, tasks);
      webEmit('tasks-updated', tasks);
      return true;
    }
    return false;
  },
  'get-templates': () => { const s = lsGet(LS_SETTINGS, {}); return s.templates || []; },
  'save-template': (template) => {
    const settings = lsGet(LS_SETTINGS, {});
    settings.templates = settings.templates || [];
    settings.templates.push(template);
    lsSet(LS_SETTINGS, settings);
    return settings.templates;
  },
  'delete-template': (id) => {
    const settings = lsGet(LS_SETTINGS, {});
    if (settings.templates) {
      settings.templates = settings.templates.filter(t => t.id !== id);
      lsSet(LS_SETTINGS, settings);
    }
    return settings.templates || [];
  },
  'export-tasks': () => {
    const tasks = lsGet(LS_TASKS, []);
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'syntax-schedule-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    return { success: true, path: 'syntax-schedule-backup.json' };
  },
  'import-tasks': () => ({ success: false }),
  'toggle-fullscreen': () => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => {}); return true; }
    else { document.exitFullscreen().catch(() => {}); return false; }
  },
  'minimize-window': () => {},
  'maximize-window': () => {},
  'close-window': () => {}
};

const api = {
  invoke: async (channel, ...args) => {
    if (isElectron && ipcRenderer) return api.invoke(channel, ...args);
    const handler = webHandlers[channel];
    if (handler) return handler(...args);
    console.warn('No handler for', channel);
    return null;
  },
  on: (channel, handler) => {
    if (isElectron && ipcRenderer) api.on(channel, handler);
    else webOn(channel, handler);
  }
};

function startWebScheduler() {
  if (isElectron) return;
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  setInterval(() => {
    const now = new Date();
    const settings = lsGet(LS_SETTINGS, {});
    if (settings.autoNotify === false) return;
    let quiet = false;
    if (settings.quietHoursEnabled) {
      const current = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = (settings.quietHoursStart || '23:00').split(':').map(Number);
      const [eh, em] = (settings.quietHoursEnd || '07:00').split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      if (start < end) quiet = current >= start && current < end;
      else quiet = current >= start || current < end;
    }
    let tasks = lsGet(LS_TASKS, []);
    let changed = false;
    tasks.forEach(task => {
      if (task.completed) return;
      if (task.snoozeUntil) {
        if (now >= new Date(task.snoozeUntil)) { task.snoozeUntil = null; changed = true; }
        else return;
      }
      if (task.earlyWarning && task.earlyWarning !== 'none' && !task.earlyNotified) {
        const due = new Date(task.dueDate);
        const earlyMs = { '15-min': 15*60*1000, '1-hour': 60*60*1000, '1-day': 24*60*60*1000, '1-week': 7*24*60*60*1000 }[task.earlyWarning] || 0;
        const earlyTime = new Date(due.getTime() - earlyMs);
        if (now >= earlyTime && now < due) {
          if (!quiet && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(`Upcoming: ${task.title}`, { body: `Due ${due.toLocaleString()}`, icon: 'icon.ico' });
            if (settings.notificationSound !== false) playBeep();
          }
          webLogHistory(task.id, task.title, 'early', `Early warning: due ${due.toLocaleString()}`);
          task.earlyNotified = true; changed = true;
        }
      }
      if (!task.notified && task.notificationTime) {
        const notifyTime = new Date(task.notificationTime);
        if (now >= notifyTime) {
          if (!quiet && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(task.title, { body: task.description || 'Your task is due!', icon: 'icon.ico' });
            if (settings.notificationSound !== false) playBeep();
          }
          webLogHistory(task.id, task.title, 'due', 'Task is now due');
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
    if (changed) { lsSet(LS_TASKS, tasks); webEmit('tasks-updated', tasks); }
  }, 1000);
}

const APP_VERSION = '1.1.0';

let tasks = [];
let settings = {};
let history = [];
let templates = [];
let currentFilter = 'all';
let currentView = 'dashboard';
let searchQuery = '';
let calCurrentDate = new Date();
let calSelectedDate = null;

function getEl(id) { return document.getElementById(id); }
function on(el, evt, handler) { if (el) el.addEventListener(evt, handler); }

const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const navTaskCount = getEl('nav-task-count');
const statTotal = getEl('stat-total');
const statPending = getEl('stat-pending');
const statCompleted = getEl('stat-completed');
const statHigh = getEl('stat-high');
const dashboardUpcoming = getEl('dashboard-upcoming');
const quickAddForm = getEl('quick-add-form');
const filterTabs = document.querySelectorAll('.filter-tab');
const tasksContainer = getEl('tasks-container');
const searchInput = getEl('task-search');
const addTaskForm = getEl('add-task-form');
const templatesList = getEl('templates-list');
const btnSaveTemplate = getEl('btn-save-template');
const historyContainer = getEl('history-container');
const btnClearHistory = getEl('btn-clear-history');
const settingTheme = getEl('setting-theme');
const settingAccent = getEl('setting-accent');
const settingFontSize = getEl('setting-fontsize');
const fontSizeDisplay = getEl('font-size-display');
const settingAutoNotify = getEl('setting-auto-notify');
const settingSound = getEl('setting-sound');
const settingAutoStart = getEl('setting-autostart');
const settingEarly = getEl('setting-early');
const btnSaveSettings = getEl('btn-save-settings');
const btnToggleFullscreen = getEl('btn-toggle-fullscreen');
const btnExport = getEl('btn-export');
const btnImport = getEl('btn-import');
const calMonthYear = getEl('cal-month-year');
const calGrid = getEl('calendar-grid');
const calPrev = getEl('cal-prev');
const calNext = getEl('cal-next');
const calToday = getEl('cal-today');
const calDayTasks = getEl('calendar-day-tasks');
const editModal = getEl('edit-modal');
const editModalClose = getEl('edit-modal-close');
const editModalCancel = getEl('edit-modal-cancel');
const editTaskForm = getEl('edit-task-form');
const btnFocus = getEl('btn-focus');
const btnTestSound = getEl('btn-test-sound');
const settingQuietStart = getEl('setting-quiet-start');
const settingQuietEnd = getEl('setting-quiet-end');
const settingQuietEnabled = getEl('setting-quiet-enabled');
const shortcutsHint = getEl('shortcuts-hint');

document.addEventListener('DOMContentLoaded', async () => {
  if (!isElectron) document.body.classList.add('is-web');
  try {
    tasks = await api.invoke('get-tasks') || [];
    settings = await api.invoke('get-settings') || {};
    history = await api.invoke('get-history') || [];
    templates = await api.invoke('get-templates') || [];
    applySettings();
    updateAllViews();
    setupEventListeners();
    setupIPCListeners();
    showVersion();
    startWebScheduler();
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const dueStr = oneHourLater.toISOString().slice(0, 16);
    const dueInput = getEl('task-due');
    const notifyInput = getEl('task-notify');
    const quickDueInput = getEl('quick-due');
    if (dueInput) dueInput.value = dueStr;
    if (notifyInput) notifyInput.value = dueStr;
    if (quickDueInput) quickDueInput.value = dueStr;
    if (settings.defaultEarlyWarning) {
      const earlyInput = getEl('task-early');
      if (earlyInput) earlyInput.value = settings.defaultEarlyWarning;
    }
  } catch (err) {
    console.error('Init error:', err);
    alert('Error initializing app: ' + err.message);
  }
});

function showVersion() {
  if (getEl('app-version')) return;
  const v = document.createElement('div');
  v.id = 'app-version';
  v.textContent = 'v' + APP_VERSION;
  document.body.appendChild(v);
}

function setupIPCListeners() {
  api.on('tasks-updated', (e, d) => { tasks = d || []; updateAllViews(); });
  api.on('history-updated', (e, d) => { history = d || []; if (currentView === 'history') renderHistory(); });
  api.on('settings-updated', (e, d) => { settings = d || {}; applySettings(); });
  api.on('navigate-to', (e, view) => switchView(view));
  api.on('play-sound', playBeep);
}

function setupEventListeners() {
  navItems.forEach(item => on(item, 'click', () => switchView(item.dataset.view)));
  document.querySelectorAll('[data-nav]').forEach(btn => on(btn, 'click', () => switchView(btn.dataset.nav)));
  filterTabs.forEach(tab => on(tab, 'click', () => {
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    renderTasksList();
  }));
  on(searchInput, 'input', (e) => { searchQuery = e.target.value.toLowerCase().trim(); renderTasksList(); });
  on(calPrev, 'click', () => { calCurrentDate.setMonth(calCurrentDate.getMonth() - 1); renderCalendar(); });
  on(calNext, 'click', () => { calCurrentDate.setMonth(calCurrentDate.getMonth() + 1); renderCalendar(); });
  on(calToday, 'click', () => { calCurrentDate = new Date(); calSelectedDate = new Date(); renderCalendar(); renderDayTasks(new Date()); });

  // Calendar double-click to add task on that day
  if (calGrid) {
    on(calGrid, 'dblclick', (e) => {
      const cell = e.target.closest('.cal-day[data-cal-day]');
      if (!cell) return;
      const day = parseInt(cell.dataset.calDay);
      const year = calCurrentDate.getFullYear();
      const month = calCurrentDate.getMonth();
      const clickedDate = new Date(year, month, day, 9, 0, 0);
      const dateStr = clickedDate.toISOString().slice(0, 16);
      const dueInput = getEl('task-due');
      const notifyInput = getEl('task-notify');
      if (dueInput) dueInput.value = dateStr;
      if (notifyInput) notifyInput.value = dateStr;
      switchView('add');
    });
  }

  // Focus mode
  if (btnFocus) {
    on(btnFocus, 'click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      btnFocus.classList.add('active');
      currentFilter = 'focus';
      renderTasksList();
    });
  }

  // Test sound
  on(btnTestSound, 'click', () => { playBeep(); });

  on(quickAddForm, 'submit', async (e) => {
    e.preventDefault();
    const titleEl = getEl('quick-title'), dueEl = getEl('quick-due'), priorityEl = getEl('quick-priority');
    if (!titleEl || !dueEl) return;
    const title = titleEl.value.trim(), due = dueEl.value, priority = priorityEl ? priorityEl.value : 'medium';
    if (!title || !due) return;
    const dueDate = new Date(due);
    if (dueDate < new Date()) { alert('Due date cannot be in the past'); return; }
    const task = { id: Date.now().toString(), title, description: '', dueDate: dueDate.toISOString(), notificationTime: dueDate.toISOString(), priority, completed: false, notified: false, recurring: 'none', category: 'General', earlyWarning: settings.defaultEarlyWarning || 'none', earlyNotified: false, pinned: false };
    tasks = await api.invoke('add-task', task);
    quickAddForm.reset();
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dueEl.value = new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);
    if (priorityEl) priorityEl.value = 'medium';
    switchView('tasks');
  });

  on(addTaskForm, 'submit', async (e) => {
    e.preventDefault();
    const titleEl = getEl('task-title'), descEl = getEl('task-desc'), dueEl = getEl('task-due'), notifyEl = getEl('task-notify');
    const priorityEl = getEl('task-priority'), recurringEl = getEl('task-recurring'), categoryEl = getEl('task-category'), earlyEl = getEl('task-early');
    if (!titleEl || !dueEl || !notifyEl) return;
    const title = titleEl.value.trim(), description = descEl ? descEl.value.trim() : '', due = dueEl.value, notify = notifyEl.value;
    const priority = priorityEl ? priorityEl.value : 'medium', recurring = recurringEl ? recurringEl.value : 'none', category = categoryEl ? categoryEl.value : 'General', earlyWarning = earlyEl ? earlyEl.value : 'none';
    if (!title || !due || !notify) { alert('Please fill in all required fields'); return; }
    const notifyDate = new Date(notify);
    if (notifyDate < new Date()) { alert('Notification time must not be in the past'); return; }
    const task = { id: Date.now().toString(), title, description, dueDate: new Date(due).toISOString(), notificationTime: notifyDate.toISOString(), priority, completed: false, notified: false, recurring, category, earlyWarning, earlyNotified: false, pinned: false };
    tasks = await api.invoke('add-task', task);
    addTaskForm.reset();
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    dueEl.value = oneHourLater.toISOString().slice(0, 16); notifyEl.value = oneHourLater.toISOString().slice(0, 16);
    if (priorityEl) priorityEl.value = 'medium'; if (categoryEl) categoryEl.value = 'General'; if (recurringEl) recurringEl.value = 'none'; if (earlyEl) earlyEl.value = settings.defaultEarlyWarning || 'none';
    switchView('tasks');
  });

  on(btnSaveTemplate, 'click', async () => {
    const titleEl = getEl('task-title'); if (!titleEl) return;
    const title = titleEl.value.trim(); if (!title) { alert('Enter a title first'); return; }
    const template = { id: Date.now().toString(), name: title, title, description: (getEl('task-desc') || {}).value || '', priority: (getEl('task-priority') || {}).value || 'medium', category: (getEl('task-category') || {}).value || 'General', recurring: (getEl('task-recurring') || {}).value || 'none', earlyWarning: (getEl('task-early') || {}).value || 'none' };
    templates = await api.invoke('save-template', template);
    renderTemplates();
  });

  on(btnClearHistory, 'click', async () => { if (confirm('Clear all notification history?')) { history = await api.invoke('clear-history'); renderHistory(); } });
  on(settingFontSize, 'input', (e) => { if (fontSizeDisplay) fontSizeDisplay.textContent = e.target.value + 'px'; });
  on(btnSaveSettings, 'click', async () => {
    settings = {
      theme: settingTheme ? settingTheme.value : 'system',
      accentColor: settingAccent ? settingAccent.value : '#4f46e5',
      fontSize: settingFontSize ? parseInt(settingFontSize.value) : 15,
      autoNotify: settingAutoNotify ? settingAutoNotify.checked : true,
      notificationSound: settingSound ? settingSound.checked : true,
      autoStart: settingAutoStart ? settingAutoStart.checked : false,
      defaultEarlyWarning: settingEarly ? settingEarly.value : 'none',
      quietHoursEnabled: settingQuietEnabled ? settingQuietEnabled.checked : false,
      quietHoursStart: settingQuietStart ? settingQuietStart.value : '23:00',
      quietHoursEnd: settingQuietEnd ? settingQuietEnd.value : '07:00'
    };
    await api.invoke('save-settings', settings); applySettings();
    if (btnSaveSettings) { const original = btnSaveSettings.textContent; btnSaveSettings.textContent = 'Saved!'; btnSaveSettings.style.background = 'var(--success)'; setTimeout(() => { btnSaveSettings.textContent = original; btnSaveSettings.style.background = ''; }, 1500); }
  });
  on(btnToggleFullscreen, 'click', () => api.invoke('toggle-fullscreen'));
  on(btnExport, 'click', async () => { const result = await api.invoke('export-tasks'); if (result.success) alert('Tasks exported to: ' + result.path); });
  on(btnImport, 'click', async () => {
    if (!isElectron) {
      const input = document.getElementById('web-import-input');
      if (input) input.click();
      return;
    }
    const result = await api.invoke('import-tasks');
    if (result.success) { alert('Imported ' + result.count + ' tasks!'); tasks = await api.invoke('get-tasks'); updateAllViews(); }
    else if (result.error) alert('Import failed: ' + result.error);
  });

  // Web import file handler
  const webImportInput = document.getElementById('web-import-input');
  if (webImportInput) {
    on(webImportInput, 'change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (Array.isArray(imported)) {
          lsSet(LS_TASKS, imported);
          webEmit('tasks-updated', imported);
          tasks = imported;
          updateAllViews();
          alert('Imported ' + imported.length + ' tasks!');
        } else {
          alert('Import failed: invalid file format');
        }
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
      e.target.value = '';
    });
  }

  on(editModalClose, 'click', closeEditModal);
  on(editModalCancel, 'click', closeEditModal);
  if (editModal) { const overlay = editModal.querySelector('.modal-overlay'); if (overlay) on(overlay, 'click', closeEditModal); }

  on(editTaskForm, 'submit', async (e) => {
    e.preventDefault();
    const idEl = getEl('edit-id'); if (!idEl) return;
    const task = tasks.find(t => t.id === idEl.value); if (!task) return;
    const tEl = getEl('edit-title'), dEl = getEl('edit-desc'), cEl = getEl('edit-category'), pEl = getEl('edit-priority');
    const dueEl = getEl('edit-due'), nEl = getEl('edit-notify'), eEl = getEl('edit-early'), rEl = getEl('edit-recurring');
    if (tEl) task.title = tEl.value.trim(); if (dEl) task.description = dEl.value.trim(); if (cEl) task.category = cEl.value;
    if (pEl) task.priority = pEl.value; if (dueEl) task.dueDate = new Date(dueEl.value).toISOString();
    if (nEl) task.notificationTime = new Date(nEl.value).toISOString(); if (eEl) task.earlyWarning = eEl.value; if (rEl) task.recurring = rEl.value;
    tasks = await api.invoke('update-task', task);
    closeEditModal(); updateAllViews();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F11') { e.preventDefault(); api.invoke('toggle-fullscreen'); }
    if (e.key === 'Escape') { closeEditModal(); if (shortcutsHint) shortcutsHint.classList.remove('visible'); }

    // Ignore shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (shortcutsHint) shortcutsHint.classList.toggle('visible');
      return;
    }

    if (!e.ctrlKey && !e.metaKey) return;

    switch (e.key.toLowerCase()) {
      case 'n':
        e.preventDefault();
        switchView('add');
        getEl('task-title')?.focus();
        break;
      case 'f':
        e.preventDefault();
        switchView('tasks');
        getEl('task-search')?.focus();
        break;
      case 'd':
        e.preventDefault();
        if (e.shiftKey) {
          // Delete first selected/pending task - simplified
          const firstPending = tasks.find(t => !t.completed);
          if (firstPending) deleteTask(firstPending.id);
        } else {
          // Complete first pending task
          const firstPending = tasks.find(t => !t.completed);
          if (firstPending) toggleComplete(firstPending.id);
        }
        break;
      case '1':
        e.preventDefault();
        if (btnFocus) btnFocus.click();
        break;
      case '2':
        e.preventDefault();
        switchView('tasks');
        break;
      case '3':
        e.preventDefault();
        switchView('calendar');
        break;
      case ',':
        e.preventDefault();
        switchView('settings');
        break;
    }
  });
}

function switchView(viewName) {
  currentView = viewName;
  navItems.forEach(item => item.classList.toggle('active', item.dataset.view === viewName));
  views.forEach(view => view.classList.toggle('hidden', !view.id.endsWith(viewName)));
  if (viewName === 'history') renderHistory();
  if (viewName === 'add') renderTemplates();
  if (viewName === 'calendar') renderCalendar();
  updateAllViews();
}

function updateAllViews() {
  updateStats(); updateNavBadge(); renderDashboardUpcoming(); renderTasksList();
  if (currentView === 'calendar') renderCalendar();
}

function updateStats() {
  if (statTotal) statTotal.textContent = tasks.length;
  if (statPending) statPending.textContent = tasks.filter(t => !t.completed).length;
  if (statCompleted) statCompleted.textContent = tasks.filter(t => t.completed).length;
  if (statHigh) statHigh.textContent = tasks.filter(t => t.priority === 'high' && !t.completed).length;
}

function updateNavBadge() {
  const pending = tasks.filter(t => !t.completed).length;
  if (navTaskCount) { navTaskCount.textContent = pending; navTaskCount.style.display = pending > 0 ? 'inline' : 'none'; }
}

function renderDashboardUpcoming() {
  if (!dashboardUpcoming) return;
  const upcoming = tasks.filter(t => !t.completed).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 5);
  if (upcoming.length === 0) { dashboardUpcoming.innerHTML = '<div class="empty-state" style="padding: 32px;">No upcoming tasks</div>'; return; }
  dashboardUpcoming.innerHTML = upcoming.map(task => {
    const due = new Date(task.dueDate); const isOverdue = due < new Date();
    return '<div class="dashboard-task-item" onclick="window.openEditById(\'' + task.id + '\')" style="cursor:pointer;" title="Click to edit"><div class="dashboard-task-dot ' + task.priority + '"></div><div class="dashboard-task-info"><div class="dashboard-task-title">' + escapeHtml(task.title) + '</div><div class="dashboard-task-date">' + (isOverdue ? 'Overdue: ' : '') + due.toLocaleDateString() + ' ' + due.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + '</div></div><span class="dashboard-task-priority ' + task.priority + '">' + task.priority + '</span></div>';
  }).join('');
}

function renderTasksList() {
  if (!tasksContainer) return;
  let filtered = tasks;
  if (searchQuery) filtered = filtered.filter(t => t.title.toLowerCase().includes(searchQuery) || (t.description && t.description.toLowerCase().includes(searchQuery)) || t.category.toLowerCase().includes(searchQuery));
  if (currentFilter === 'pending') filtered = filtered.filter(t => !t.completed);
  if (currentFilter === 'completed') filtered = filtered.filter(t => t.completed);
  if (currentFilter === 'focus') filtered = filtered.filter(t => !t.completed && (t.priority === 'high' || new Date(t.dueDate) < new Date()));

  // Sort: pinned first, then overdue, then by due date
  filtered = [...filtered].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    const aOverdue = new Date(a.dueDate) < new Date() && !a.completed;
    const bOverdue = new Date(b.dueDate) < new Date() && !b.completed;
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    return new Date(a.dueDate) - new Date(b.dueDate);
  });

  if (filtered.length === 0) {
    tasksContainer.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><p>' + (searchQuery ? 'No matching tasks' : (currentFilter === 'all' ? 'No tasks yet' : 'No ' + currentFilter + ' tasks')) + '</p>' + (!searchQuery ? '<button class="btn-secondary" data-nav="add">Create a task</button>' : '') + '</div>';
    tasksContainer.querySelectorAll('[data-nav]').forEach(btn => on(btn, 'click', () => switchView(btn.dataset.nav)));
    return;
  }
  tasksContainer.innerHTML = filtered.map(task => createTaskCard(task)).join('');
  filtered.forEach(task => {
    const card = document.getElementById('task-' + task.id); if (!card) return;
    card.querySelectorAll('.action-edit').forEach(btn => on(btn, 'click', (e) => { e.stopPropagation(); openEditModal(task); }));
    const dupBtn = card.querySelector('.action-duplicate'); if (dupBtn) on(dupBtn, 'click', (e) => { e.stopPropagation(); duplicateTask(task); });
    const pinBtn = card.querySelector('.action-pin'); if (pinBtn) on(pinBtn, 'click', () => togglePin(task.id));
    const completeBtn = card.querySelector('.action-complete'); if (completeBtn) on(completeBtn, 'click', () => toggleComplete(task.id));
    const deleteBtn = card.querySelector('.action-delete'); if (deleteBtn) on(deleteBtn, 'click', () => deleteTask(task.id));
    const snoozeBtn = card.querySelector('.action-snooze'); if (snoozeBtn) on(snoozeBtn, 'click', () => snoozeTask(task.id, 10));
    const notifyBtn = card.querySelector('.action-notify'); if (notifyBtn) on(notifyBtn, 'click', () => sendManualNotify(task.id));
  });
}

function getTimeRemaining(dueDate) {
  const now = new Date();
  const due = new Date(dueDate);
  const diff = due - now;
  const absDiff = Math.abs(diff);
  const isOverdue = diff < 0;

  if (absDiff < 60 * 1000) return { text: isOverdue ? 'Just overdue' : 'Due now', class: isOverdue ? 'overdue' : 'soon' };
  if (absDiff < 60 * 60 * 1000) {
    const mins = Math.ceil(absDiff / (60 * 1000));
    return { text: isOverdue ? 'Overdue ' + mins + ' min' : 'In ' + mins + ' min', class: isOverdue ? 'overdue' : 'soon' };
  }
  if (absDiff < 24 * 60 * 60 * 1000) {
    const hrs = Math.ceil(absDiff / (60 * 60 * 1000));
    return { text: isOverdue ? 'Overdue ' + hrs + ' hr' : 'In ' + hrs + ' hr', class: isOverdue ? 'overdue' : 'soon' };
  }
  if (absDiff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.ceil(absDiff / (24 * 60 * 60 * 1000));
    return { text: isOverdue ? 'Overdue ' + days + ' day' : 'In ' + days + ' day', class: isOverdue ? 'overdue' : 'later' };
  }
  const weeks = Math.ceil(absDiff / (7 * 24 * 60 * 60 * 1000));
  return { text: isOverdue ? 'Overdue ' + weeks + ' wk' : 'In ' + weeks + ' wk', class: isOverdue ? 'overdue' : 'later' };
}

function createTaskCard(task) {
  const due = new Date(task.dueDate); const notify = new Date(task.notificationTime); const isOverdue = due < new Date() && !task.completed;
  const timeRem = getTimeRemaining(task.dueDate);
  return '<div class="task-card ' + (task.pinned ? 'pinned ' : '') + (isOverdue ? 'overdue ' : '') + (task.completed ? 'completed' : '') + '" id="task-' + task.id + '"><div class="task-main"><div class="task-header"><span class="priority-badge ' + task.priority + '">' + task.priority + '</span><span class="category-badge ' + task.category + '">' + task.category + '</span><span class="task-title" style="cursor:pointer;" onclick="window.openEditById(\'' + task.id + '\')" title="Click to edit">' + escapeHtml(task.title) + '</span>' + (!task.completed ? '<span class="time-remaining ' + timeRem.class + '">' + timeRem.text + '</span>' : '') + '</div>' + (task.description ? '<div class="task-desc">' + escapeHtml(task.description) + '</div>' : '') + '<div class="task-meta-row"><span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' + due.toLocaleDateString() + ' ' + due.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + '</span><span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + notify.toLocaleDateString() + ' ' + notify.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + '</span>' + (task.earlyWarning && task.earlyWarning !== 'none' ? '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ' + formatEarlyWarning(task.earlyWarning) + '</span>' : '') + (task.recurring !== 'none' ? '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> ' + task.recurring + '</span>' : '') + (task.completed ? '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Done</span>' : '') + (task.notified && !task.completed ? '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg> Notified</span>' : '') + '</div></div><div class="task-actions"><button class="btn-icon-action action-edit" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon-action action-duplicate" title="Duplicate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>        <button class="btn-icon-action action-snooze" title="Snooze 10 min"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button><button class="btn-icon-action notify action-notify" title="Notify Now"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg></button><button class="btn-icon-action ' + (task.completed ? '' : 'complete ') + 'action-complete" title="' + (task.completed ? 'Mark Pending' : 'Mark Complete') + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button><button class="btn-icon-action delete action-delete" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></div></div>';
}

function openEditById(id) { const task = tasks.find(t => t.id === id); if (task) openEditModal(task); }

function openEditModal(task) {
  const idEl = getEl('edit-id'), tEl = getEl('edit-title'), dEl = getEl('edit-desc'), cEl = getEl('edit-category');
  const pEl = getEl('edit-priority'), dueEl = getEl('edit-due'), nEl = getEl('edit-notify'), eEl = getEl('edit-early'), rEl = getEl('edit-recurring');
  if (idEl) idEl.value = task.id; if (tEl) tEl.value = task.title; if (dEl) dEl.value = task.description || '';
  if (cEl) cEl.value = task.category || 'General'; if (pEl) pEl.value = task.priority;
  if (dueEl) dueEl.value = new Date(task.dueDate).toISOString().slice(0, 16);
  if (nEl) nEl.value = new Date(task.notificationTime).toISOString().slice(0, 16);
  if (eEl) eEl.value = task.earlyWarning || 'none'; if (rEl) rEl.value = task.recurring || 'none';
  if (editModal) editModal.classList.remove('hidden');
}

function closeEditModal() { if (editModal) editModal.classList.add('hidden'); }

function renderTemplates() {
  if (!templatesList) return;
  if (!templates || templates.length === 0) { templatesList.innerHTML = '<div class="empty-state small">No templates saved yet</div>'; return; }
  templatesList.innerHTML = templates.map(t => '<div class="template-item" data-template-id="' + t.id + '"><div class="template-info"><span class="template-name">' + escapeHtml(t.name) + '</span><span class="template-meta">' + t.category + ' &middot; ' + t.priority + ' priority' + (t.recurring !== 'none' ? ' &middot; ' + t.recurring : '') + '</span></div><button class="template-delete" data-template-id="' + t.id + '" title="Delete template"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>').join('');
  templatesList.querySelectorAll('.template-item').forEach(item => on(item, 'click', (e) => { if (e.target.closest('.template-delete')) return; loadTemplate(item.dataset.templateId); }));
  templatesList.querySelectorAll('.template-delete').forEach(btn => on(btn, 'click', async (e) => { e.stopPropagation(); templates = await api.invoke('delete-template', btn.dataset.templateId); renderTemplates(); }));
}

function loadTemplate(id) {
  const template = templates.find(t => t.id === id); if (!template) return;
  const tEl = getEl('task-title'), dEl = getEl('task-desc'), cEl = getEl('task-category'), pEl = getEl('task-priority'), rEl = getEl('task-recurring'), eEl = getEl('task-early');
  if (tEl) tEl.value = template.title || ''; if (dEl) dEl.value = template.description || '';
  if (cEl) cEl.value = template.category || 'General'; if (pEl) pEl.value = template.priority || 'medium';
  if (rEl) rEl.value = template.recurring || 'none'; if (eEl) eEl.value = template.earlyWarning || 'none';
}

function renderHistory() {
  if (!historyContainer) return;
  if (!history || history.length === 0) { historyContainer.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg><p>No notifications sent yet</p></div>'; return; }
  historyContainer.innerHTML = history.map(h => { const time = new Date(h.time); return '<div class="history-item"><div class="history-dot ' + h.type + '"></div><div class="history-info"><div class="history-title">' + escapeHtml(h.taskTitle) + '</div><div class="history-desc">' + escapeHtml(h.message) + '</div></div><span class="history-time">' + time.toLocaleDateString() + ' ' + time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + '</span></div>'; }).join('');
}

async function togglePin(id) { const task = tasks.find(t => t.id === id); if (!task) return; task.pinned = !task.pinned; tasks = await api.invoke('update-task', task); renderTasksList(); }
async function toggleComplete(id) { const task = tasks.find(t => t.id === id); if (!task) return; task.completed = !task.completed; tasks = await api.invoke('update-task', task); updateAllViews(); }
async function deleteTask(id) { if (!confirm('Are you sure you want to delete this task?')) return; tasks = await api.invoke('delete-task', id); updateAllViews(); }
async function sendManualNotify(id) { const task = tasks.find(t => t.id === id); if (!task) return; await api.invoke('send-notification', task); }

async function snoozeTask(id, minutes) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  await api.invoke('snooze-task', id, minutes);
  tasks = await api.invoke('get-tasks');
  updateAllViews();
}

async function duplicateTask(task) {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
  const newTask = {
    id: Date.now().toString(),
    title: task.title + ' (Copy)',
    description: task.description || '',
    dueDate: oneHourLater.toISOString(),
    notificationTime: oneHourLater.toISOString(),
    priority: task.priority,
    completed: false,
    notified: false,
    recurring: task.recurring || 'none',
    category: task.category || 'General',
    earlyWarning: task.earlyWarning || 'none',
    earlyNotified: false,
    pinned: false
  };
  tasks = await api.invoke('add-task', newTask);
  updateAllViews();
}

function getTasksForDate(year, month, day) {
  const date = new Date(year, month, day);
  return tasks.filter(t => {
    const due = new Date(t.dueDate);
    if (due.getDate() === day && due.getMonth() === month && due.getFullYear() === year) return true;
    if (t.recurring === 'none') return false;
    if (date < new Date(due.getFullYear(), due.getMonth(), due.getDate())) return false;
    if (t.recurring === 'daily') return true;
    if (t.recurring === 'weekly') return date.getDay() === due.getDay();
    if (t.recurring === 'monthly') return date.getDate() === due.getDate();
    return false;
  }).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

function renderCalendar() {
  if (!calGrid || !calMonthYear) return;
  const year = calCurrentDate.getFullYear(), month = calCurrentDate.getMonth();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  calMonthYear.textContent = monthNames[month] + ' ' + year;
  const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate(), daysInPrevMonth = new Date(year, month, 0).getDate();
  let html = '<div class="cal-day-header">Sun</div><div class="cal-day-header">Mon</div><div class="cal-day-header">Tue</div><div class="cal-day-header">Wed</div><div class="cal-day-header">Thu</div><div class="cal-day-header">Fri</div><div class="cal-day-header">Sat</div>';
  const today = new Date();
  const isToday = (d) => d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  const isSelected = (d) => calSelectedDate && d.getDate() === calSelectedDate.getDate() && d.getMonth() === calSelectedDate.getMonth() && d.getFullYear() === calSelectedDate.getFullYear();
  for (let i = firstDay - 1; i >= 0; i--) html += '<div class="cal-day other-month"><span class="cal-day-number">' + (daysInPrevMonth - i) + '</span></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day), dayTasks = getTasksForDate(year, month, day);
    const cls = []; if (isToday(date)) cls.push('today'); if (isSelected(date)) cls.push('selected');
    const dotHtml = dayTasks.slice(0, 5).map(t => '<span class="cal-task-dot ' + (t.completed ? 'completed' : t.priority) + '" title="' + escapeHtml(t.title) + '"></span>').join('');
    const nameHtml = dayTasks.slice(0, 3).map(t => '<span class="cal-task-name ' + (t.completed ? 'completed' : t.priority) + '">' + escapeHtml(t.title) + '</span>').join('');
    html += '<div class="cal-day ' + cls.join(' ') + '" data-cal-day="' + day + '"><span class="cal-day-number">' + day + '</span>' + (dayTasks.length > 0 ? '<div class="cal-day-task-dots">' + dotHtml + '</div>' : '') + (dayTasks.length > 0 ? '<div class="cal-day-task-names">' + nameHtml + '</div>' : '') + '</div>';
  }
  const totalCells = firstDay + daysInMonth, remaining = (7 - (totalCells % 7)) % 7;
  for (let day = 1; day <= remaining; day++) html += '<div class="cal-day other-month"><span class="cal-day-number">' + day + '</span></div>';
  calGrid.innerHTML = html;
  calGrid.querySelectorAll('.cal-day[data-cal-day]').forEach(cell => on(cell, 'click', () => { const day = parseInt(cell.dataset.calDay); calSelectedDate = new Date(year, month, day); renderCalendar(); renderDayTasks(calSelectedDate); }));
}

function renderDayTasks(date) {
  if (!calDayTasks) return;
  const year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
  const dayTasks = getTasksForDate(year, month, day);
  if (dayTasks.length === 0) { calDayTasks.innerHTML = '<div class="empty-state" style="padding: 24px;">No tasks on ' + date.toLocaleDateString() + '</div>'; return; }
  calDayTasks.innerHTML = '<h3>Tasks for ' + date.toLocaleDateString() + '</h3>' + dayTasks.map(task => {
    const isRecurring = !(new Date(task.dueDate).getDate() === day && new Date(task.dueDate).getMonth() === month && new Date(task.dueDate).getFullYear() === year);
    return '<div class="dashboard-task-item" style="margin-bottom: 8px; cursor: pointer;" onclick="window.openEditById(\'' + task.id + '\')"><div class="dashboard-task-dot ' + task.priority + '"></div><div class="dashboard-task-info"><div class="dashboard-task-title">' + escapeHtml(task.title) + (task.completed ? ' <span style="color:var(--success)">(Done)</span>' : '') + (isRecurring ? ' <span style="color:var(--accent); font-size:0.8em;">(Recurring)</span>' : '') + '</div><div class="dashboard-task-date">' + new Date(task.dueDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + ' &middot; ' + task.category + (task.recurring !== 'none' ? ' &middot; ' + task.recurring : '') + '</div></div><span class="dashboard-task-priority ' + task.priority + '">' + task.priority + '</span></div>';
  }).join('');
}

function applySettings() {
  if (settings.theme === 'system') document.body.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  else document.body.classList.toggle('dark', settings.theme === 'dark');
  const accent = settings.accentColor || '#4f46e5';
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-hover', adjustColor(accent, -20));
  document.documentElement.style.setProperty('--font-size', (settings.fontSize || 15) + 'px');
  if (settingTheme) settingTheme.value = settings.theme || 'system';
  if (settingAccent) settingAccent.value = accent;
  if (settingFontSize) settingFontSize.value = settings.fontSize || 15;
  if (fontSizeDisplay) fontSizeDisplay.textContent = (settings.fontSize || 15) + 'px';
  if (settingAutoNotify) settingAutoNotify.checked = settings.autoNotify !== false;
  if (settingSound) settingSound.checked = settings.notificationSound !== false;
  if (settingAutoStart) settingAutoStart.checked = settings.autoStart === true;
  if (settingEarly) settingEarly.value = settings.defaultEarlyWarning || 'none';
  if (settingQuietEnabled) settingQuietEnabled.checked = settings.quietHoursEnabled === true;
  if (settingQuietStart) settingQuietStart.value = settings.quietHoursStart || '23:00';
  if (settingQuietEnd) settingQuietEnd.value = settings.quietHoursEnd || '07:00';
}

function adjustColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function formatEarlyWarning(val) { const map = { '15-min': '15 min early', '1-hour': '1 hr early', '1-day': '1 day early', '1-week': '1 week early' }; return map[val] || val; }

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch (e) { console.log('Audio play failed', e); }
}

window.switchView = switchView;
window.openEditById = openEditById;

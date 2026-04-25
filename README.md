# Syntax Schedule

A personal desktop and web app for managing your daily schedule, tasks, and calendar. Built with vanilla HTML, CSS, and JavaScript, and packaged with Electron for Windows.

## Features

- **Dashboard** — Overview of today's tasks and upcoming items
- **Task Management** — Add, edit, delete, duplicate, and organize tasks
- **Calendar View** — Visualize tasks on a monthly calendar
- **History** — Track completed and past tasks
- **Recurring Tasks** — Set tasks to repeat automatically
- **Notifications** — Get reminded when tasks are due
- **Snooze & Early Warnings** — Flexible reminder options
- **Dark Mode & Theming** — Customizable accent colors, font sizes, and dark mode
- **Export / Import** — Backup and restore your data as JSON
- **Offline Support** — Works without an internet connection (via service worker)

## Getting Started

### Desktop (Windows)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Run in development mode**
   ```bash
   npm start
   ```

3. **Build installer**
   ```bash
   npm run build
   ```
   This creates a Windows `.exe` installer in the `dist` folder.

### Web / PWA

You can also run the app as a Progressive Web App (PWA) in any modern browser:

```bash
npx serve .
```

Then open `http://localhost:3000`.

For iPhone/iPad installation instructions, see [`README-iOS.md`](README-iOS.md).

## Project Structure

| File | Purpose |
|------|---------|
| `index.html` | Main app page |
| `style.css` | App styles (responsive & mobile-optimized) |
| `script.js` | Core application logic |
| `main.js` | Electron main process entry point |
| `sw.js` | Service worker for offline caching |
| `manifest.json` | PWA manifest |
| `package.json` | Electron dependencies & build scripts |
| `tasks.json` | Default task data |
| `settings.json` | Default settings |
| `history.json` | Task history data |
| `rules.md` | App rules / conventions |
| `README-iOS.md` | iOS PWA installation guide |

## Platform Notes

| Feature | Desktop (Electron) | Web / PWA |
|---------|-------------------|-----------|
| Dashboard, tasks, calendar | Yes | Yes |
| Recurring tasks & snooze | Yes | Yes |
| Notifications | Native desktop | In-app / push (browser dependent) |
| Minimize to system tray | Yes | No |
| Start on boot | Yes | No |
| Offline access | Yes | Yes (after first load) |

## License

ISC

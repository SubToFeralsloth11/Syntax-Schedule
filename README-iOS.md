# Syntax Schedule for iOS

The Windows `.exe` installer **does not work on iPhone/iPad**. iOS uses a different format called a **Progressive Web App (PWA)**.

This folder is already set up as a PWA — it works like a native app when opened in Safari and added to your Home Screen.

---

## How to install on iOS (no App Store needed)

1. **Host these files online**
   - Upload this entire folder to any web host (GitHub Pages, Netlify, Vercel, or even a personal server).
   - Example: `https://yourname.github.io/syntax-schedule/`

2. **Open the link in Safari** on your iPhone/iPad.

3. **Add to Home Screen**
   - Tap the **Share** button (the square with an arrow).
   - Scroll down and tap **"Add to Home Screen"**.
   - Tap **Add**.

4. **Launch from the home screen**
   - It opens in full-screen mode without the Safari address bar.
   - It works **offline** once loaded.

---

## What works on iOS

- Dashboard, tasks, calendar, history, settings
- Add / edit / delete / duplicate tasks
- Local notifications when tasks are due (while the app is open)
- Recurring tasks, snooze, early warnings
- Dark mode, accent color, font size settings
- Export / import JSON backups
- Offline access

## What does not work on iOS (Electron-only)

- Minimize to system tray
- Start on boot
- Native desktop notifications when the app is fully closed
- Auto-start with Windows

---

## Files included

| File | Purpose |
|------|---------|
| `index.html` | Main app page |
| `style.css` | App styles (mobile-optimized) |
| `script.js` | App logic (works in browser + Electron) |
| `manifest.json` | PWA manifest |
| `sw.js` | Service worker for offline caching |
| `icon-192.png` | App icon (192×192) |
| `icon-512.png` | App icon (512×512) |
| `apple-touch-icon.png` | iOS home screen icon |

---

## Quick test on your computer

If you want to test the web version before uploading, run this in the folder:

```bash
npx serve .
```

Then open `http://localhost:3000` in your browser.

---

## Note

Because Apple restricts background processes, iOS can only show notifications while the app is open or recently used. For the best reminder experience, open the app once a day.

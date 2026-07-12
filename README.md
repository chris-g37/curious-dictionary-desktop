# Curious Dictionary Desktop

A minimalist Windows dictionary app. Press a shortcut, a small search pill
appears at the top of your screen, type a word and hit Enter, get a
definition card. Press Escape or click away and it disappears — nothing
else on your desktop is touched. It lives in the system tray, remembers
your recent searches, and follows your OS theme.

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Add your Merriam-Webster API key. Either:

   - Open the app, click the tray icon, choose **Settings**, and paste your
     [Merriam-Webster Collegiate Dictionary API](https://dictionaryapi.com/)
     key there (there's a "Get a free key" link in the same window) — or
   - `copy config.example.js config.js` and paste the key into `config.js`
     before first run. This is only a first-run fallback: on startup, if
     there's no key saved yet, the app copies the one from `config.js` into
     its own settings store and uses that from then on. `config.js` is
     gitignored either way, so a key pasted there never gets committed.

3. Run it:

   ```
   npm start
   ```

## Using it

- **Ctrl+Shift+Space**, or left-clicking the tray icon — show the bar
  (focused and ready to type) or hide it if it's already open
- Type a word, press **Enter** to look it up
- **Escape**, or clicking anywhere outside the bar, hides it
- Hiding doesn't clear anything — summon it again and your last result is
  still there
- With an empty search box, the bar shows your 8 most recent lookups —
  click one to look it up again
- Right-click the tray icon for Search / Settings / Quit. Closing the
  Settings window, or dismissing the bar, never quits the app — only
  **Quit** from the tray does
- Settings (tray → Settings) holds your API key, a Light/Dark/System theme
  picker, and a "Clear history" button

## How it's built

- `main.js` — the main process. This is the only part of the app with
  access to Node/OS APIs: it creates the windows, owns the tray icon,
  registers the global keyboard shortcut, reads/writes persisted settings,
  and makes the Merriam-Webster API call.
- `preload.js` — a small bridge script that exposes a fixed set of
  functions to the pages (`window.api`: `lookupWord`, `hideBar`,
  `getRecentHistory`, `saveTheme`, etc.). The renderers can't reach Node or
  the network directly — they can only call these specific functions.
- `src/bar/` — the summon bar renderer: the search pill, result card, and
  recent-history list.
- `src/settings/` — the settings window renderer: API key field, theme
  picker, clear-history button.
- Both renderers are sandboxed webpages (`contextIsolation: true`,
  `nodeIntegration: false`) with no direct filesystem or network access.
- `assets/icons/` — the tray icon.

### Tray lifecycle

The app has no visible main window — `main.js` creates the tray icon in
`app.whenReady()` and the process just keeps running in the background from
then on, driven entirely by tray clicks, the global shortcut, and IPC calls
from the two renderer windows. Closing the summon bar only hides it
(`BrowserWindow.hide()`, not `.close()`), and closing the Settings window
lets it fully close since it's cheap to recreate — neither ends the app,
because `app.on('window-all-closed', ...)` is wired to ignore that event
unless the tray's **Quit** item was actually used (tracked with an
`isQuitting` flag). Quit is the only path that calls `app.quit()`.

### Where settings and history live

`electron-store` (a thin wrapper around a JSON file) persists the API key,
theme choice, and search history to a `config.json` file in the OS's
per-app data folder — on Windows that's
`%APPDATA%\curious-dictionary-desktop\config.json`. It's separate from the
project's own `config.js`/`config.example.js`, which only exist as a
one-time import path for the API key on first run. Because the store reads
straight from that file, a change made in Settings (like a new API key or
theme) takes effect on the very next lookup or repaint — no restart needed.

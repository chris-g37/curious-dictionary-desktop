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
- **Ctrl+Shift+D** — highlight a word in any Windows app (browser, PDF
  reader, Word, Notepad, ...) and press this to pop the bar up with that
  word already looked up
- **Escape**, or clicking anywhere outside the bar, hides it
- Hiding doesn't clear anything — summon it again and your last result is
  still there
- With an empty search box, the bar shows your 8 most recent lookups —
  click one to look it up again
- Right-click the tray icon for Search / Settings / Quit. Closing the
  Settings window, or dismissing the bar, never quits the app — only
  **Quit** from the tray does
- Settings (tray → Settings) holds your API key, a Light/Dark/System theme
  picker, a "Clear history" button, and a read-only list of both keyboard
  shortcuts

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

### How select-anywhere lookup works (the clipboard trick)

There's no Windows API that hands you "the currently selected text in some
other app" — the only universal way to get it is the same thing a human
would do: copy it. `Ctrl+Shift+D` triggers this sequence in `main.js`
(`handleSelectionHotkey`):

1. **Snapshot the clipboard.** Read whatever's on it right now (text, plus
   paired HTML if it's rich text). If it's not text at all — an image, a
   file — that's noted so we know not to try reconstructing it later.
2. **Send a synthetic Ctrl+C** to whatever window currently has OS focus.
   Global shortcuts don't steal focus, so at this point that's still
   whatever app you were selecting text in, not our (still-hidden) bar
   window.
3. **Wait ~150ms** for that app to actually respond to the keystroke and
   write to the clipboard.
4. **Read the clipboard again** and compare it to the snapshot from step 1.
5. **Restore the original clipboard contents** immediately — before doing
   anything else with what was grabbed, so a slow network lookup can't
   leave your clipboard in the wrong state in the meantime.
6. **Sanitize and show the bar.** If the clipboard never changed (nothing
   was selected, or the keystroke got blocked), show the bar empty with a
   one-line hint. Otherwise take the first word, strip punctuation,
   lowercase it, and run the lookup automatically.

For step 2, the synthetic Ctrl+C, I went with spawning
`powershell.exe ... [System.Windows.Forms.SendKeys]::SendWait('^c')` rather
than a native automation module like `robotjs`. Reasoning: native modules
need to be rebuilt against Electron's exact ABI, prebuilt binaries for a
given Electron/Node/Windows combination aren't always available, and
`robotjs` in particular is effectively unmaintained. SendKeys ships with
every Windows install, needs zero npm dependencies, and just works. The
tradeoff is that spawning a process costs on the order of 100-300ms —
acceptable here since the whole flow already waits on a network call.

Some windows — anything running elevated/as Administrator, in particular —
block synthetic input from a non-elevated process like our app. In that
case the clipboard simply won't change, which is indistinguishable from
"nothing was selected," so both land on the same honest "couldn't grab
the selection" hint rather than a false positive.

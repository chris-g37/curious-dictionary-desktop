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
  picker, a "Clear history" button, a "Show floating icon" toggle, and a
  read-only list of both keyboard shortcuts
- The floating icon (off by default — turn it on in Settings) is a small
  draggable button that floats above other windows. Left-click it to
  summon the bar, drag it anywhere and let go to snap it to the nearest
  screen edge, right-click for Pin/Unpin, Hide, and Settings

## Testing the packaged build

`npm run build` produces two Windows executables in `dist/`: a portable
`.exe` and an NSIS installer `.exe`. The portable one is a single
self-contained file — no install, no admin prompt, just double-click it
and the app runs, the same as `npm start` but without needing Node or this
source tree around. That's the one for daily use. The installer is for
when you want a proper install with a Start Menu shortcut and an
uninstaller, which matters more for handing the app to someone else than
for your own machine.

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
  picker, clear-history button, floating-icon toggle.
- `src/floating-icon/` — the floating icon renderer: a 36px circular
  button, dragged and clicked entirely with hand-rolled mouse-event
  handling (see below).
- All renderers are sandboxed webpages (`contextIsolation: true`,
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

### How the floating icon is draggable but never steals focus

The icon's `BrowserWindow` is created with `focusable: false`. On Windows
this is the difference between two things that are easy to conflate:
*focus* (which window receives keyboard input and counts as "active") and
*mouse hit-testing* (which window a click/drag lands on). They're
independent — `focusable: false` only opts the window out of the first one
(no `WM_SETFOCUS`, it can never become the active window), so clicking it
never yanks keyboard focus away from whatever app you were just typing
into. Mouse events are untouched by this setting: `mousedown`, `mousemove`,
and `mouseup` all fire in the icon's renderer exactly as they would in any
other window, which is what makes dragging and clicking both possible
without ever activating it.

Dragging itself is hand-rolled in `src/floating-icon/icon.js` rather than
using Electron's native `-webkit-app-region: drag`, specifically so we can
tell a *click* (summon the bar) apart from a *drag* (reposition) and know
exactly when the mouse was released:

- `mousedown` on the icon starts tracking, but doesn't move anything yet.
- `mousemove` (listened for on `window`, not just the icon) computes how
  far the cursor has traveled; once that passes a small threshold (4px) it
  counts as a real drag, and each further move repositions the window via
  `BrowserWindow.setPosition()`. Below that threshold, it's still
  considered a click-in-progress. Mouse events keep arriving here even
  once the cursor is outside the tiny 44px window, because Chromium
  implicitly captures the mouse to whichever window a `mousedown` started
  in — the same mechanism that lets you drag a `<input type="range">`
  slider past the edge of a normal web page.
- `mouseup` is "released." If the 4px threshold was never crossed, it's
  treated as a plain click and asks the main process to toggle the search
  bar. If it was crossed, the main process reads the window's current
  position, decides left or right edge based on which half of the screen
  its center is in, and snaps it there with one more `setPosition()` call
  — no continuous polling involved, the renderer's own `mouseup` is the
  entire signal.

# Curious Dictionary Desktop

A minimalist Windows dictionary app. Press a shortcut, a small search pill
appears at the top of your screen, type a word and hit Enter, get a
definition card. Press Escape or click away and it disappears. For longer
reading there is a full main window with autocomplete, recent lookups and a
Saved list. It lives in the system tray, works **offline** from a built-in
dictionary pack, and can optionally use Merriam-Webster as a second source.

Built by [Fetchmate Chief Technologies](https://services.fetchmate.tech).

## Dictionary sources

| Source | What it is | Needs |
|---|---|---|
| **Offline pack** | A compact SQLite dictionary built from Wiktionary (via kaikki.org). Looked up on your own machine, page by page, never loaded whole into memory. | A pack file in the app's data folder |
| **Merriam-Webster** (optional) | The Merriam-Webster Collegiate Dictionary API. | Your own free API key |

Each lookup shows a badge saying which source answered: green
"Offline · Wiktionary" or terracotta "Merriam-Webster".

Settings → **Dictionary source** chooses the order:

- **Offline first** (default): the pack answers; Merriam-Webster is asked only
  when the pack has no entry and you have saved an API key.
- **Online first**: Merriam-Webster answers; the pack steps in when you are
  offline, the daily limit is reached, or the request fails.

The app works fully without an API key. The Merriam-Webster free tier allows
1,000 lookups a day; the app keeps a local count (a number and a date, nothing
else) and shows a notice when the limit is reached.

## Setup

1. Install dependencies (Node 22.5 or newer is needed for the build tools):

   ```
   npm install
   ```

2. Get an offline pack. Packs are not stored in this repo or bundled in the
   installer; the app downloads one on demand. On a first run with no pack and
   no API key the window offers **Download the offline pack to get started**.
   Any time later: **Settings → Dictionary → Offline pack** shows what is
   installed and offers **Download Core**, **Download Full** and
   **Restore / re-download**, with progress and Cancel. Downloads come from the
   `packs` release on GitHub, are checked against a SHA-256 in the published
   manifest, and only replace your current pack once they verify. The app
   checks for a newer pack at most once a day and only shows a quiet "Update
   available" note; it never downloads by itself.

   Prefer to build one yourself? See [tools/README.md](tools/README.md); to
   publish packs see [docs/PUBLISHING-PACKS.md](docs/PUBLISHING-PACKS.md). A
   hand-built pack can be copied into the app's `packs` folder:

   - running with `npm start`: `%APPDATA%\curious-dictionary-desktop\packs\`
   - installed app: `%APPDATA%\Curious Dictionary\packs\`

   The app uses `curious-en-full.db` if present, otherwise `curious-en-core.db`.

3. Optional: add a Merriam-Webster API key. Open **Settings** (tray menu, or
   the Settings item in the main window) and paste the key into the
   Merriam-Webster field ("Get a free key" links to
   [dictionaryapi.com](https://dictionaryapi.com/)). As an alternative,
   `copy config.example.js config.js` and paste the key there before first
   run; the app copies it into its own settings once. `config.js` is
   gitignored.

4. Run it:

   ```
   npm start
   ```

## Using it

- **Ctrl+Shift+Space**, or left-clicking the tray icon: show or hide the bar
- Type a word, press **Enter**. With a pack installed, suggestions with
  everyday words first appear in the main window as you type.
- **Ctrl+Shift+D**: select a word in any Windows app and press this to pop the
  bar up with that word already looked up
- **Escape**, or clicking outside the bar, hides it
- With an empty search box the bar shows your 8 most recent lookups
- On a result card: **Copy**, **Pin** (adds the word to Saved), **History**
  (back to recent lookups) and **Open in app** (opens the main window on that
  word)
- Tray menu: **Open Curious** (main window), Search, Settings, Quit. Closing
  the main window destroys it to save memory; only **Quit** ends the app.
- Main window: Look up (autocomplete with ↑↓ / Tab / Enter / Esc, `/` to focus
  search), Saved (Recent or A–Z, remove), Settings, About
- The floating icon (off by default) is a small draggable button that floats
  above other windows. Left-click it to summon the bar, drag to snap it to a
  screen edge, right-click for Pin/Unpin, Hide and Settings

## Testing the packaged build

`npm run build` produces two Windows executables in `dist/`: a portable
`.exe` and an NSIS installer `.exe`. The portable one is a single
self-contained file: no install, no admin prompt. The installer is for a
proper install with a Start Menu shortcut and an uninstaller. Neither contains
the offline pack, the raw data, `tools/` or `docs/` (see `electron-builder.yml`).

## How it's built

- `main.js`: the main process. The only part with Node/OS access: windows,
  tray, global shortcuts, persisted settings, and wiring the lookup engine to
  the renderers. It owns all shared state (history, saved words, settings).
- `preload.js`: a small bridge exposing a fixed set of functions to the pages
  (`window.api`). Renderers cannot reach Node or the network directly.
- `src/engine/`: the lookup engine. `pack.js` reads the offline pack with
  Node's built-in `node:sqlite`; `mw.js` calls Merriam-Webster; `resolver.js`
  decides the order, normalizes results to one shape and keeps the daily call
  counter; `installer.js` downloads, verifies and installs packs.
- `src/bar/`: the summon bar renderer.
- `src/main-window/`: the main window renderer (look up, Saved, Settings,
  About).
- `src/floating-icon/`: the floating icon renderer.
- `src/fonts/`: Fraunces, Inter and JetBrains Mono (woff2) with their OFL
  licence files. Bundled locally; nothing loads from a CDN.
- `tools/`: build-time scripts (pack builder, release prep, dev lookup and
  tests). Not shipped.
- `docs/`: handoff spec, progress log, publishing steps, design file.
- All renderers are sandboxed webpages (`contextIsolation: true`,
  `nodeIntegration: false`).

### Tray lifecycle and memory

The app has no window of its own at startup: `main.js` creates the tray icon
in `app.whenReady()` and keeps running in the background. The summon bar stays
hidden-but-alive so it appears instantly. The main window is created on demand
and destroyed when closed, so it costs no RAM while the app idles. No window
closing ever quits the app (`window-all-closed` is ignored unless the tray's
**Quit** was used).

### Where settings, history and saved words live

`electron-store` (a JSON file) in the per-app data folder keeps the API key,
theme, lookup order, history (words only), saved words (words and dates only)
and the daily Merriam-Webster call count (a number and a date). Dictionary text
from Merriam-Webster is never written to disk. Saved-word definitions are read
live from the pack each time.

### External links

Links open in your browser only for HTTPS URLs on an allowlist:
services.fetchmate.tech, en.wiktionary.org, kaikki.org, dictionaryapi.com.
Pack downloads have their own separate allowlist (github.com and the
release-assets.githubusercontent.com host GitHub redirects assets to), checked
on every redirect hop.

## Licences and attribution

- **Dictionary data (offline pack):** from Wiktionary, written by Wiktionary
  contributors ([en.wiktionary.org](https://en.wiktionary.org)), as extracted by
  [kaikki.org](https://kaikki.org) (Tatu Ylonen, Wiktextract). Licensed
  **CC BY-SA 4.0** and **GFDL**. Packs are modified: trimmed and converted to
  SQLite. Packs stay under the same share-alike licence.
- **Word frequency:** suggestion ordering uses
  [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit
  Dave, derived from OpenSubtitles, CC BY-SA 4.0.
- **Merriam-Webster:** optional source via the Merriam-Webster Collegiate
  Dictionary API with your own key. Merriam-Webster content is never bundled
  or cached.
- **Fonts:** Fraunces, Inter and JetBrains Mono, SIL Open Font License 1.1
  (texts in `src/fonts/`).
- **Credit:** Built by [Fetchmate Chief Technologies](https://services.fetchmate.tech).

## Internals

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

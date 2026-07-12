# Curious Dictionary Desktop

A minimalist Windows dictionary app. Press a shortcut, a small search pill
appears at the top of your screen, type a word and hit Enter, get a
definition card. Press Escape or click away and it disappears — nothing
else on your desktop is touched.

This is Task 1: just the summon bar and lookup. No tray icon, settings,
or history yet.

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Add your Merriam-Webster API key:

   ```
   copy config.example.js config.js
   ```

   Then open `config.js` and paste your [Merriam-Webster Collegiate
   Dictionary API](https://dictionaryapi.com/) key in place of the
   placeholder. `config.js` is gitignored, so your key never gets committed.

3. Run it:

   ```
   npm start
   ```

## Using it

- **Ctrl+Shift+Space** — show the bar (focused and ready to type) or hide it
  if it's already open
- Type a word, press **Enter** to look it up
- **Escape**, or clicking anywhere outside the bar, hides it
- Hiding doesn't clear anything — summon it again and your last result is
  still there

## How it's built

- `main.js` — the main process. This is the only part of the app with
  access to Node/OS APIs: it creates the window, registers the global
  keyboard shortcut, and makes the Merriam-Webster API call.
- `preload.js` — a small bridge script that exposes exactly one thing to
  the page (`window.api`, with `lookupWord`, `hideBar`, etc.). The renderer
  can't reach Node or the network directly — it can only call these
  specific functions.
- `src/bar/` — the renderer: plain HTML/CSS/JS for the search pill and
  result card. It's a sandboxed webpage (`contextIsolation: true`,
  `nodeIntegration: false`) with no direct filesystem or network access.

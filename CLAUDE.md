# Curious Dictionary Desktop — working rules

Read README.md first. The repo is the source of truth.

## Goal
Add (a) an offline dictionary pack, (b) a main app window, (c) interlinking between the summon bar and the main window. Details in the task list; do ONE task at a time and stop after each for me to review (giv me steps to conduct the review each time).

## Hard rules
- NEVER launch, kill, relaunch, or send simulated input to the packaged exe after `npm run build`. Confirm builds by file existence and size only. I test the packaged exe by hand. (`npm start` during development is fine.)
- Never commit: API keys, config.js, the downloaded raw data (data/), or the built pack (*.db). Check .gitignore before every commit.
- Prefer sandboxed renderers: contextIsolation true, nodeIntegration false. New capabilities go through preload.js as a fixed set of functions.
- Avoid native npm modules unless there's no sane alternative (rebuild pain with Electron ABI). If one is needed, say so and explain before installing.
- Explain what you did and why in a few short lines after each task. I'm learning.
- Licensing: Merriam-Webster content must NEVER be bundled or bulk-cached. Offline pack uses open data only (Wiktionary via kaikki.org, CC BY-SA). Attribution must be shown in the app (About screen) and the README.

## Credit (required)
"Built by Fetchmate Chief Technologies" appears:
- in the main window footer
- on the Settings/About screen
- in the README
- and a subtle "by Fetchmate Chief Technologies" pill at the bottom of the summon bar
It links to https://services.fetchmate.tech. Open links via shell.openExternal, only for https URLs on an allowlist (services.fetchmate.tech, en.wiktionary.org, kaikki.org, dictionaryapi.com).

## Cross-cutting rules (added in handoff v2)
- Memory/RAM: the summon bar stays hidden-but-alive; the main window is DESTROYED on close (not hidden); the floating icon stays off by default; the pack is read through node:sqlite page by page, never loaded whole into memory.
- Measure step: after Task 3 and again after Task 6, record in docs/PROGRESS.md the app's total memory in Task Manager (Details tab, sum of the app's processes) with (a) idle in tray and (b) main window open with a word looked up. I provide the numbers; you write them down.
- Fonts bundled locally, OFL license files included, listed on the About screen.
- Packs are never bundled in the installer; they are downloaded on demand (see docs/PUBLISHING-PACKS.md).
- Credit remains: "Built by Fetchmate Chief Technologies" linking to https://services.fetchmate.tech in the main window footer, About screen and README.

## Where things are (added by Task 0)
- Task list and specs: docs/curious-offline-handoff.md (v2)
- Publishing packs: docs/PUBLISHING-PACKS.md
- Progress log / handoff between windows: docs/PROGRESS.md — read it at the start of every window, update it at the end of every task.
- UI design (the target): docs/design/curious-dictionary-desktop.dc.html

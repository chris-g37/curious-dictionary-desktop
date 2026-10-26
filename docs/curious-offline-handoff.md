# Curious Dictionary Desktop — Offline + Main Window: Claude Code Handoff (v2)

Repo: https://github.com/chris-g37/curious-dictionary-desktop
Branch: `offline-and-ui` (created from main in Task 0)
Design (the UI target): docs/design/curious-dictionary-desktop.dc.html
Progress log: docs/PROGRESS.md

## v2 changelog
- Packs are no longer bundled with the installer. They are published as assets on a rolling GitHub Release tagged `packs` and downloaded on demand (new Task 6; publishing steps in docs/PUBLISHING-PACKS.md).
- Task 1 gains `--profile core|full` and `--lang <code>` flags, no longer depends on FTS5, and writes `curious-<lang>-<profile>.db`.
- New Task 1b: `npm run pack:release` release-prep script (gzip, SHA-256, manifest.json, NOTICE.txt).
- Old Task 2 split in two: 2a Electron upgrade + node:sqlite smoke test (own commit, hand-tested), 2b resolver chain + source badge.
- Planning extras from the first window are now written into the tasks (limit states + MW call counter in 2b, local fonts in 3, bar Copy/Pin/History in 4, Settings/About as main-window panes in 5).
- New "Cross-cutting rules" section: memory/RAM rules, measure step, local fonts with OFL licenses, credit.
- Decisions A–C recorded (below). Design path updated to docs/design/.
- Task 2b pack path updated for the new file names; Task 7 output renamed to `curious-sn-<profile>.db`.

## Task order

| # | Task | Notes |
|---|---|---|
| 0 | Handoff system | done |
| 1 | Pack builder | needs kaikki file; flags below |
| 1b | Release-prep script | `npm run pack:release` (below) |
| 2a | Electron upgrade + node:sqlite smoke test | its own commit; Chris hand-tests shortcuts/clipboard/tray after |
| 2b | Resolver chain + source badge | includes limit states 2E/2F and a local daily MW call counter (a number only) |
| 3 | Main window (3A-3D, 3F autocomplete) | bundle Fraunces, Inter, JetBrains Mono locally; include their OFL license files |
| 4 | Interlinking + Saved (2A, 2B, 3E, 3G) | add Copy / Pin / History to the bar (they don't exist yet) |
| 5 | Settings / About (4A, 4B, 5A) + README | version 2.0.0; Settings and About become main-window panes; tray > Settings opens that pane; retire the old settings window |
| 6 | Offline pack DOWNLOAD (replaces "ship the pack") | text below |
| 7 | Shona experiment | report only |

## Decisions
- A) Settings and About are main-window panes (per design 4A/5A). Tray > Settings opens the main window on the Settings pane; the old separate settings window is retired in Task 5.
- B) Design-only settings (shortcut recording, double-click lookup, launch at startup) are skipped for now and logged in the PROGRESS.md backlog.
- C) The Electron upgrade happens as its own task (2a), before any code depends on node:sqlite.

## Cross-cutting rules (also in CLAUDE.md)
- Memory/RAM: the summon bar stays hidden-but-alive; the main window is DESTROYED on close (not hidden); the floating icon stays off by default; the pack is read through node:sqlite page by page, never loaded whole into memory.
- Measure step: after Task 3 and again after Task 6, record in PROGRESS.md the app's total memory in Task Manager (Details tab, sum of the app's processes) with (a) idle in tray and (b) main window open with a word looked up. Chris provides the numbers; Claude writes them down.
- Fonts are bundled locally, their OFL license files are included, and they are listed on the About screen.
- Credit remains: "Built by Fetchmate Chief Technologies" linking to https://services.fetchmate.tech in the main window footer, About screen and README.

---

## 0. CLAUDE.md (done in Task 0)

CLAUDE.md in the repo root carries the rules block below, plus a "where things are" section and the cross-cutting rules above.

```
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
It links to https://services.fetchmate.tech. Open links via shell.openExternal, only for https URLs on an allowlist (services.fetchmate.tech, en.wiktionary.org, kaikki.org, dictionaryapi.com). Do NOT put it in the summon bar (keep the bar clean).
```

---

## Task 1 — Pack builder (no app changes)

```
Task 1: build the offline pack builder. Do not touch the app's runtime code yet.

Create tools/build-pack.js (Node, no native modules if avoidable; if SQLite is needed use sql.js or node's built-in sqlite if the Node version running the builder supports it — tell me what you picked and why).

Flags:
- --profile core|full (default core)
  - core: lemmas only, max ~6 senses per entry, 1 example per sense, no etymology, no translations, no inflection tables.
  - full: all lemmas, more senses, etymology, up to 2 examples per sense.
  - Never store translations, sound-file metadata, or full form tables in either profile.
- --lang <code> (default en)

Input: a kaikki.org Wiktionary JSONL extract at data/kaikki-english.jsonl (I download it manually; it is large, so STREAM it line by line, never load it whole).
Output: dist-pack/curious-<lang>-<profile>.db, i.e. dist-pack/curious-en-core.db and dist-pack/curious-en-full.db

Requirements:
1. Keep only entries useful for a dictionary: lemma headwords, with part of speech, IPA pronunciation (if present), senses (gloss text), examples per the profile, and etymology text (full only). Skip: inflected-form-only entries ("form_of"/"alt_of" without own senses can be stored as redirects to the lemma), proper-noun clutter, entries with no gloss.
2. Schema: entries(word, word_lower, pos, ipa, etymology), senses(entry_id, idx, gloss, example), redirects(form, lemma). Do NOT depend on FTS5: autocomplete uses an indexed word_lower column with range/prefix queries (word_lower >= 'lim' AND word_lower < 'lin'). FTS5 is optional and only if the 2a smoke test proves it works in Electron.
3. Add a meta table: pack_id, language, profile, version (date-based, e.g. 2026.10.26), source ("Wiktionary via kaikki.org"), license ("CC BY-SA 4.0 / GFDL"), build_date, entry_count.
4. Print a summary at the end: entry count, file size, 5 random sample words. Sizes are targets we are measuring, not promises.
5. Add the pack output and data/ to .gitignore (done in Task 0 — verify).
6. Add a short tools/README.md explaining how to download the input and run the builder.

Test with a SMALL sample first (first 20,000 lines) and show me the summary before running the full file.
```

---

## Task 1b — Release-prep script

```
Task 1b: create tools/prepare-release.js and an npm script `npm run pack:release`.

- Reads every dist-pack/*.db.
- For each: gzip to dist-pack/release/<name>.db.gz, compute SHA-256 of BOTH the .db and the .gz, record sizes.
- Writes dist-pack/release/manifest.json:
  { "schema": 1, "packs": [ { "id", "language", "profile", "version" (date-based, e.g. 2026.10.26), "size_bytes" (uncompressed), "download_bytes", "sha256" (of the .db), "sha256_gz", "url" } ] }
  The url must be https://github.com/chris-g37/curious-dictionary-desktop/releases/download/packs/<file>.db.gz
  id/language/profile/version come from the pack's own meta table.
- Writes dist-pack/release/NOTICE.txt with the attribution text (Wiktionary contributors, kaikki.org / Tatu Ylonen, CC BY-SA 4.0 / GFDL, "modified: trimmed and converted to SQLite").
- Prints the exact upload commands from docs/PUBLISHING-PACKS.md at the end.
```

---

## Task 2a — Electron upgrade + node:sqlite smoke test (own commit)

```
Task 2a: upgrade Electron.

- Upgrade to a current stable Electron whose bundled Node is 22.5 or newer. Check the Electron release notes for the bundled Node version; don't guess.
- Smoke test by actually running require('node:sqlite') in the MAIN process under Electron: open a temp DB, create a table, insert, query; then try creating an FTS5 virtual table and report whether it works.
- Check that electron-store, electron-builder, the global shortcuts, the tray, and the clipboard-trick flow still run under `npm start`. Report anything that broke. Do not package or launch the exe.
- Log the result in PROGRESS.md and stop so I can hand-test.
```

---

## Task 2b — Resolver chain + source badge

```
Task 2b: add a resolver chain in a new file src/engine/resolver.js, used by main.js's lookup handler.

Order (configurable by a new setting `sourceMode`: "offline-first" default, or "online-first"):
- offline-first: local pack -> Merriam-Webster (only if a key exists and the pack had no hit)
- online-first: Merriam-Webster -> local pack as fallback on error/limit/no network

Return a NORMALIZED entry shape the renderers use regardless of source: { word, source: "offline"|"mw", sourceLabel, pronunciation, parts: [{pos, senses:[{text, example}]}], etymology? }.

The pack is read with node:sqlite (page by page, never loaded whole) from <userData>/packs/. That folder holds one English pack: curious-en-full.db or curious-en-core.db (use full if present, else core). Until Task 6 the pack is copied there by hand. If missing, offline source is simply unavailable, no crash.

Show the source in the bar result card footer as the source badge (design 2A/2B/2G: "Offline · Wiktionary" sage, "Merriam-Webster" terracotta), replacing the hardcoded MW footer. Preserve the existing "no entry / did you mean" state. For not-found offline, suggest near matches from the pack's prefix index (design 2D). Add the loading state (2C).

Limit states (design 2E/2F): keep a local daily counter of MW calls (a number and a date only, in electron-store). When MW says the limit is reached (or the counter hits 1,000), show 2E (fell back to pack) or 2F (no pack installed).

No MW responses are ever written to disk beyond the existing recent-history word list (words only, not definitions).
```

---

## Task 3 — Main window

```
Task 3: build the main window. The design is in docs/design/curious-dictionary-desktop.dc.html — sections "03 Main Window" (3A-3D, light/dark, recents + empty state) and 3F (autocomplete) are the target. Match fonts (Fraunces headwords, Inter UI, JetBrains Mono labels) and the cream/coffee/terracotta palette.

- New renderer in src/main-window/ ; window opens from the tray ("Open Curious"). Tray lifecycle stays as it is: closing the main window never quits the app. Closing DESTROYS the main window (not hide) to keep RAM low.
- Search box with autocomplete from the pack (prefix suggestions as you type, ↑↓ / Tab / Enter / Esc per 3F), result view reusing the normalized entry shape, Recent list (same electron-store history the bar uses), first-launch empty state (3C/3D).
- Fonts: bundle Fraunces, Inter and JetBrains Mono locally (woff2) with their OFL license files. No Google Fonts CDN.
- Footer line: "Built by Fetchmate Chief Technologies" linking to https://services.fetchmate.tech (via the allowlisted openExternal).
- Light/dark/system theme as already implemented.

Show me the window via `npm start`. Do not package. Then do the measure step (see Cross-cutting rules).
```

---

## Task 4 — Interlink bar and main window

```
Task 4: interlink.
- Bar result card: add Copy / Pin / History buttons (they don't exist yet) and an "Open in app" button (design 2A/2B). Open in app opens (or focuses) the main window on that word and hides the bar.
- Pin in the bar saves the word to a Saved list (electron-store, words only). Main window gets a Saved view with remove (design 3G; glosses are read live from the pack, MW-only words show no gloss). Both surfaces share the same history and saved list through main.js IPC.
- Main window result view gets the same Pin and Copy (design 3E).
- Single source of truth for state is the main process; renderers never keep their own copy.
```

---

## Task 5 — Settings, About, licensing

```
Task 5:
- Settings and About become panes in the main window (design 4A/4B/5A). Tray > Settings opens the main window on the Settings pane. Retire the old separate settings window (src/settings/).
- Settings: add "Dictionary source" (Offline first / Online first), and show pack status (installed? entry count, build date). Merriam-Webster key field becomes "optional — enables Merriam-Webster as a second source". Keep the existing theme, clear history and floating icon controls. Skip shortcut recording, double-click lookup and launch at startup (backlog).
- First-run without a key must work fully offline.
- About / Licenses pane: app version, "Built by Fetchmate Chief Technologies" (link to https://services.fetchmate.tech), and attributions: Wiktionary contributors + kaikki.org (Tatu Ylonen, Wiktextract), license CC BY-SA 4.0 / GFDL, Merriam-Webster API credit, and the bundled fonts (OFL).
- Bump the app version to 2.0.0.
- Update README.md: offline pack, how to build it (tools/README), source modes, credit, licenses.
```

---

## Task 6 — Offline pack download (replaces "ship the pack")

```
Task 6: offline pack download.
- Do NOT bundle packs in electron-builder. Confirm data/, dist-pack/, tools/, docs/ are excluded from the build.
- Manifest URL: https://github.com/chris-g37/curious-dictionary-desktop/releases/download/packs/manifest.json
- Settings > Offline pack pane: installed status (id, version, entry count), a "Download Core (X MB)" / "Download Full (X MB)" button with progress and cancel, and "Restore / re-download".
- Download to a temp file, verify SHA-256 against the manifest, gunzip to <userData>/packs/, then rename atomically. On any failure delete the temp file and show a clear error; never leave a half-written pack. Never overwrite a working pack until the new one verifies.
- Allowed hosts: https only; github.com plus the host GitHub redirects release assets to. Find that host by observing the actual redirect rather than guessing, and put it in the existing allowlist constant.
- Check for a newer pack version at most once a day and only show a quiet "Update available" in the pane; never auto-download.
- First run with no pack and no API key: a friendly full-window card, "Download the offline pack to get started".
- The packaged exe must still work with no pack installed (online-only mode if a key exists).
After `npm run build`, confirm artifacts by file existence and size only. Do NOT launch the exe.
Then do the measure step (see Cross-cutting rules).
```

---

## Task 7 — Shona experiment

```
Task 7: Shona pack experiment.
Input: data/kaikki-shona.jsonl (I download it). Run the same builder with --lang sn to produce dist-pack/curious-sn-<profile>.db (Shona -> English glosses). Report: entry count, how many have glosses, 15 random samples, and any quality problems you notice (missing glosses, odd formatting). Do NOT wire it into the app until I've looked at the report.
```

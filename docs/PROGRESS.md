# Progress log

The handoff between working windows. Start every window by reading
CLAUDE.md and this file; end every task by updating this file.

Kickoff message for a new window:
> Let's move forward. Read CLAUDE.md and docs/PROGRESS.md, then do the next task.

Specs for every task: docs/curious-offline-handoff.md (v2).
Publishing packs: docs/PUBLISHING-PACKS.md.

## Status

| # | Task | Status | Notes |
|---|---|---|---|
| 0 | Handoff system | done | |
| — | Handoff v2 amendment (docs only) | done | |
| 1 | Pack builder | done (sample verified) | full-file builds not run yet; Chris runs or approves them |
| 1b | Release-prep script | **next** | `npm run pack:release` |
| 2a | Electron upgrade + node:sqlite smoke test | pending | own commit; Chris hand-tests shortcuts/clipboard/tray after |
| 2b | Resolver chain + source badge | pending | limit states 2E/2F, local daily MW call counter (number only) |
| 3 | Main window (3A-3D, 3F autocomplete) | pending | local fonts + OFL licenses; then measure step |
| 4 | Interlinking + Saved (2A, 2B, 3E, 3G) | pending | add Copy / Pin / History to the bar |
| 5 | Settings / About (4A, 4B, 5A) + README | pending | version 2.0.0; panes in main window; retire old settings window |
| 6 | Offline pack download | pending | replaces "ship the pack"; then measure step |
| 7 | Shona experiment | pending | report only |

## Decisions
- A) Settings and About are main-window panes. Tray > Settings opens that pane; the old settings window is retired in Task 5.
- B) Design-only settings (shortcut recording, double-click lookup, launch at startup) are skipped and logged in the backlog below.
- C) The Electron upgrade is its own task (2a), before anything depends on node:sqlite. (Why: Electron 31.7.7, the current version, bundles Node 20, which has no `node:sqlite`.)
- D) Packs are downloaded on demand from the GitHub Release `packs`, never bundled in the installer.
- E) No FTS5 dependency: autocomplete uses an indexed `word_lower` column with prefix range queries.

## Memory measurements
Chris reads these from Task Manager (Details tab, sum of the app's processes); Claude records them.

| When | Idle in tray | Main window open + word looked up |
|---|---|---|
| After Task 3 | — | — |
| After Task 6 | — | — |

## Backlog (not scheduled)
- Keyboard shortcut recording in Settings (design 4A "Record").
- Double-click lookup (design 4A, marked Experimental).
- Launch at startup (design 4A).
- FTS5 search, only if the 2a smoke test shows it works.

## Task log

### Task 0 — Handoff system
- Branch `offline-and-ui` created from `main`.
- CLAUDE.md added (rules block from the handoff doc, plus a "where things are" section).
- Design file moved to docs/design/curious-dictionary-desktop.dc.html; handoff doc moved to docs/.
- .gitignore: added data/, dist-pack/, *.db.
- electron-builder.yml: excluded data/, dist-pack/, tools/, docs/ so raw data and packs never end up inside the installer.

### Handoff v2 amendment (docs only, no code)
- docs/curious-offline-handoff.md rewritten as v2 (changelog at top): new task order, decisions, cross-cutting rules, Task 1 flags, new Tasks 1b and 2a, Task 6 replaced with download-on-demand.
- docs/PUBLISHING-PACKS.md added.
- CLAUDE.md gained the cross-cutting rules (memory, measure step, fonts, credit).
- Small additions beyond the literal amendment, flag if unwanted: the pack meta table also stores `profile` and `version` (Task 1b's manifest reads them from there); Task 2b reads `<userData>/packs/curious-en-full.db` if present, else `-core.db`; Task 7 output is `curious-sn-<profile>.db`.
- Versioning: app goes straight to 2.0.0 in Task 5. Packs use date versions (2026.10.26) on their own `packs` release tag, independent of app versions.

### Task 1 — Pack builder
- Added tools/build-pack.js, tools/README.md, and npm script `pack:build`. Uses the system Node built-in `node:sqlite` (no npm dependency, nothing native).
- Flags: `--profile core|full`, `--lang`, plus `--input` and `--limit`. `--limit` runs write to dist-pack/sample/ so they can never be picked up as a real pack.
- Sample (first 20,000 lines): core 5.2 MB, full 11.2 MB, 15,644 entries each, 531 redirects.
- Choices to flag: sense labels like "(obsolete)" are prefixed into the gloss text; rare/obsolete senses sort last so core keeps common meanings; 2 examples (full) are newline-joined in `senses.example`; redirects are kept only when the form has no entry of its own and the lemma exists; skipped POS: name, character, symbol, punct; `meta` is key/value.
- Known gap: ~8 of 15k sample etymologies still carry a leftover tree line.
- Full 3.4 GB run NOT done yet.

## Notes for the next window (Task 1b)
- Task 1b needs real packs in dist-pack/*.db (not dist-pack/sample). Check they exist; if not, ask Chris to run `npm run pack:build -- --profile core` and `--profile full`, or test 1b against the sample files.

## Old notes (Task 1, done)
- Input file: `data/kaikki-english.jsonl` in the repo root (Chris downloads the English extract from kaikki.org/dictionary/English and renames it). Check it exists before starting; if not, stop and ask.
- Builder runs on the system Node (v24.13.1 at time of writing), which has `node:sqlite` built in, so no npm dependency is needed for the builder.
- Start with the first 20,000 lines and show the summary before the full run.

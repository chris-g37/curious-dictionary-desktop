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
| 1 | Pack builder | done | full core + full packs built; checked with tools/lookup.js |
| 1b | Release-prep script | done | `npm run pack:release`; not yet uploaded to GitHub |
| 2a | Electron upgrade + node:sqlite smoke test | done, passed Chris's hand-test | own commit; Chris hand-tests shortcuts/clipboard/tray after |
| 2b | Resolver chain + source badge | done, passed Chris's review | limit states 2E/2F, local daily MW call counter (number only) |
| 1c | Commonness ranking | done (option A), passed Chris's review | packs rebuilt as v2026.10.28 |
| 3 | Main window (3A-3D, 3F autocomplete) | done, reviewed and passed by Chris | measure step recorded (see table) |
| 4 | Interlinking + Saved (2A, 2B, 3E, 3G) | **next** | add Copy / Pin / History to the bar |
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
| After Task 3 | 224.1 MB (Electron, 3 processes) | 433.3 MB (Electron 3 procs 249.0 MB + Electron 6 procs 184.3 MB) |

Notes: read from Task Manager > Processes (grouped), under `npm start` (dev build, not the packaged exe). The two Electron groups in (b) are unexplained: one app should be a single group, so the 6-process group may be a second instance or a leftover; re-measure with the Details tab if the number matters.
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
- Full builds: core 140 MB, full 172 MB, 662,309 entries (612,178 distinct words), ~535k redirects, ~5 min each. Redirects dominate the size.
- Lookup review fixes: IPA missing closing slash (927 entries), redirects kept for inflections even if the form has its own entry (ran -> run), untagged "spelling of X" senses (colour -> color), heuristic dropping redirects to a much smaller entry (run no longer -> rin). tools/lookup.js added.
- Core and full differ by a few dozen redirects because the heuristic counts capped senses.
- Known weak spot: 1,383 entries still have a "spelling of" style sense kept as a normal definition if the link did not match; fine for now.

### Task 1b — Release-prep script
- Added tools/prepare-release.js and npm script `pack:release`. Gzips each top-level dist-pack/*.db (never sample/) into dist-pack/release/, hashes .db and .gz (streamed), writes manifest.json (schema 1) and NOTICE.txt, prints the upload commands. Output dir is cleared each run so stale files cannot be uploaded.
- Result: core 140.4 MB -> 65.1 MB gz, full 172.2 MB -> 76.3 MB gz, both v2026.10.26, ~80 s. Decompressed core gz hashes to the manifest sha256.
- NOTICE.txt also carries the Fetchmate credit line (small addition, flag if unwanted).

### Task 2a — Electron upgrade + node:sqlite smoke test
- Electron 31.7.7 -> 45.0.0 (latest stable; bundles Node 24.22.0, Chromium 156). electron-store 8.2.0 and electron-builder 26.18 unchanged. package.json and package-lock.json updated.
- Smoke test (tools/smoke-sqlite.js, run with `npx electron tools/smoke-sqlite.js`, runs as Electron main): node:sqlite works; create/insert/prefix range query OK; FTS5 also works (not needed, Decision E); the real core pack opens read-only and answers a prefix query.
- BREAK found and fixed: Electron 45's clipboard is async and W3C-shaped (readText/writeText return Promises; readHTML/availableFormats are gone). main.js captureClipboardSnapshot/restoreClipboardSnapshot rewritten with clipboard.read()/write() + ClipboardItem and awaited in handleSelectionHotkey. Round-trip (text+html, empty clipboard) verified with a probe.
- Checked under `npm start`: boots, bar + icon windows created, no JS errors. Chromium cache "Access is denied" log lines appeared because the INSTALLED Curious Dictionary was running at the same time (it also holds the global shortcuts, so shortcut registration could not be verified by me; I did not touch that process).
- Not verified by me, for Chris to hand-test: Ctrl+Shift+Space, Ctrl+Shift+D (select text in another app -> bar fills in, and your clipboard is unchanged afterwards), tray icon + menu, settings window, theme switch, history persists. Quit the installed app first.
- Not done: did not build or launch the packaged exe.

### Task 2b — Resolver chain + source badge
- New src/engine/: pack.js (node:sqlite reader: lookup with redirects, near-match suggestions), mw.js (MW fetch, normalized), resolver.js (offline-first / online-first, daily MW counter, limit states). main.js lookup-word now calls resolver.resolve; old lookupWord removed.
- Normalized entry: { word, source, sourceLabel, pronunciation, parts:[{pos,senses:[{text,example}]}], etymology?, redirectedFrom? }. Results also carry notice (2E / offline) and limit+noPack (2F).
- Pack path: <userData>/packs/ (full preferred, else core). Dev userData is %APPDATA%curious-dictionary-desktop; the INSTALLED app uses %APPDATA%Curious Dictionary, so a pack must be copied into whichever one is being run. I copied curious-en-core.db into the dev folder for testing.
- Setting sourceMode (store default "offline-first"); added a "Lookup order" toggle to the existing settings window so it can be tested (Task 5 moves it).
- MW call counter: store key mwCalls = { date (US Eastern), count }, nothing else. Pinned to 1,000 when MW reports the limit.
- Bar UI: sage/terracotta source badge replaces the hardcoded footer, loading skeleton (only if a lookup takes >150 ms), near-match list, 2E banner with counter, 2F card with Open settings. All dictionary text is now HTML-escaped. The bar shows at most 4 parts x 3 senses (full entry belongs to the main window).
- Tests: node tools/test-resolver.js (17 cases, fake fetch, real pack) all pass; app-level check under npm start via a probe: petrichor, ran->run, petrikor near-matches render correctly.
- UNVERIFIED / assumptions: MW's real over-quota response is undocumented; I treat HTTP 429 or a plain-text body mentioning limit/quota as the limit, plus the local 1,000 counter. Visual polish (screenshots) not checked by me; fonts are still system fallbacks until Task 3. Online-first and the MW path were only tested with a fake fetch, not the real API.
- Suggestions are prefix-based and unranked by commonness (petrikor offers "petrific, Petri net"...), which is what Task 1c is for.

### Task 1c — Commonness ranking: PROPOSAL ONLY (nothing implemented)
Experiment on a scratch copy of the core pack (not in the repo). Prefix results, best first:
- Current (no ranking): "pe" -> peacen, peachy, peahen; "con" -> coname, conapt, concat; "lim" -> limace, limbal.
- A (open frequency list): "pe" -> people, person, perfect, perhaps; "con" -> control, contact, continue; "ru" -> run, running, Rules; "ser" -> serious, service; "wor" -> work, world, worry.
- B (pack heuristic: 3 x POS entries + senses + 2 x examples): "pe" -> peel, pelt, pen, PEEP; "con" -> con, content, contract; "petr" -> petrochemical, petrohyoid, petromastoid (obscure).
A ranks far better. B is decent but promotes short/polysemous oddities and technical terms.
Option A source verified: hermitdave/FrequencyWords, content/2018/en/en_full.txt (20 MB, 1.66M words, OpenSubtitles 2018). The repo README states "MIT License for code. CC-by-sa-4.0 for content." (repo LICENSE file is MIT, covers code). CC BY-SA 4.0 matches the pack's own licence, so the pack stays CC BY-SA 4.0. Caveat: the list is derived from OpenSubtitles (OPUS) text; I verified the list's stated licence, not the upstream corpus terms.
Rejected: wordfreq (data CC BY-SA 4.0 per its README, but sunset with a ~2021 snapshot, no plain file, README discourages converting to CSV, SUBTLEX credit required).
Costs (core pack 140.4 MB): both tables together +12.8 MB; A has only 124,428 rows (of 612,178 pack words) so it is the small part, roughly a few MB (estimate); B has a row per word. Build time: A 4 s, B 22 s. Query time on a 1-letter prefix ("c") via a join was ~150 ms (A) and ~620 ms (B), so the real version should store the rank on the entries rows or an index and autocomplete should start at 2 letters.
Attribution if A is chosen: About screen + README + NOTICE.txt: "Word frequency data: FrequencyWords by Hermit Dave (github.com/hermitdave/FrequencyWords), derived from OpenSubtitles, CC BY-SA 4.0." Raw list goes in data/ (gitignored); builder gets a --freq flag; unlisted words sort last, alphabetically.
Recommendation: A. Words not in the list (the long tail, ~80% of pack words) would have no rank and sort last.

### Task 1c — implemented (option A)
- tools/build-pack.js: new `--freq <file>` (default data/freq-en.txt). Builds table `freq(word_lower, rank)` for pack words found in the list (124,428 ranked) and meta `freq_source`. Missing list = warning, unranked pack.
- List: hermitdave/FrequencyWords content/2018/en/en_full.txt saved as data/freq-en.txt (gitignored). tools/README.md documents the download.
- Both packs rebuilt: core 142.5 MB (+2.1), full 174.3 MB (+2.1), version 2026.10.28. pack:release re-run (gz 66.3 MB / 77.5 MB); NOTICE.txt now credits FrequencyWords. NOT yet uploaded to GitHub. The dev userData pack was refreshed to the new core.
- src/engine/pack.js: new complete(prefix, limit) (ranked words first, then unranked by length; needs 2+ letters; ~2 ms) used by suggest() for not-found near matches. Old packs without a freq table still work. Task 3 autocomplete should call complete().
- Results: pe -> people, person, perfect, perhaps, peace; con -> control, contact, continue; ru -> run, running, Rules; lim -> limit, limited, limb. Unranked words follow ranked ones.
- Tests: tools/test-resolver.js (18 cases) all pass.
- TODO for Task 5: README and About must credit "Word frequency data: FrequencyWords by Hermit Dave, derived from OpenSubtitles, CC BY-SA 4.0" (the README currently has no attribution section at all; Task 5 writes it).
- Caveat carried over: I verified the list's stated licence, not the upstream OpenSubtitles corpus terms.

### Task 3 — Main window
- New src/main-window/ (index.html, main.css, main.js). Opens from tray "Open Curious" (tray click still toggles the bar). Singleton; closing DESTROYS it (verified: window object gone, only bar + icon renderers remain). Window: 960x640, min 720x480, sandboxed, no navigation/new windows, CSP (no inline script/style), native frame with hidden menu bar.
- Fonts bundled locally in src/fonts/: Fraunces (normal+italic), Inter, JetBrains Mono, variable woff2 latin + latin-ext (~340 KB total) from the @fontsource-variable npm packages (v5.3.0), with OFL-*.txt licences. fonts.css holds the @font-face rules. About screen (Task 5) must list the three fonts. The bar window still uses system fonts (not changed).
- Sidebar: brand, Look up, offline pack status card (entry count, from pack meta). Saved / Settings / About items are NOT shown yet (Tasks 4/5) to avoid dead buttons.
- Search + autocomplete: pack.complete() via IPC complete-word, 2+ letters, ghost completion, Tab completes, ↑↓ move, Enter opens (highlighted row, else typed text), Esc closes list then clears, "/" focuses. Results: full entry (all parts and senses, examples, Origin when the pack has etymology), source badge, Copy button (text via IPC copy-text), not-found with near matches, limit states, loading skeleton. Recents grouped Today / Yesterday / Earlier (max 20 shown, same electron-store history as the bar), refreshed live when the bar looks something up. First-launch welcome (3C/3D) shows when history is empty.
- main.js: openExternal now an HTTPS host allowlist (services.fetchmate.tech, en.wiktionary.org, kaikki.org, dictionaryapi.com), as CLAUDE.md says. New IPC: complete-word, get-pack-status, get-history, copy-text, history-changed event.
- Checked with probes under Electron (light + dark, screenshots): fonts load, autocomplete, result, not-found, recents, hero; tray item opens the window and close destroys it.
- Deviations to flag: native title bar instead of the design's custom one; no Saved item yet; "Open Curious" is only reachable from the tray menu.
- MEASURE STEP (recorded below): Chris reads Task Manager > Details, sum of the app's processes, for (a) idle in tray and (b) main window open with a word looked up, and gives me the numbers to record here.

| When | Idle in tray | Main window open + word looked up |
|---|---|---|
| After Task 3 | — | — |

## Notes for the next window (Task 4)
- Record the measure numbers first if Chris has them. Then Task 4 (interlink + Saved).

## Old notes (Task 1, done)
- Input file: `data/kaikki-english.jsonl` in the repo root (Chris downloads the English extract from kaikki.org/dictionary/English and renames it). Check it exists before starting; if not, stop and ask.
- Builder runs on the system Node (v24.13.1 at time of writing), which has `node:sqlite` built in, so no npm dependency is needed for the builder.
- Start with the first 20,000 lines and show the summary before the full run.

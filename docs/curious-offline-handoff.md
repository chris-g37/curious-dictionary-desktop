# Curious Dictionary Desktop — Offline + Main Window: Claude Code Handoff

Repo: https://github.com/chris-g37/curious-dictionary-desktop
Branch: `offline-and-ui` (create from main)

---

## 0. Paste this into CLAUDE.md in the repo root (once)

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

Create tools/build-pack.js (Node, no native modules if avoidable; if SQLite is needed use sql.js or node's built-in sqlite if the Electron/Node version here supports it — tell me what you picked and why).

Input: a kaikki.org Wiktionary JSONL extract at data/kaikki-english.jsonl (I download it manually; it is large, so STREAM it line by line, never load it whole). 
Output: dist-pack/curious-en.db

Requirements:
1. Keep only entries useful for a dictionary: lemma headwords, with part of speech, IPA pronunciation (if present), senses (gloss text), up to 2 example sentences per sense, and etymology text. Skip: inflected-form-only entries ("form_of"/"alt_of" without own senses can be stored as redirects to the lemma), proper-noun clutter, entries with no gloss.
2. Schema: entries(word, pos, ipa, etymology), senses(entry_id, idx, gloss, example), redirects(form, lemma). Add an FTS5 table or a sorted prefix index for autocomplete. If sql.js lacks FTS5, use a simple indexed `word_lower` column with LIKE 'prefix%'.
3. Add a meta table: pack_id, language, source ("Wiktionary via kaikki.org"), license ("CC BY-SA 4.0 / GFDL"), build_date, entry_count.
4. Print a summary at the end: entry count, file size, 5 random sample words.
5. Add the pack output and data/ to .gitignore.
6. Add a short tools/README.md explaining how to download the input and run the builder.

Test with a SMALL sample first (first 20,000 lines) and show me the summary before running the full file.
```

---

## Task 2 — Resolver chain + source badge

```
Task 2: add a resolver chain in a new file src/engine/resolver.js, used by main.js's lookup handler.

Order (configurable by a new setting `sourceMode`: "offline-first" default, or "online-first"):
- offline-first: local pack -> Merriam-Webster (only if a key exists and the pack had no hit) 
- online-first: Merriam-Webster -> local pack as fallback on error/limit/no network

Return a NORMALIZED entry shape the renderers use regardless of source: { word, source: "offline"|"mw", sourceLabel, pronunciation, parts: [{pos, senses:[{text, example}]}], etymology? }.

The pack is loaded from <userData>/packs/curious-en.db (if missing, offline source is simply unavailable, no crash). Show the source in the bar result card footer ("Offline · Wiktionary" or "Via Merriam-Webster"), replacing the hardcoded MW footer. Preserve the existing "no entry / did you mean" and "limit reached" states. For not-found offline, suggest near matches from the pack's prefix index.

No MW responses are ever written to disk beyond the existing recent-history word list (words only, not definitions).
```

---

## Task 3 — Main window

```
Task 3: build the main window. The design is in the Claude Design file curious-dictionary-desktop.dc.html — sections "03 Main Window" (3A-3D, light/dark, recents + empty state) are the target. Match fonts (Fraunces headwords, Inter UI) and the cream/coffee/terracotta palette.

- New renderer in src/main-window/ ; window opens from the tray ("Open Curious") and on app launch only if no window state says otherwise (tray lifecycle must stay as it is: closing it hides/closes without quitting).
- Search box with autocomplete from the pack (prefix suggestions as you type), result view reusing the normalized entry shape, Recent list (same electron-store history the bar uses).
- Footer line: "Built by Fetchmate Chief Technologies" linking to https://services.fetchmate.tech (via the allowlisted openExternal).
- Light/dark/system theme as already implemented.

Show me the window via `npm start`. Do not package.
```

---

## Task 4 — Interlink bar and main window

```
Task 4: interlink.
- Bar result card: add an "Open in app" button next to Copy / Pin / History. It opens (or focuses) the main window on that word and hides the bar.
- Pin in the bar saves the word to a Saved list (electron-store). Main window gets a Saved view with remove. Both surfaces share the same history and saved list through main.js IPC.
- Main window result view gets the same Pin and Copy.
- Single source of truth for state is the main process; renderers never keep their own copy.
```

---

## Task 5 — Settings, About, licensing

```
Task 5:
- Settings: add "Dictionary source" (Offline first / Online first), and show pack status (installed? entry count, build date). Merriam-Webster key field becomes "optional — enables Merriam-Webster as a second source".
- First-run without a key must work fully offline.
- Add an About / Licenses screen: app version, "Built by Fetchmate Chief Technologies" (link to https://services.fetchmate.tech), and attributions: Wiktionary contributors + kaikki.org (Tatu Ylonen, Wiktextract), license CC BY-SA 4.0 / GFDL, and Merriam-Webster API credit.
- Update README.md: offline pack, how to build it (tools/README), source modes, credit, licenses.
```

---

## Task 6 — Packaging the pack (watch the BSOD rule)

```
Task 6: make the pack ship with the app.
- Option A: bundle dist-pack/curious-en.db via electron-builder extraResources and copy to <userData>/packs on first run. 
- Option B: leave it out of the installer and add a "Download offline pack" button in Settings that fetches from a GitHub Release asset URL I'll provide.
Implement A first. After `npm run build`, confirm artifacts only by file existence and size. Do NOT launch the exe.
```

---

## Task 7 — Shona experiment

```
Task 7: Shona pack experiment.
Input: data/kaikki-shona.jsonl (I download it). Run the same builder with a --lang flag to produce dist-pack/curious-sn.db (Shona -> English glosses). Report: entry count, how many have glosses, 15 random samples, and any quality problems you notice (missing glosses, odd formatting). Do NOT wire it into the app until I've looked at the report.
```

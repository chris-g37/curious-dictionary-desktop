# Tools

Build-time scripts. None of this ships inside the app (see `electron-builder.yml`).

## Dev lookup (`lookup.js`)

`node tools/lookup.js ran colour petrichor` prints what `dist-pack/curious-en-core.db` returns, following redirects. `--pack <file>` picks another pack.

## Pack builder (`build-pack.js`)

Turns a kaikki.org Wiktionary extract into a compact SQLite dictionary pack.

### 1. Download the input

1. Go to https://kaikki.org/dictionary/English/ and download the full English
   extract (the "Download raw data (JSONL)" link — a single file of about 3 GB).
2. Save it as `data/kaikki-english.jsonl` in the repo root. `data/` is
   gitignored; never commit it.

For another language, download that language's extract and either name it
`data/kaikki-<lang>.jsonl` or pass `--input`.

### 2. Run it

Needs Node 22.5 or newer (it uses the built-in `node:sqlite`; no npm install).

```
node tools/build-pack.js --profile core
node tools/build-pack.js --profile full
```

Or `npm run pack:build -- --profile full`.

| Flag | Default | Meaning |
|---|---|---|
| `--profile core\|full` | `core` | core: up to 6 senses, 1 example each, no etymology. full: up to 20 senses, 2 examples each, etymology. |
| `--lang <code>` | `en` | Language code to keep (matches kaikki's `lang_code`). |
| `--input <file>` | `data/kaikki-english.jsonl` | Input JSONL. |
| `--limit <n>` | off | Read only the first n lines. Output goes to `dist-pack/sample/` so it can't be mistaken for a real pack. |

Try a small run first: `node tools/build-pack.js --limit 20000`.

Output: `dist-pack/curious-<lang>-<profile>.db` (gitignored).

### Schema

- `meta(key, value)`: pack_id, language, profile, version, source, license, build_date, entry_count, schema_version.
- `entries(id, word, word_lower, pos, ipa, etymology)`: one row per word + part of speech (+ etymology).
- `senses(entry_id, idx, gloss, example)`: ordered definitions. With 2 examples (full), `example` holds them separated by a newline.
- `redirects(form, lemma)`: "form of" pointers, e.g. `ran` -> `run`, `colour` -> `color`. Kept even when the form has its own entry (`ran` is also a noun), so a lookup should show the redirect first, then the word's own entries. Rare/dialect forms and redirects to a much smaller entry are dropped (this is why `run` does not point at Scots `rin`).

Autocomplete: `WHERE word_lower >= 'lim' AND word_lower < 'lin'` on the indexed `word_lower` column. No FTS5.

Never stored: translations, sound-file metadata, inflection tables.

### Licence

The data is Wiktionary content (CC BY-SA 4.0 / GFDL) as extracted by kaikki.org.
Packs are modified (trimmed, converted to SQLite); the app's About screen and
README carry the attribution.

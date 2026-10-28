// Offline pack builder. Streams a kaikki.org Wiktionary JSONL extract line by
// line and writes a compact SQLite dictionary the app can read later.
//
//   node tools/build-pack.js [--profile core|full] [--lang en]
//                            [--input <file>] [--freq <file>] [--limit <lines>]
//
// Uses node:sqlite (built into Node 22.5+), so there is no npm dependency and
// nothing native to rebuild. This runs on the system Node, not inside Electron.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "..");

// ---- Profiles --------------------------------------------------------------
// Never stored in either profile: translations, sound-file metadata, form
// tables. We only ever read the fields named below, so they can't leak in.
const PROFILES = {
  core: { maxSenses: 6, maxExamples: 1, etymology: false },
  full: { maxSenses: 20, maxExamples: 2, etymology: true },
};

// Parts of speech that are clutter for a dictionary lookup tool.
const SKIP_POS = new Set(["name", "character", "symbol", "punct"]);

// Senses with these tags are real but rarely what someone wants; they sort to
// the end so the core profile's sense cap keeps the common meanings.
const LOW_PRIORITY_TAGS = new Set([
  "obsolete",
  "archaic",
  "rare",
  "dated",
  "nonstandard",
  "misspelling",
  "proscribed",
]);

// Tags worth showing as a "(label)" before a gloss. Everything else (grammar
// tags like "transitive", regions like "Yorkshire") is dropped to keep it tidy.
const LABEL_TAGS = new Set([
  "obsolete",
  "archaic",
  "rare",
  "dated",
  "slang",
  "informal",
  "colloquial",
  "vulgar",
  "offensive",
  "derogatory",
  "figuratively",
  "humorous",
  "literary",
  "poetic",
  "formal",
  "historical",
  "euphemistic",
  "UK",
  "US",
  "Australia",
  "Canada",
  "Ireland",
  "Scotland",
]);

const PROSE_START =
  /^(From|Borrowed|Learned|Inherited|Compound|Clipping|Abbreviation|Shortened|Back-formation|Blend|Ultimately|Of |Probably|Possibly|Uncertain|Unknown|Imitative|Onomatopoeic|Coined|Alteration|Calque|Cognate|Equivalent|Apparently|Derived|Variant|Contraction|Initialism|Acronym|Doublet|See |Related|Perhaps|Originally|Either|Likely|Uncertainly|Cf\.|Mostly|Extended|Semantic|Shortening|Pronunciation spelling)\b/;

const MAX_EXAMPLE_CHARS = 300;
const MAX_ETYMOLOGY_CHARS = 1500;
const BATCH = 50000; // rows per transaction

// ---- Args ------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { profile: "core", lang: "en", input: null, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--profile") opts.profile = next();
    else if (a === "--lang") opts.lang = next();
    else if (a === "--input") opts.input = next();
    else if (a === "--freq") opts.freq = next();
    else if (a === "--limit") opts.limit = parseInt(next(), 10);
    else fail(`Unknown argument: ${a}`);
  }
  if (!PROFILES[opts.profile]) fail("--profile must be core or full");
  if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(opts.lang)) fail("--lang looks wrong");
  if (!(opts.limit >= 0)) fail("--limit must be a number");
  if (!opts.freq) opts.freq = path.join(ROOT, "data", `freq-${opts.lang}.txt`);
  if (!opts.input) {
    const name = opts.lang === "en" ? "english" : opts.lang;
    opts.input = path.join(ROOT, "data", `kaikki-${name}.jsonl`);
  }
  return opts;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ---- Extraction helpers ----------------------------------------------------
function pickIpa(sounds) {
  if (!Array.isArray(sounds)) return null;
  const withIpa = sounds.filter((s) => s && typeof s.ipa === "string" && s.ipa);
  if (!withIpa.length) return null;
  // Prefer a US/General American reading, otherwise the first one listed.
  const us = withIpa.find((s) =>
    (s.tags || []).some((t) => /^(US|General-American)$/.test(t))
  );
  let ipa = (us || withIpa[0]).ipa;
  // Wiktionary sometimes splits "/a.b-c/ ~ /a.b-d/" across entries, leaving
  // "/a.b" with no closing slash. Close it.
  if (ipa.startsWith("/") && !ipa.endsWith("/")) ipa += "/";
  return ipa;
}

function glossOf(sense) {
  const glosses = sense.glosses;
  if (!Array.isArray(glosses) || !glosses.length) return null;
  const tags = sense.tags || [];
  if (tags.includes("no-gloss") || tags.includes("empty-gloss")) return null;
  // Nested senses arrive as [parent, child]; the child is the specific one.
  const text = String(glosses[glosses.length - 1]).trim();
  if (!text) return null;
  const labels = tags.filter((t) => LABEL_TAGS.has(t));
  return labels.length ? `(${labels.join(", ")}) ${text}` : text;
}

function examplesOf(sense, max) {
  if (!Array.isArray(sense.examples)) return [];
  const out = [];
  for (const ex of sense.examples) {
    // "quotation" entries are long cited passages with references; skip them.
    if (!ex || ex.type === "quotation" || ex.ref) continue;
    const text = typeof ex.text === "string" ? ex.text.trim() : "";
    if (!text || text.length > MAX_EXAMPLE_CHARS) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

// Some etymology_text values start with a flattened "Etymology tree" dump
// (one ancestor per line) before the real prose. Drop it.
function cleanEtymology(text) {
  if (typeof text !== "string") return null;
  let t = text.trim();
  if (t.startsWith("Etymology tree")) {
    const lines = t.split("\n");
    // Prose usually opens with "From ...", "Borrowed from ...", etc. Failing
    // that, assume the last line is the prose.
    let start = lines.findIndex((l, i) => i > 0 && PROSE_START.test(l));
    if (start === -1) start = lines.length - 1;
    t = lines.slice(start).join("\n").trim();
  }
  if (!t) return null;
  return t.length > MAX_ETYMOLOGY_CHARS ? t.slice(0, MAX_ETYMOLOGY_CHARS) + "…" : t;
}

// A sense that only says "form of X" / "alternative spelling of X".
function redirectTarget(sense) {
  const ref = (sense.form_of && sense.form_of[0]) || (sense.alt_of && sense.alt_of[0]);
  if (ref && typeof ref.word === "string") return ref.word;
  // Some "spelling of color" senses are tagged alt-of/form-of but carry no
  // target field; the gloss links the lemma last, so use that.
  const tags = sense.tags || [];
  if ((tags.includes("alt-of") || tags.includes("form-of")) && Array.isArray(sense.links)) {
    const last = sense.links[sense.links.length - 1];
    if (last && typeof last[1] === "string") return last[1].split("#")[0] || null;
  }
  // Untagged ones ("Commonwealth spelling of color."): gloss ends with the
  // last linked word.
  const g = sense.glosses && sense.glosses.length === 1 ? sense.glosses[0] : "";
  const m = /\b(?:spelling|spellings|variant|alternative form|form)\s+of\s+([^\s.;,]+)\.?$/i.exec(g);
  if (m && Array.isArray(sense.links) && sense.links.length) {
    const last = sense.links[sense.links.length - 1];
    if (last && last[0] === m[1] && typeof last[1] === "string") return last[1].split("#")[0] || null;
  }
  return null;
}

// ---- Main ------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const profile = PROFILES[opts.profile];

  if (!fs.existsSync(opts.input)) {
    fail(`Input not found: ${opts.input}\nSee tools/README.md for how to download it.`);
  }

  // Sample runs (--limit) go to a subfolder so they can never be mistaken for,
  // or picked up as, a real pack.
  const outDir = path.join(ROOT, "dist-pack", opts.limit ? "sample" : "");
  fs.mkdirSync(outDir, { recursive: true });
  const packId = `curious-${opts.lang}-${opts.profile}`;
  const outFile = path.join(outDir, `${packId}.db`);
  const tmpFile = outFile + ".tmp";
  for (const f of [tmpFile, tmpFile + "-journal"]) fs.rmSync(f, { force: true });

  const db = new DatabaseSync(tmpFile);
  // It's a throwaway build file, so trade crash-safety for speed.
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      word TEXT NOT NULL,
      word_lower TEXT NOT NULL,
      pos TEXT NOT NULL,
      ipa TEXT,
      etymology TEXT
    );
    CREATE TABLE senses (
      entry_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      gloss TEXT NOT NULL,
      example TEXT
    );
    CREATE TABLE redirects (form TEXT NOT NULL, lemma TEXT NOT NULL, low INTEGER NOT NULL);
  `);

  const insEntry = db.prepare(
    "INSERT INTO entries (word, word_lower, pos, ipa, etymology) VALUES (?, ?, ?, ?, ?)"
  );
  const insSense = db.prepare(
    "INSERT INTO senses (entry_id, idx, gloss, example) VALUES (?, ?, ?, ?)"
  );
  const insRedirect = db.prepare("INSERT INTO redirects (form, lemma, low) VALUES (?, ?, ?)");

  const stats = { lines: 0, wrongLang: 0, skippedPos: 0, noGloss: 0, badJson: 0 };
  let pending = 0;
  db.exec("BEGIN");

  const rl = readline.createInterface({
    input: fs.createReadStream(opts.input, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  const started = Date.now();
  for await (const line of rl) {
    if (!line) continue;
    if (opts.limit && stats.lines >= opts.limit) break;
    stats.lines++;

    let e;
    try {
      e = JSON.parse(line);
    } catch {
      stats.badJson++;
      continue;
    }
    if (e.lang_code !== opts.lang) {
      stats.wrongLang++;
      continue;
    }
    if (typeof e.word !== "string" || !e.word || SKIP_POS.has(e.pos)) {
      stats.skippedPos++;
      continue;
    }

    // Split senses into real definitions vs. "form of X" pointers.
    const real = [];
    for (const s of e.senses || []) {
      const target = redirectTarget(s);
      if (target) {
        // Recorded even when the word has its own senses ("ran" is a noun
        // AND the past tense of "run"). Rare/dialect forms are pruned below.
        if (target !== e.word) {
          const low = (s.tags || []).some((t) => LOW_PRIORITY_TAGS.has(t) || t === "dialectal" || t === "pronunciation-spelling");
          insRedirect.run(e.word, target, low ? 1 : 0);
          pending++;
        }
        continue;
      }
      const gloss = glossOf(s);
      if (!gloss) continue;
      const low = (s.tags || []).some((t) => LOW_PRIORITY_TAGS.has(t));
      real.push({ gloss, examples: examplesOf(s, profile.maxExamples), low });
    }

    if (!real.length) {
      // No definitions of its own; any redirects were recorded above.
      if (!(e.senses || []).some(redirectTarget)) stats.noGloss++;
    } else {
      // Stable sort: rare/obsolete senses go last, original order otherwise.
      real.sort((a, b) => Number(a.low) - Number(b.low));
      const kept = real.slice(0, profile.maxSenses);
      const { lastInsertRowid: id } = insEntry.run(
        e.word,
        e.word.toLowerCase(),
        e.pos || "",
        pickIpa(e.sounds),
        profile.etymology ? cleanEtymology(e.etymology_text) : null
      );
      kept.forEach((s, i) => {
        // Several examples are newline-separated in the one example column.
        insSense.run(id, i, s.gloss, s.examples.length ? s.examples.join("\n") : null);
      });
      pending += 1 + kept.length;
    }

    if (pending >= BATCH) {
      db.exec("COMMIT; BEGIN");
      pending = 0;
    }
    if (stats.lines % 250000 === 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`  ${stats.lines.toLocaleString()} lines read (${mins} min)`);
    }
  }
  db.exec("COMMIT");

  // Redirects: keep inflections of common words even when the form has its
  // own entry ("ran" -> "run"), but drop rare/dialect ones in that case, and
  // any pointing at a lemma that isn't in the pack.
  db.exec(`CREATE INDEX idx_entries_word ON entries(word)`);
  db.exec(`
    DELETE FROM redirects WHERE low = 1 AND form IN (SELECT word FROM entries);
    DELETE FROM redirects WHERE lemma NOT IN (SELECT word FROM entries);
    CREATE INDEX idx_senses_entry ON senses(entry_id, idx);
    -- Heuristic: "run" is technically the past participle of Scots "rin", but
    -- pointing there is useless. If the form has its own entries and the
    -- target is much smaller than the form, the redirect is dropped.
    CREATE TEMP TABLE wc AS
      SELECT e.word AS word, COUNT(*) AS n
      FROM entries e JOIN senses s ON s.entry_id = e.id GROUP BY e.word;
    CREATE UNIQUE INDEX temp.idx_wc ON wc(word);
    DELETE FROM redirects WHERE form IN (SELECT word FROM wc) AND
      2 * COALESCE((SELECT n FROM wc WHERE word = redirects.lemma), 0)
        < (SELECT n FROM wc WHERE word = redirects.form);
    DROP TABLE temp.wc;
    CREATE TABLE redirects_dedup AS SELECT DISTINCT form, lemma FROM redirects;
    DROP TABLE redirects;
    ALTER TABLE redirects_dedup RENAME TO redirects;
    DROP INDEX idx_entries_word;
  `);

  // Indexes: word_lower drives autocomplete (prefix range queries) and lookup.
  db.exec(`
    CREATE INDEX idx_entries_word_lower ON entries(word_lower);
    CREATE INDEX idx_redirects_form ON redirects(form);
  `);

  // Commonness rank (see tools/README.md): one row per ranked word, so
  // autocomplete can order a prefix range by everyday-ness. Words not in the
  // list simply have no row and sort after ranked ones.
  let freqRows = 0;
  if (fs.existsSync(opts.freq)) {
    db.exec("CREATE TABLE freq (word_lower TEXT PRIMARY KEY, rank INTEGER NOT NULL) WITHOUT ROWID");
    const insFreq = db.prepare("INSERT OR IGNORE INTO freq (word_lower, rank) VALUES (?, ?)");
    const isWord = db.prepare("SELECT 1 FROM entries WHERE word_lower = ? LIMIT 1");
    let rank = 0;
    db.exec("BEGIN");
    for (const line of fs.readFileSync(opts.freq, "utf8").split("\n")) {
      const word = line.split(" ")[0].toLowerCase();
      if (!word) continue;
      rank++;
      if (isWord.get(word)) insFreq.run(word, rank);
    }
    db.exec("COMMIT");
    freqRows = db.prepare("SELECT COUNT(*) AS n FROM freq").get().n;
  } else {
    console.log(`\nWARNING: no frequency list at ${opts.freq}; autocomplete will be unranked.`);
  }

  const count = (sql) => db.prepare(sql).get().n;
  const entryCount = count("SELECT COUNT(*) AS n FROM entries");
  const senseCount = count("SELECT COUNT(*) AS n FROM senses");
  const redirectCount = count("SELECT COUNT(*) AS n FROM redirects");
  const distinctWords = count("SELECT COUNT(DISTINCT word_lower) AS n FROM entries");

  const now = new Date();
  const version = now.toISOString().slice(0, 10).replace(/-/g, ".");
  const meta = {
    schema_version: "1",
    pack_id: packId,
    language: opts.lang,
    profile: opts.profile,
    version,
    source: "Wiktionary via kaikki.org",
    license: "CC BY-SA 4.0 / GFDL",
    build_date: now.toISOString(),
    entry_count: String(entryCount),
    freq_source: freqRows ? "FrequencyWords (Hermit Dave), from OpenSubtitles, CC BY-SA 4.0" : "",
  };
  const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);

  db.exec("VACUUM");
  db.close();

  fs.rmSync(outFile, { force: true });
  fs.renameSync(tmpFile, outFile);

  // ---- Summary -------------------------------------------------------------
  const sizeMB = (fs.statSync(outFile).size / 1048576).toFixed(1);
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log("");
  console.log(`Pack:        ${packId}  (version ${version})`);
  console.log(`File:        ${outFile}`);
  console.log(`Size:        ${sizeMB} MB`);
  console.log(`Entries:     ${entryCount.toLocaleString()}  (${distinctWords.toLocaleString()} distinct words)`);
  console.log(`Senses:      ${senseCount.toLocaleString()}`);
  console.log(`Redirects:   ${redirectCount.toLocaleString()}`);
  console.log(`Ranked:      ${freqRows.toLocaleString()} words`);
  console.log(
    `Lines read:  ${stats.lines.toLocaleString()}  (other language ${stats.wrongLang}, skipped POS ${stats.skippedPos}, no gloss ${stats.noGloss}, bad JSON ${stats.badJson})`
  );
  console.log(`Time:        ${secs}s`);

  const check = new DatabaseSync(outFile, { readOnly: true });
  const samples = check
    .prepare(
      `SELECT e.id, e.word, e.pos, e.ipa FROM entries e ORDER BY RANDOM() LIMIT 5`
    )
    .all();
  console.log("\n5 random entries:");
  for (const s of samples) {
    const first = check
      .prepare("SELECT gloss FROM senses WHERE entry_id = ? ORDER BY idx LIMIT 1")
      .get(s.id);
    console.log(`  ${s.word} (${s.pos})${s.ipa ? " " + s.ipa : ""} - ${first ? first.gloss : ""}`);
  }
  check.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

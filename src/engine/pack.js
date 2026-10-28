// Reads the offline dictionary pack (see tools/build-pack.js for the schema).
// node:sqlite pages the file in as needed, so the pack is never loaded whole
// into memory. The handle is opened on first use and reopened if the pack file
// changes (e.g. full pack installed over core).
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SOURCE_LABEL = "Offline · Wiktionary";
const MAX_SUGGESTIONS = 5;

// Prefers the full pack, falls back to core. Returns null if neither exists.
function findPackFile(packDir) {
  for (const name of ["curious-en-full.db", "curious-en-core.db"]) {
    const file = path.join(packDir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function createPack(getPackDir) {
  let db = null;
  let openFile = null;
  let stmts = null;

  // Returns the prepared statements, or null when no usable pack is installed.
  function open() {
    const file = findPackFile(getPackDir());
    if (file !== openFile) {
      close();
      if (file) {
        try {
          db = new DatabaseSync(file, { readOnly: true });
          const hasTable = (name) =>
            db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
          stmts = {
            byWord: db.prepare("SELECT id, word, pos, ipa, etymology FROM entries WHERE word_lower = ? ORDER BY id"),
            senses: db.prepare("SELECT gloss, example FROM senses WHERE entry_id = ? ORDER BY idx"),
            redirects: db.prepare("SELECT DISTINCT lemma FROM redirects WHERE form = ? OR form = ?"),
            // Packs built before the ranking existed have no freq table.
            ranked: hasTable("freq")
              ? db.prepare(
                  "SELECT word_lower FROM freq WHERE word_lower >= ? AND word_lower < ? ORDER BY rank LIMIT ?"
                )
              : null,
            display: db.prepare("SELECT word, pos FROM entries WHERE word_lower = ? ORDER BY id LIMIT 1"),
            range: db.prepare(
              `SELECT MIN(word) AS word, MIN(pos) AS pos FROM entries
               WHERE word_lower >= ? AND word_lower < ?
               GROUP BY word_lower
               ORDER BY ABS(LENGTH(word_lower) - ?), word_lower
               LIMIT ?`
            ),
          };
        } catch (err) {
          // Corrupt or half-copied file: behave as if no pack were installed.
          close();
          return null;
        }
      }
      openFile = file;
    }
    return stmts;
  }

  function close() {
    if (db) {
      try {
        db.close();
      } catch (err) {
        // Already closed; nothing to do.
      }
    }
    db = null;
    stmts = null;
    openFile = null;
  }

  function isAvailable() {
    return open() !== null;
  }

  // Exact lookup. Inflections first ("ran" -> run), then the word's own
  // entries, as tools/lookup.js does. Returns a normalized entry or null.
  function lookup(word) {
    const q = open();
    if (!q) return null;
    const lower = word.toLowerCase();

    const lemmas = q.redirects.all(word, lower).map((r) => r.lemma);
    const rows = [];
    const seen = new Set();
    for (const lemma of lemmas) {
      for (const row of q.byWord.all(lemma.toLowerCase())) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          rows.push(row);
        }
      }
    }
    for (const row of q.byWord.all(lower)) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        rows.push(row);
      }
    }
    if (rows.length === 0) return null;

    const parts = rows.map((row) => ({
      pos: row.pos,
      senses: q.senses.all(row.id).map((s) => ({
        text: s.gloss,
        example: s.example ? s.example.split("\n")[0] : null,
      })),
    }));

    const entry = {
      word: rows[0].word,
      source: "offline",
      sourceLabel: SOURCE_LABEL,
      pronunciation: (rows.find((r) => r.ipa) || {}).ipa || null,
      parts,
    };
    const etymology = (rows.find((r) => r.etymology) || {}).etymology;
    if (etymology) entry.etymology = etymology;
    if (lemmas.length > 0 && rows[0].word.toLowerCase() !== lower) {
      entry.redirectedFrom = word;
    }
    return entry;
  }

  // Words starting with `prefix` (already lowercase): everyday words by the
  // pack's frequency rank first, then unranked words of similar length.
  // [{ word, pos }]. Used for autocomplete (Task 3) and near matches.
  function complete(prefix, limit = MAX_SUGGESTIONS) {
    const q = open();
    if (!q || prefix.length < 2) return [];
    const hi = prefix + "￿";
    const out = [];
    const seen = new Set();
    if (q.ranked) {
      for (const { word_lower } of q.ranked.all(prefix, hi, limit)) {
        const row = q.display.get(word_lower);
        if (row) {
          seen.add(word_lower);
          out.push({ word: row.word, pos: row.pos });
        }
      }
    }
    if (out.length < limit) {
      // Over-fetch so words already taken from the ranked list can be skipped.
      for (const row of q.range.all(prefix, hi, prefix.length, limit * 2)) {
        if (out.length >= limit) break;
        if (!seen.has(row.word.toLowerCase())) out.push({ word: row.word, pos: row.pos });
      }
    }
    return out;
  }

  // Near matches for a word that was not found: the longest prefix (up to 6
  // letters, shorter than the word) that has any entries wins.
  function suggest(word) {
    const lower = word.toLowerCase();
    for (let len = Math.min(lower.length - 1, 6); len >= 2; len--) {
      const out = complete(lower.slice(0, len));
      if (out.length > 0) return out;
    }
    return [];
  }

  return { isAvailable, lookup, suggest, complete, close };
}

module.exports = { createPack, SOURCE_LABEL };

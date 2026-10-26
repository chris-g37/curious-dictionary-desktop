// Dev tool: print what a pack returns for a word, following redirects.
//   node tools/lookup.js <word> [more words...] [--pack <file>]
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const args = process.argv.slice(2);
let packFile = path.join(__dirname, "..", "dist-pack", "curious-en-core.db");
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--pack") packFile = path.resolve(args[++i]);
  else words.push(args[i]);
}
if (!words.length) {
  console.error("usage: node tools/lookup.js <word> [more words...] [--pack <file>]");
  process.exit(1);
}

const db = new DatabaseSync(packFile, { readOnly: true });
const byWord = db.prepare("SELECT * FROM entries WHERE word_lower = ? ORDER BY id");
const senses = db.prepare("SELECT gloss, example FROM senses WHERE entry_id = ? ORDER BY idx");
const redirects = db.prepare("SELECT lemma FROM redirects WHERE form = ?");
const nearby = db.prepare(
  "SELECT DISTINCT word FROM entries WHERE word_lower >= ? AND word_lower < ? ORDER BY word_lower LIMIT 5"
);

function show(entries) {
  for (const e of entries) {
    console.log(`  ${e.word} (${e.pos})${e.ipa ? "  " + e.ipa : ""}`);
    for (const [i, s] of senses.all(e.id).entries()) {
      console.log(`    ${i + 1}. ${s.gloss}`);
      if (s.example) console.log(`       e.g. ${s.example.split("\n").join(" | ")}`);
    }
    if (e.etymology) console.log(`    etymology: ${e.etymology}`);
  }
}

for (const w of words) {
  const q = w.toLowerCase();
  console.log(`\n== ${w}`);
  const direct = byWord.all(q);
  const lemmas = redirects.all(w).map((r) => r.lemma);
  // Inflections first ("ran" -> run), then the word's own entries.
  for (const lemma of lemmas) {
    console.log(`  -> form of "${lemma}"`);
    show(byWord.all(lemma.toLowerCase()));
  }
  if (direct.length) {
    if (lemmas.length) console.log(`  (also its own entries)`);
    show(direct);
    continue;
  }
  if (lemmas.length) continue;
  const near = nearby.all(q.slice(0, 3), q.slice(0, 2) + String.fromCharCode(q.charCodeAt(2) + 1));
  console.log(`  not found${near.length ? "; nearby: " + near.map((n) => n.word).join(", ") : ""}`);
}
db.close();

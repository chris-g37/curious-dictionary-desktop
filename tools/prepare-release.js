// Release prep for offline packs. Gzips every dist-pack/*.db, hashes both
// files, and writes manifest.json + NOTICE.txt into dist-pack/release/.
//
//   node tools/prepare-release.js
//
// Streams everything (nothing is loaded whole into memory). Uses the system
// Node's built-in node:sqlite to read each pack's meta table.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "..");
const PACK_DIR = path.join(ROOT, "dist-pack");
const OUT_DIR = path.join(PACK_DIR, "release");
const REPO = "chris-g37/curious-dictionary-desktop";
const URL_BASE = `https://github.com/${REPO}/releases/download/packs/`;

const mb = (n) => (n / 1048576).toFixed(1) + " MB";

function readMeta(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const meta = {};
    for (const r of db.prepare("SELECT key, value FROM meta").all()) meta[r.key] = r.value;
    return meta;
  } finally {
    db.close();
  }
}

async function sha256(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

async function main() {
  // Top-level only: dist-pack/sample/ is never released.
  const dbs = fs
    .readdirSync(PACK_DIR)
    .filter((f) => f.endsWith(".db"))
    .sort();
  if (!dbs.length) {
    console.error("No dist-pack/*.db found. Run: npm run pack:build -- --profile core");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Drop stale output so old packs can't sneak into an upload.
  for (const f of fs.readdirSync(OUT_DIR)) fs.rmSync(path.join(OUT_DIR, f), { force: true });

  const packs = [];
  for (const name of dbs) {
    const src = path.join(PACK_DIR, name);
    const meta = readMeta(src);
    for (const k of ["pack_id", "language", "profile", "version"]) {
      if (!meta[k]) throw new Error(`${name}: meta table is missing "${k}"`);
    }

    const gzName = name + ".gz";
    const gzPath = path.join(OUT_DIR, gzName);
    console.log(`${name}: compressing...`);
    await pipeline(
      fs.createReadStream(src),
      zlib.createGzip({ level: 9 }),
      fs.createWriteStream(gzPath)
    );

    const [shaDb, shaGz] = await Promise.all([sha256(src), sha256(gzPath)]);
    const entry = {
      id: meta.pack_id,
      language: meta.language,
      profile: meta.profile,
      version: meta.version,
      size_bytes: fs.statSync(src).size,
      download_bytes: fs.statSync(gzPath).size,
      sha256: shaDb,
      sha256_gz: shaGz,
      url: URL_BASE + gzName,
    };
    packs.push(entry);
    console.log(
      `  ${mb(entry.size_bytes)} -> ${mb(entry.download_bytes)} gz  (v${entry.version})\n` +
        `  sha256     ${shaDb}\n  sha256_gz  ${shaGz}`
    );
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify({ schema: 1, packs }, null, 2) + "\n"
  );

  fs.writeFileSync(
    path.join(OUT_DIR, "NOTICE.txt"),
    [
      "Curious Dictionary offline packs - attribution",
      "",
      "The dictionary data in these packs comes from Wiktionary, the free",
      "dictionary, written by Wiktionary contributors (https://en.wiktionary.org),",
      "as extracted by kaikki.org (Tatu Ylonen, https://kaikki.org).",
      "",
      "License: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0) and",
      "GNU Free Documentation License (GFDL).",
      "https://creativecommons.org/licenses/by-sa/4.0/",
      "",
      "Modified: the data was trimmed (fewer senses and examples, translations,",
      "sound files and inflection tables removed) and converted to SQLite.",
      "The packs remain under the same license (share-alike).",
      "",
      "Built by Fetchmate Chief Technologies - https://services.fetchmate.tech",
      "",
    ].join("\n")
  );

  console.log(`\nWrote ${path.relative(ROOT, OUT_DIR)}${path.sep}: ${packs.length} pack(s), manifest.json, NOTICE.txt`);
  console.log(`
Next (needs gh installed and logged in; see docs/PUBLISHING-PACKS.md):

  gh release upload packs dist-pack/release/* --repo ${REPO} --clobber

Then check:
  ${URL_BASE}manifest.json
  Get-FileHash -Algorithm SHA256 .\\<file>.db.gz   (compare with sha256_gz)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

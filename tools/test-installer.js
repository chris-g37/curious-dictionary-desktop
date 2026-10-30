// Dev check for src/engine/installer.js, no network and no Electron:
//   node tools/test-installer.js
// Builds tiny fake packs, serves them through a fake fetch (including the
// github.com -> release-assets redirect) and tries the failure paths.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { createInstaller, validateManifest } = require("../src/engine/installer");
const { createPack } = require("../src/engine/pack");

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "curious-inst-"));
let n = 0;

function makePackFile(id, version, junk = 0) {
  const file = path.join(tmpRoot, `src-${n++}.db`);
  const [, lang, profile] = id.match(/^curious-([a-z]+)-(core|full)$/);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE entries (id INTEGER PRIMARY KEY, word TEXT, word_lower TEXT, pos TEXT, ipa TEXT, etymology TEXT);
    CREATE TABLE senses (entry_id INTEGER, idx INTEGER, gloss TEXT, example TEXT);
    CREATE TABLE redirects (form TEXT, lemma TEXT);`);
  const ins = db.prepare("INSERT INTO meta VALUES (?, ?)");
  for (const [k, v] of Object.entries({ pack_id: id, language: lang, profile, version, entry_count: "1" })) ins.run(k, v);
  db.exec("INSERT INTO entries VALUES (1,'word','word','noun',NULL,NULL); INSERT INTO senses VALUES (1,0,'a unit of language',NULL)");
  if (junk) db.prepare("INSERT INTO meta VALUES ('junk', ?)").run(crypto.randomBytes(junk).toString("hex"));
  db.close();
  const raw = fs.readFileSync(file);
  const gz = zlib.gzipSync(raw);
  return { raw, gz };
}

// A fake "GitHub": manifest + assets, with the real redirect shape.
function makeServer(packs, { tamperGz = false, slow = false, evilRedirect = false } = {}) {
  const files = new Map();
  const manifest = { schema: 1, packs: [] };
  for (const p of packs) {
    const { raw, gz } = makeFiles(p);
    const name = `${p.id}.db.gz`;
    files.set(name, gz);
    manifest.packs.push({
      id: p.id,
      language: "en",
      profile: p.id.endsWith("core") ? "core" : "full",
      version: p.version,
      size_bytes: raw.length,
      download_bytes: gz.length,
      sha256: p.badDbHash ? "0".repeat(64) : sha(raw),
      sha256_gz: sha(gz),
      url: `https://github.com/chris-g37/curious-dictionary-desktop/releases/download/packs/${name}`,
    });
  }
  function makeFiles(p) {
    return makePackFile(p.innerId || p.id, p.innerVersion || p.version, slow ? 100000 : 0);
  }
  const log = [];
  const body = (buf, delayed) =>
    new ReadableStream({
      async start(controller) {
        const size = 4096;
        for (let i = 0; i < buf.length; i += size) {
          if (delayed) await new Promise((r) => setTimeout(r, 30));
          controller.enqueue(new Uint8Array(buf.subarray(i, i + size)));
        }
        controller.close();
      },
    });
  const fetchFn = async (url, opts = {}) => {
    log.push(url);
    const u = new URL(url);
    const respond = (status, buf, headers = {}) => ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k) => headers[k.toLowerCase()] || null },
      body: buf ? body(buf, slow) : null,
    });
    if (u.pathname.endsWith("manifest.json")) return respond(200, Buffer.from(JSON.stringify(manifest)));
    if (u.hostname === "github.com") {
      const loc = evilRedirect ? "https://evil.example.com/x" : `https://release-assets.githubusercontent.com/blob/${path.basename(u.pathname)}`;
      return respond(302, null, { location: loc });
    }
    if (u.hostname === "release-assets.githubusercontent.com") {
      let buf = files.get(path.basename(u.pathname));
      if (tamperGz) buf = Buffer.concat([buf.subarray(0, buf.length - 1), Buffer.from([buf[buf.length - 1] ^ 1])]);
      return respond(200, buf);
    }
    throw new Error("unexpected host " + u.hostname);
  };
  return { fetchFn, manifest, log };
}

function setup(server, existing) {
  const dir = path.join(tmpRoot, `packs-${n++}`);
  fs.mkdirSync(dir);
  if (existing) fs.writeFileSync(path.join(dir, existing.name), existing.content);
  const data = {};
  const store = { get: (k) => data[k], set: (k, v) => (data[k] = v) };
  const pack = createPack(() => dir);
  const events = [];
  const inst = createInstaller({ getPackDir: () => dir, pack, store, fetchFn: server.fetchFn, onProgress: (s) => events.push(s.status) });
  return { dir, store, pack, inst, events, files: () => fs.readdirSync(dir).sort() };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("download core: verified, installed, redirect followed, usable", async () => {
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28" }]));
  const r = await s.inst.download("core");
  assert(r.ok, r.error);
  assert.deepStrictEqual(s.files(), ["curious-en-core.db"]);
  assert.strictEqual(s.pack.lookup("word").parts[0].senses[0].text, "a unit of language");
  assert(s.events.includes("downloading") && s.events.includes("verifying") && s.events.includes("installing"));
  assert.strictEqual(s.events.at(-1), "idle");
});

test("manifest filters http / unknown host / bad ids", async () => {
  const good = { id: "curious-en-core", language: "en", profile: "core", version: "2026.10.28", size_bytes: 10, download_bytes: 5, sha256: "a".repeat(64), sha256_gz: "b".repeat(64), url: "https://github.com/x/curious-en-core.db.gz" };
  const packs = validateManifest({ schema: 1, packs: [good, { ...good, url: "http://github.com/x" }, { ...good, url: "https://evil.example.com/x" }, { ...good, id: "../../evil", profile: "core" }, { ...good, sha256: "zz" }] });
  assert.strictEqual(packs.length, 1);
});

test("tampered download is rejected and a working pack is untouched", async () => {
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28" }], { tamperGz: true }), { name: "curious-en-core.db", content: "OLD-WORKING-PACK" });
  const r = await s.inst.download("core");
  assert(!r.ok && /checksum/.test(r.error), r.error);
  assert.deepStrictEqual(s.files(), ["curious-en-core.db"]);
  assert.strictEqual(fs.readFileSync(path.join(s.dir, "curious-en-core.db"), "utf8"), "OLD-WORKING-PACK");
});

test("unpacked hash mismatch is rejected, no temp files left", async () => {
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28", badDbHash: true }]));
  const r = await s.inst.download("core");
  assert(!r.ok && /checksum/.test(r.error), r.error);
  assert.deepStrictEqual(s.files(), []);
});

test("pack that names a different id/version is rejected", async () => {
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28", innerVersion: "2020.01.01" }]));
  const r = await s.inst.download("core");
  assert(!r.ok && /identify/.test(r.error), r.error);
  assert.deepStrictEqual(s.files(), []);
});

test("redirect to a host that is not allowlisted is blocked", async () => {
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28" }], { evilRedirect: true }));
  const r = await s.inst.download("core");
  assert(!r.ok && /unexpected address/.test(r.error), r.error);
  assert.deepStrictEqual(s.files(), []);
});

test("cancel mid-download cleans up and keeps the old pack", async () => {
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28" }], { slow: true }), { name: "curious-en-core.db", content: "OLD" });
  const p = s.inst.download("core");
  await new Promise((r) => setTimeout(r, 150));
  assert(s.inst.isBusy());
  s.inst.cancel();
  const r = await p;
  assert(r.cancelled, JSON.stringify(r));
  assert.deepStrictEqual(s.files(), ["curious-en-core.db"]);
  assert(!s.inst.isBusy());
});

test("installing core replaces full so one English pack remains", async () => {
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28" }]), { name: "curious-en-full.db", content: "OLD-FULL" });
  const r = await s.inst.download("core");
  assert(r.ok, r.error);
  assert.deepStrictEqual(s.files(), ["curious-en-core.db"]);
});

test("re-download over an installed pack works while the pack was open", async () => {
  const server = makeServer([{ id: "curious-en-core", version: "2026.10.28" }]);
  const s = setup(server);
  assert((await s.inst.download("core")).ok);
  assert(s.pack.lookup("word")); // handle now open on the installed file
  assert((await s.inst.download("core")).ok);
  assert(s.pack.lookup("word"));
});

test("stale temp files are cleaned up", async () => {
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28" }]));
  fs.writeFileSync(path.join(s.dir, ".curious-en-core.part"), "x");
  fs.writeFileSync(path.join(s.dir, ".curious-en-core.tmp"), "x");
  s.inst.cleanupStale();
  assert.deepStrictEqual(s.files(), []);
});

test("update check: at most once a day, quiet, never downloads", async () => {
  const server = makeServer([{ id: "curious-en-core", version: "2026.11.05" }]);
  const s = setup(makeServer([{ id: "curious-en-core", version: "2026.10.28" }]));
  assert((await s.inst.download("core")).ok);
  // Point a second installer at a newer manifest.
  const newer = createInstaller({ getPackDir: () => s.dir, pack: s.pack, store: s.store, fetchFn: server.fetchFn });
  s.store.set("packCheck", { checkedAt: Date.now(), latest: { "curious-en-core": "2026.10.28" } });
  assert.strictEqual(await newer.checkForUpdate(), null);
  assert.strictEqual(server.log.length, 0, "no network within a day");
  s.store.set("packCheck", { checkedAt: Date.now() - 25 * 3600 * 1000, latest: {} });
  const upd = await newer.checkForUpdate();
  assert.deepStrictEqual(upd, { id: "curious-en-core", version: "2026.11.05" });
  assert.strictEqual(server.log.length, 1);
  assert.deepStrictEqual(fs.readdirSync(s.dir).sort(), ["curious-en-core.db"]);
  // Offline: still quiet.
  const dead = createInstaller({ getPackDir: () => s.dir, pack: s.pack, store: s.store, fetchFn: async () => { throw new Error("offline"); } });
  s.store.set("packCheck", { checkedAt: 0, latest: {} });
  assert.strictEqual(await dead.checkForUpdate(), null);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log("PASS ", name);
    } catch (e) {
      failed++;
      console.log("FAIL ", name, "->", e.message);
    }
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (err) {
    // Windows may still hold a pack handle; the OS temp folder is fine.
  }
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();

// Smoke test: does node:sqlite work in Electron's MAIN process?
//
//   npx electron tools/smoke-sqlite.js [path/to/pack.db]
//
// Electron runs this file as its main script (instead of main.js), so it is a
// real Electron main process but never touches the app itself. Prints a report
// and quits. Dev tool only; not shipped (tools/ is excluded from the build).
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

function step(name, fn) {
  try {
    const out = fn();
    console.log(`PASS  ${name}${out !== undefined ? "  -> " + out : ""}`);
    return true;
  } catch (e) {
    console.log(`FAIL  ${name}  -> ${e.message}`);
    return false;
  }
}

app.whenReady().then(() => {
  console.log(`Electron ${process.versions.electron}, Node ${process.versions.node}, Chromium ${process.versions.chrome}`);

  let DatabaseSync;
  if (!step("require('node:sqlite')", () => ((DatabaseSync = require("node:sqlite").DatabaseSync), typeof DatabaseSync))) {
    return app.exit(1);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curious-smoke-"));
  const file = path.join(dir, "t.db");
  let ok = true;
  const db = new DatabaseSync(file);
  ok &= step("create table + insert + query", () => {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, w TEXT); CREATE INDEX t_w ON t(w)");
    const ins = db.prepare("INSERT INTO t (w) VALUES (?)");
    for (const w of ["lima", "limb", "lime", "limp", "line"]) ins.run(w);
    return db.prepare("SELECT w FROM t WHERE w >= 'lim' AND w < 'lin' ORDER BY w").all().map((r) => r.w).join(",");
  });
  // Informational only: the app does not depend on FTS5 (Decision E).
  const fts = step("FTS5 virtual table (informational)", () => {
    db.exec("CREATE VIRTUAL TABLE f USING fts5(x)");
    db.exec("INSERT INTO f (x) VALUES ('hello world')");
    return db.prepare("SELECT count(*) AS n FROM f WHERE f MATCH 'hello'").get().n + " match";
  });
  db.close();

  const packPath = process.argv[2] || path.join(__dirname, "..", "dist-pack", "curious-en-core.db");
  if (fs.existsSync(packPath)) {
    ok &= step(`open real pack read-only (${path.basename(packPath)})`, () => {
      const p = new DatabaseSync(packPath, { readOnly: true });
      const meta = p.prepare("SELECT value FROM meta WHERE key='version'").get().value;
      const row = p.prepare("SELECT word, pos FROM entries WHERE word_lower = 'run' LIMIT 1").get();
      const n = p.prepare("SELECT COUNT(*) AS n FROM entries WHERE word_lower >= 'lim' AND word_lower < 'lin'").get().n;
      p.close();
      return `v${meta}, run=${row && row.pos}, 'lim*' prefix rows=${n}`;
    });
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nResult: node:sqlite ${ok ? "WORKS" : "HAS PROBLEMS"} in the main process; FTS5 ${fts ? "available" : "NOT available"}.`);
  app.exit(ok ? 0 : 1);
});

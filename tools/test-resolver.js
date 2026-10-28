// Dev check for src/engine/resolver.js, no Electron needed:
//   node tools/test-resolver.js
// Uses the real pack in dist-pack/ (full preferred) and a fake MW fetch.
const assert = require("assert");
const path = require("path");
const { createPack } = require("../src/engine/pack");
const { createResolver, DAILY_LIMIT } = require("../src/engine/resolver");

const PACK_DIR = path.join(__dirname, "..", "dist-pack");
const EMPTY_DIR = path.join(__dirname, "..", "dist-pack", "does-not-exist");

const mwEntry = [{ meta: {}, hwi: { hw: "ve*loc*i*ty", prs: [{ mw: "və-ˈläs-ət-ē" }] }, fl: "noun", shortdef: ["speed {it}of motion"] }];
const respond = (body, status = 200) => async () => ({
  ok: status < 400,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

function setup({ packDir = PACK_DIR, key = "k", mode = "offline-first", fetchFn, calls } = {}) {
  const data = {};
  const store = { get: (k) => data[k], set: (k, v) => (data[k] = v) };
  let n = 0;
  const counted = async (...a) => (n++, (fetchFn || respond(mwEntry))(...a));
  const pack = createPack(() => packDir);
  const r = createResolver({ pack, store, getApiKey: () => key, getSourceMode: () => mode, fetchFn: counted });
  return { r, store, pack, mwCalls: () => n };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("offline-first: pack hit never calls MW", async () => {
  const s = setup();
  const res = await s.r.resolve("petrichor");
  assert(res.found && res.entry.source === "offline");
  assert.strictEqual(s.mwCalls(), 0);
  assert(res.entry.parts[0].senses[0].text);
});

test("offline-first: redirect (ran -> run)", async () => {
  const res = await setup().r.resolve("ran");
  assert.strictEqual(res.entry.word, "run");
  assert.strictEqual(res.entry.redirectedFrom, "ran");
});

test("offline-first: case-insensitive", async () => {
  const res = await setup().r.resolve("Petrichor");
  assert(res.found);
});

test("offline-first: pack miss falls to MW", async () => {
  const s = setup();
  const res = await s.r.resolve("zzzzqx");
  assert(res.found && res.entry.source === "mw");
  assert.strictEqual(res.entry.pronunciation, "\\və-ˈläs-ət-ē\\");
  assert.strictEqual(res.entry.word, "ve·loc·i·ty");
  assert.strictEqual(res.entry.parts[0].senses[0].text, "speed of motion");
  assert.strictEqual(s.mwCalls(), 1);
  assert.strictEqual(s.r.mwCallsToday(), 1);
});

test("offline-first: no key, pack miss -> near matches", async () => {
  const res = await setup({ key: "" }).r.resolve("petrikor");
  assert(!res.found && res.source === "offline");
  assert(res.suggestions.length > 0, "expected near matches");
  console.log("      near petrikor:", res.suggestions.map((s) => s.word).join(", "));
});

test("suggestions favour everyday words", async () => {
  const s = setup({ key: "" });
  const top = (w) => s.pack.complete(w).map((x) => x.word.toLowerCase());
  assert(top("pe").includes("people"), "pe: " + top("pe"));
  assert(top("con").includes("control"), "con: " + top("con"));
  assert(top("lim").slice(0, 3).includes("limit"), "lim: " + top("lim"));
  console.log("      pe:", top("pe").join(", "), "| con:", top("con").join(", "));
});

test("not found in both: pack suggestions", async () => {
  const s = setup({ fetchFn: respond(["alpha", "beta"]) });
  const res = await s.r.resolve("zzzzqx");
  assert(!res.found && res.source === "offline");
});

test("no pack: MW not-found keeps MW suggestions", async () => {
  const s = setup({ packDir: EMPTY_DIR, fetchFn: respond(["alpha", "beta"]) });
  const res = await s.r.resolve("zzzzqx");
  assert(!res.found && res.source === "mw");
  assert.deepStrictEqual(res.suggestions.map((x) => x.word), ["alpha", "beta"]);
});

test("no pack, no key: friendly error", async () => {
  const res = await setup({ packDir: EMPTY_DIR, key: "" }).r.resolve("x");
  assert(!res.ok && /pack/.test(res.error));
});

test("online-first: MW answers, pack untouched", async () => {
  const res = await setup({ mode: "online-first" }).r.resolve("petrichor");
  assert(res.found && res.entry.source === "mw");
});

test("online-first: network error falls back to pack with notice", async () => {
  const s = setup({ mode: "online-first", fetchFn: async () => { throw new Error("offline"); } });
  const res = await s.r.resolve("petrichor");
  assert(res.found && res.entry.source === "offline" && res.notice.kind === "offline");
});

test("online-first: 429 -> 2E notice and counter pinned at the limit", async () => {
  const s = setup({ mode: "online-first", fetchFn: respond("", 429) });
  const res = await s.r.resolve("petrichor");
  assert(res.found && res.notice.kind === "limit" && res.notice.count === DAILY_LIMIT);
  assert.strictEqual(s.r.mwCallsToday(), DAILY_LIMIT);
  // Next lookup must not call MW at all.
  const before = s.mwCalls();
  await s.r.resolve("petrichor");
  assert.strictEqual(s.mwCalls(), before);
});

test("limit + no pack -> 2F", async () => {
  const s = setup({ packDir: EMPTY_DIR, mode: "online-first", fetchFn: respond("", 429) });
  const res = await s.r.resolve("anything");
  assert(res.ok && res.limit && res.noPack);
});

test("limit + pack miss -> not-found card carrying the 2E notice", async () => {
  const s = setup({ mode: "online-first", fetchFn: respond("", 429) });
  const res = await s.r.resolve("zzzzqx");
  assert(!res.found && res.notice && res.notice.kind === "limit");
});

test("counter at 1,000 blocks MW in offline-first too", async () => {
  const s = setup();
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  s.store.set("mwCalls", { date: d, count: DAILY_LIMIT });
  const res = await s.r.resolve("zzzzqx");
  assert(!res.found && res.notice.kind === "limit");
  assert.strictEqual(s.mwCalls(), 0);
});

test("counter resets on a new day", async () => {
  const s = setup();
  s.store.set("mwCalls", { date: "2000-01-01", count: 999 });
  assert.strictEqual(s.r.mwCallsToday(), 0);
});

test("stored counter holds only a date and a number", async () => {
  const s = setup();
  await s.r.resolve("zzzzqx");
  assert.deepStrictEqual(Object.keys(s.store.get("mwCalls")).sort(), ["count", "date"]);
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
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();

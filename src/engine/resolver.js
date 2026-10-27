// Resolver chain: decides which source answers a lookup and returns one
// normalized result for the renderers, whatever the source.
//
//   offline-first (default): pack -> Merriam-Webster (only on a pack miss)
//   online-first:            Merriam-Webster -> pack as fallback
//
// Result shapes (all have ok):
//   { ok: false, error }
//   { ok: true, found: true, entry, notice? }
//   { ok: true, found: false, word, source, sourceLabel, suggestions: [{word, pos?}], notice? }
//   { ok: true, limit: true, noPack: true, count, max }          (design 2F)
// `notice` is { kind: "limit" | "offline", text, count?, max? }  (design 2E).
const { lookupMw, SOURCE_LABEL: MW_LABEL } = require("./mw");
const { SOURCE_LABEL: PACK_LABEL } = require("./pack");

const DAILY_LIMIT = 1000;

// MW's quota resets at midnight US Eastern, so the counter's "day" does too.
function todayET() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// store: electron-store-like { get, set }. Only a number and a date are kept.
function createCounter(store) {
  function read() {
    const saved = store.get("mwCalls") || {};
    const today = todayET();
    return { date: today, count: saved.date === today ? saved.count || 0 : 0 };
  }
  return {
    count: () => read().count,
    increment() {
      const c = read();
      store.set("mwCalls", { date: c.date, count: c.count + 1 });
    },
    markExhausted() {
      const c = read();
      store.set("mwCalls", { date: c.date, count: Math.max(c.count, DAILY_LIMIT) });
    },
  };
}

function createResolver({ pack, store, getApiKey, getSourceMode, fetchFn }) {
  const counter = createCounter(store);
  const shownCount = () => Math.min(counter.count(), DAILY_LIMIT);

  const packNotFound = (word, notice) => ({
    ok: true,
    found: false,
    word,
    source: "offline",
    sourceLabel: PACK_LABEL,
    suggestions: pack.suggest(word),
    ...(notice ? { notice } : {}),
  });

  const mwNotFound = (word, r) => ({
    ok: true,
    found: false,
    word,
    source: "mw",
    sourceLabel: MW_LABEL,
    suggestions: r.suggestions.map((w) => ({ word: w })),
  });

  const limitNotice = () => ({
    kind: "limit",
    text: "Merriam-Webster daily limit reached. Showing the offline entry. Resets at midnight ET.",
    count: shownCount(),
    max: DAILY_LIMIT,
  });

  // The limit was hit and the pack had nothing: 2F without a pack, otherwise
  // an ordinary not-found card that carries the limit notice (2E).
  function limitedNoHit(word) {
    if (!pack.isAvailable()) {
      return { ok: true, limit: true, noPack: true, count: shownCount(), max: DAILY_LIMIT };
    }
    return packNotFound(word, limitNotice());
  }

  const found = (entry, notice) => ({ ok: true, found: true, entry, ...(notice ? { notice } : {}) });

  async function callMw(word) {
    counter.increment();
    const r = await lookupMw(word, getApiKey(), fetchFn);
    if (r.kind === "limit") counter.markExhausted();
    return r;
  }

  // MW failed (error) and the pack has nothing: show the error, keeping the
  // pack's near matches when there is a pack.
  const mwErrorNoHit = (word, r) =>
    pack.isAvailable() ? packNotFound(word, { kind: "offline", text: r.message }) : { ok: false, error: r.message };

  async function resolve(word) {
    const hasKey = Boolean(getApiKey());
    const hasPack = pack.isAvailable();
    const limited = hasKey && counter.count() >= DAILY_LIMIT;

    if (!hasKey && !hasPack) {
      return {
        ok: false,
        error: "No offline pack is installed and no API key is set. Open Settings from the tray icon.",
      };
    }

    if (getSourceMode() !== "online-first") {
      const hit = pack.lookup(word);
      if (hit) return found(hit);
      if (!hasKey) return packNotFound(word);
      if (limited) return limitedNoHit(word);

      const r = await callMw(word);
      if (r.kind === "found") return found(r.entry);
      if (r.kind === "notfound") return hasPack ? packNotFound(word) : mwNotFound(word, r);
      if (r.kind === "limit") return limitedNoHit(word);
      return mwErrorNoHit(word, r);
    }

    // online-first
    if (hasKey && !limited) {
      const r = await callMw(word);
      if (r.kind === "found") return found(r.entry);
      const hit = pack.lookup(word);
      if (r.kind === "notfound") return hit ? found(hit) : mwNotFound(word, r);
      if (hit) {
        return found(
          hit,
          r.kind === "limit" ? limitNotice() : { kind: "offline", text: `${r.message} Showing the offline entry.` }
        );
      }
      return r.kind === "limit" ? limitedNoHit(word) : mwErrorNoHit(word, r);
    }

    // No key, or the limit was already hit today: the pack answers if it can.
    const hit = pack.lookup(word);
    if (hit) return found(hit, limited ? limitNotice() : undefined);
    return limited ? limitedNoHit(word) : packNotFound(word);
  }

  return { resolve, mwCallsToday: counter.count };
}

module.exports = { createResolver, DAILY_LIMIT };

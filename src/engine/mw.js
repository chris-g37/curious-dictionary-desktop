// Merriam-Webster Collegiate lookup, normalized to the shared entry shape.
// Nothing returned here is ever written to disk (licensing): the caller only
// keeps the headword in the recent-history list.
const SOURCE_LABEL = "Merriam-Webster";

function normalize(word, data) {
  const parts = data
    .filter((e) => e && e.meta && Array.isArray(e.shortdef) && e.shortdef.length > 0)
    .map((e) => ({
      headword: e.hwi && e.hwi.hw ? e.hwi.hw.replace(/\*/g, "·") : word,
      pronunciation: e.hwi && e.hwi.prs && e.hwi.prs[0] ? e.hwi.prs[0].mw : null,
      pos: e.fl || "",
      senses: e.shortdef.map((d) => ({ text: d.replace(/\{[^}]*\}/g, ""), example: null })),
    }));
  if (parts.length === 0) return null;
  return {
    word: parts[0].headword,
    source: "mw",
    sourceLabel: SOURCE_LABEL,
    pronunciation: parts[0].pronunciation ? `\\${parts[0].pronunciation}\\` : null,
    parts: parts.map(({ pos, senses }) => ({ pos, senses })),
  };
}

// Resolves to one of:
//   { kind: "found", entry } | { kind: "notfound", suggestions }
//   { kind: "limit" } | { kind: "error", message }
async function lookupMw(word, apiKey, fetchFn = fetch) {
  const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(
    word
  )}?key=${apiKey}`;

  let response;
  try {
    response = await fetchFn(url);
  } catch (err) {
    return { kind: "error", message: "Network error — check your connection." };
  }

  // MW's exact over-quota response is not documented; treat 429 as the limit.
  if (response.status === 429) return { kind: "limit" };
  if (!response.ok) {
    return { kind: "error", message: "The dictionary service returned an error." };
  }

  let text;
  try {
    text = await response.text();
  } catch (err) {
    return { kind: "error", message: "Network error — check your connection." };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // MW answers a bad key or quota problem with a plain-text 200.
    if (/limit|quota/i.test(text)) return { kind: "limit" };
    if (/invalid api key/i.test(text)) {
      return { kind: "error", message: "Merriam-Webster rejected the API key. Check it in Settings." };
    }
    return { kind: "error", message: "Couldn't parse the dictionary response." };
  }

  if (!Array.isArray(data) || data.length === 0) return { kind: "notfound", suggestions: [] };
  // No entry: MW returns an array of suggestion strings instead of entries.
  if (typeof data[0] === "string") return { kind: "notfound", suggestions: data.slice(0, 5) };

  const entry = normalize(word, data);
  return entry ? { kind: "found", entry } : { kind: "notfound", suggestions: [] };
}

module.exports = { lookupMw, SOURCE_LABEL };

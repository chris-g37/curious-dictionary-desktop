const scrollEl = document.getElementById("scroll");
const contentEl = document.getElementById("content");
const input = document.getElementById("search-input");
const searchEl = document.getElementById("search");
const dropdownEl = document.getElementById("dropdown");
const ghostTyped = document.getElementById("ghost-typed");
const ghostRest = document.getElementById("ghost-rest");
const clearBtn = document.getElementById("clear-btn");
const footerNote = document.getElementById("footer-note");
const creditLink = document.getElementById("credit");

// Initial theme rides in on the URL so the first paint is right; live
// changes arrive over IPC.
const initialTheme = new URLSearchParams(window.location.search).get("theme");
document.documentElement.dataset.theme = initialTheme || "light";
window.api.onThemeChanged((theme) => {
  document.documentElement.dataset.theme = theme;
});

// Dictionary text is untrusted (Wiktionary / MW), so it is escaped before it
// goes anywhere near innerHTML.
function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MAX_RECENTS = 20;
let history = [];
let hasContent = false; // a lookup result (or state card) is on screen
let suggestions = [];
let active = -1;
let lookupSeq = 0;
let completeSeq = 0;
let packReady = false;

// ---- Layout ---------------------------------------------------------------

let view = "lookup"; // "lookup" | "saved" | "settings" | "about"

function applyLayout() {
  // First launch (nothing ever looked up) gets the centered welcome.
  scrollEl.classList.toggle("hero", view === "lookup" && history.length === 0 && !hasContent);
  scrollEl.classList.toggle("view-pane", view !== "lookup");
  for (const name of ["lookup", "saved", "settings", "about"]) {
    document.getElementById("nav-" + name).classList.toggle("active", view === name);
  }
}

function showLookupView() {
  if (view === "lookup") return;
  view = "lookup";
  hasContent = false;
  contentEl.innerHTML = "";
  applyLayout();
}

function setFooterNote(text) {
  footerNote.textContent = text;
}

function defaultFooterNote() {
  setFooterNote(packReady ? "Offline first" : "");
}

// ---- Pack status (sidebar) ------------------------------------------------

async function loadPackStatus() {
  const info = await window.api.getPackStatus();
  packReady = Boolean(info);
  document.getElementById("pack-dot").classList.toggle("on", packReady);
  document.getElementById("pack-title").textContent = packReady ? "Offline pack" : "No offline pack";
  document.getElementById("pack-meta").textContent = packReady
    ? `${info.entries.toLocaleString()} entries · ${info.language.toUpperCase()}`
    : "Not installed";
  if (!hasContent) defaultFooterNote();
}

// ---- Recents --------------------------------------------------------------

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupLabel(ts) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return "Earlier";
}

function formatTime(ts) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (days <= 1) return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderRecents() {
  hasContent = false;
  applyLayout();
  if (history.length === 0) {
    contentEl.innerHTML = "";
    return;
  }
  const groups = [];
  for (const item of history.slice(0, MAX_RECENTS)) {
    const label = groupLabel(item.timestamp);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(item);
  }
  contentEl.innerHTML = `
    <div class="recent-groups">
      ${groups
        .map(
          (g) => `
        <div>
          <div class="group-label">${esc(g.label)}</div>
          ${g.items
            .map(
              (r) => `
            <button class="recent-row" type="button" data-word="${esc(r.word)}">
              <span class="recent-word">${esc(r.word)}</span>
              ${r.partOfSpeech ? `<span class="recent-pos">${esc(r.partOfSpeech)}</span>` : ""}
              <span class="recent-time">${esc(formatTime(r.timestamp))}</span>
            </button>`
            )
            .join("")}
        </div>`
        )
        .join("")}
    </div>
  `;
  contentEl.querySelectorAll(".recent-row").forEach((row) => {
    row.addEventListener("click", () => openWord(row.dataset.word));
  });
  defaultFooterNote();
}

async function refreshHistory() {
  history = (await window.api.getHistory()) || [];
  if (view !== "lookup") return;
  if (!hasContent) renderRecents();
  else applyLayout();
}

// ---- Saved (3G) -------------------------------------------------------------
// The saved list lives in the main process; this view just asks for it.

let savedSort = "recent"; // "recent" | "az"

function formatSavedDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

async function refreshSavedCount() {
  const saved = await window.api.getSaved();
  document.getElementById("saved-count").textContent = saved.length ? String(saved.length) : "";
  return saved;
}

async function renderSaved() {
  const saved = await refreshSavedCount();
  if (view !== "saved") return;
  const rows = saved.slice();
  if (savedSort === "az") rows.sort((a, b) => a.word.localeCompare(b.word));

  contentEl.innerHTML = `
    <div class="saved-head">
      <div class="saved-title"><h1>Saved</h1><span>${saved.length} ${saved.length === 1 ? "word" : "words"}</span></div>
      <div class="seg">
        <button type="button" data-sort="recent" class="${savedSort === "recent" ? "on" : ""}">Recent</button>
        <button type="button" data-sort="az" class="${savedSort === "az" ? "on" : ""}">A–Z</button>
      </div>
    </div>
    ${
      rows.length === 0
        ? `<p class="saved-empty">Nothing saved yet. Use the bookmark button on a result to keep a word here.</p>`
        : `<div class="saved-list">${rows
            .map(
              (s) => `
        <div class="saved-row" data-word="${esc(s.word)}">
          <span class="saved-word">${esc(s.word)}</span>
          <span class="saved-gloss">${esc(s.gloss || "")}</span>
          <span class="saved-date">${esc(formatSavedDate(s.savedAt))}</span>
          <button class="remove-btn" type="button" title="Remove" data-remove="${esc(s.word)}">
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </button>
        </div>`
            )
            .join("")}</div>`
    }
  `;
  contentEl.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      savedSort = b.dataset.sort;
      renderSaved();
    })
  );
  contentEl.querySelectorAll(".saved-row").forEach((row) =>
    row.addEventListener("click", () => openWord(row.dataset.word))
  );
  contentEl.querySelectorAll(".remove-btn").forEach((b) =>
    b.addEventListener("click", (event) => {
      event.stopPropagation();
      window.api.removeSaved(b.dataset.remove);
    })
  );
  setFooterNote("");
}

function enterPane(name) {
  view = name;
  hasContent = true;
  lookupSeq++; // drop any lookup still in flight
  closeDropdown();
  applyLayout();
  setFooterNote("");
}

function showSavedView() {
  enterPane("saved");
  renderSaved();
}

// ---- Settings (4A) ----------------------------------------------------------
// Every control reads its state from the main process and writes straight
// back; nothing is cached here.

const EYE =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';

async function renderSettings() {
  const [settings, pack, fi, info] = await Promise.all([
    window.api.getSettings(),
    window.api.getPackStatus(),
    window.api.getFloatingIconSettings(),
    window.api.getAppInfo(),
  ]);
  if (view !== "settings") return;

  const packRow = pack
    ? `<div class="row">
         <div><div class="row-title"><span class="status-dot on"></span>${pack.language === "en" ? "English" : esc(pack.language)} pack (${esc(pack.profile)})</div>
         <div class="row-mono">${pack.entries.toLocaleString()} entries · version ${esc(pack.version)} · built ${esc(pack.buildDate)}</div></div>
         <span class="row-state">Installed</span>
       </div>`
    : `<div class="row">
         <div><div class="row-title"><span class="status-dot"></span>No offline pack installed</div>
         <div class="row-sub">Downloading a pack from inside the app is coming in a later update. For now, copy a pack file (curious-en-core.db or curious-en-full.db) into:</div>
         <div class="row-mono">${esc(info.packDir)}</div></div>
         <span class="row-state off">Not installed</span>
       </div>`;

  contentEl.innerHTML = `
    <div class="pane">
      <h1>Settings</h1>

      <div class="section-label">Dictionary</div>
      <div class="card">
        <div class="row">
          <div><div class="row-title">Dictionary source</div>
          <div class="row-sub">Which source answers first. Offline first uses Merriam-Webster only when the pack has no entry.</div></div>
          <div class="segmented" id="source-seg">
            <button type="button" data-mode="offline-first">Offline first</button>
            <button type="button" data-mode="online-first">Online first</button>
          </div>
        </div>
        ${packRow}
        <div class="key-block">
          <div class="key-head">
            <div><div class="row-title">Merriam-Webster API key</div>
            <div class="row-sub">Optional — enables Merriam-Webster as a second source</div></div>
            <button class="link" id="get-key" type="button">Get a free key →</button>
          </div>
          <div class="key-field">
            <input id="api-key" type="password" placeholder="Paste your API key" autocomplete="off" spellcheck="false" />
            <button class="icon-btn" id="toggle-key" type="button" aria-label="Show key">${EYE}</button>
          </div>
          <div class="key-status" id="key-status"></div>
        </div>
      </div>

      <div class="section-label">Summon</div>
      <div class="card">
        <div class="row">
          <div><div class="row-title">Show search bar</div><div class="row-sub">Opens the summon bar from anywhere</div></div>
          <div class="keys"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Space</kbd></div>
        </div>
        <div class="row">
          <div><div class="row-title">Look up selected word</div><div class="row-sub">Select a word in any app, then press this</div></div>
          <div class="keys"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>D</kbd></div>
        </div>
        <div class="row">
          <div><div class="row-title">Floating icon</div><div class="row-sub">A draggable icon on screen</div></div>
          <button id="fi-switch" class="switch" role="switch" aria-checked="${fi.enabled}" type="button"></button>
        </div>
      </div>

      <div class="section-label">Appearance</div>
      <div class="segmented" id="theme-seg">
        <button type="button" data-theme-choice="light">Light</button>
        <button type="button" data-theme-choice="dark">Dark</button>
        <button type="button" data-theme-choice="system">System</button>
      </div>

      <div class="section-label">History</div>
      <div class="card">
        <div class="row">
          <div><div class="row-title">Recent lookups</div><div class="row-sub" id="clear-status">Words you have looked up. Saved words are kept.</div></div>
          <button class="btn" id="clear-history" type="button">Clear history</button>
        </div>
      </div>
    </div>
  `;

  const keyInput = document.getElementById("api-key");
  keyInput.value = settings.apiKey || "";
  let flashTimer = null;
  const flash = (el, text) => {
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.textContent = ""), 2000);
  };
  const saveKey = async () => {
    await window.api.saveApiKey(keyInput.value);
    flash(document.getElementById("key-status"), "Saved");
  };
  keyInput.addEventListener("blur", saveKey);
  keyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") keyInput.blur();
  });
  document.getElementById("toggle-key").addEventListener("click", () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  });
  document.getElementById("get-key").addEventListener("click", () => window.api.openExternal("https://dictionaryapi.com"));

  // A segmented control: highlights the current value, reports clicks.
  const pick = (segId, attr, current, onPick) => {
    const buttons = document.getElementById(segId).querySelectorAll("button");
    buttons.forEach((b) => b.classList.toggle("on", b.dataset[attr] === current));
    buttons.forEach((b) =>
      b.addEventListener("click", () => {
        buttons.forEach((x) => x.classList.toggle("on", x === b));
        onPick(b.dataset[attr]);
      })
    );
  };
  pick("source-seg", "mode", settings.sourceMode === "online-first" ? "online-first" : "offline-first", (mode) =>
    window.api.saveSourceMode(mode)
  );
  pick("theme-seg", "themeChoice", settings.theme || "system", (theme) => window.api.saveTheme(theme));

  const sw = document.getElementById("fi-switch");
  sw.addEventListener("click", async () => {
    const next = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(next));
    await window.api.setFloatingIconEnabled(next);
  });

  document.getElementById("clear-history").addEventListener("click", async () => {
    const { cleared } = await window.api.requestClearHistory();
    if (cleared) flash(document.getElementById("clear-status"), "History cleared");
  });
}

function showSettingsView() {
  enterPane("settings");
  renderSettings();
}

// ---- About / licences (5A) --------------------------------------------------

function extLink(url, label, cls = "link") {
  return `<button class="${cls}" type="button" data-url="${esc(url)}">${esc(label)}</button>`;
}

async function renderAbout() {
  const info = await window.api.getAppInfo();
  if (view !== "about") return;
  contentEl.innerHTML = `
    <div class="pane">
      <h1>About</h1>
      <div class="about-hero">
        <div class="about-mark">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 3h13a3 3 0 013 3v15l-4-2-4 2-4-2-4 2V3z" fill="currentColor" /></svg>
        </div>
        <div>
          <div class="about-name">Curious <i>Dictionary</i></div>
          <div class="about-version">Version ${esc(info.version)}</div>
        </div>
      </div>
      ${extLink("https://services.fetchmate.tech", "Built by Fetchmate Chief Technologies ↗", "credit-link")}

      <div class="section-label">Dictionary data</div>
      <div class="card">
        <div class="attrib"><b>Wiktionary</b>
          The offline pack is built from Wiktionary, the free dictionary written by Wiktionary
          contributors, as extracted by kaikki.org (Tatu Ylonen, Wiktextract). Licensed CC BY-SA 4.0
          and GFDL. The pack was modified: trimmed (fewer senses and examples; translations, sound
          files and inflection tables removed) and converted to SQLite.
          <br />${extLink("https://en.wiktionary.org", "en.wiktionary.org")} · ${extLink("https://kaikki.org", "kaikki.org")}
        </div>
        <div class="attrib"><b>Word frequency</b>
          Ordering of suggestions uses FrequencyWords by Hermit Dave
          (github.com/hermitdave/FrequencyWords), derived from OpenSubtitles. CC BY-SA 4.0.
        </div>
        <div class="attrib"><b>Merriam-Webster</b>
          Optional second source: definitions from the Merriam-Webster Collegiate Dictionary API,
          used with your own key. Nothing from Merriam-Webster is stored; only the words you look up
          are kept in your history. ${extLink("https://dictionaryapi.com", "dictionaryapi.com")}
        </div>
      </div>

      <div class="section-label">Fonts</div>
      <div class="card">
        <div class="attrib">Fraunces, Inter and JetBrains Mono are bundled with the app under the
          SIL Open Font License 1.1. The licence texts ship with the app in its src/fonts folder.</div>
      </div>
    </div>
  `;
  contentEl.querySelectorAll("[data-url]").forEach((b) =>
    b.addEventListener("click", () => window.api.openExternal(b.dataset.url))
  );
}

function showAboutView() {
  enterPane("about");
  renderAbout();
}

function showPane(name) {
  if (name === "settings") showSettingsView();
  else if (name === "about") showAboutView();
}

// ---- Result rendering -----------------------------------------------------

function badgeHtml(source, label) {
  return `<span class="badge badge-${source === "mw" ? "mw" : "offline"}"><span class="dot"></span>${esc(label)}</span>`;
}

function noticeHtml(notice) {
  if (!notice) return "";
  return `
    <div class="notice">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path d="M12 7v6M12 16.5v.5" fill="none" stroke="currentColor" stroke-width="1.8" />
      </svg>
      <span>${esc(notice.text)}</span>
    </div>`;
}

function counterHtml(notice) {
  return notice && notice.kind === "limit"
    ? `<span class="counter">${notice.count.toLocaleString()} / ${notice.max.toLocaleString()}</span>`
    : "";
}

function entryAsText(entry) {
  const lines = [entry.word + (entry.pronunciation ? `  ${entry.pronunciation}` : "")];
  for (const part of entry.parts) {
    lines.push("", part.pos);
    part.senses.forEach((s, i) => lines.push(`${i + 1}. ${s.text}`));
  }
  lines.push("", `Source: ${entry.sourceLabel}`);
  return lines.join("\n");
}

function sourceNote(source) {
  return source === "mw" ? "Merriam-Webster Collegiate" : "Wiktionary · CC BY-SA 4.0";
}

function renderEntry(entry, notice) {
  hasContent = true;
  applyLayout();

  const partsHtml = entry.parts
    .map(
      (part) => `
      <div class="part-head">${part.pos ? `<span class="pos">${esc(part.pos)}</span>` : ""}</div>
      <ol class="senses">
        ${part.senses
          .map(
            (s, i) => `
          <li>
            <span class="num">${i + 1}</span>
            <div>
              <div class="gloss">${esc(s.text)}</div>
              ${s.example ? `<div class="example">“${esc(s.example)}”</div>` : ""}
            </div>
          </li>`
          )
          .join("")}
      </ol>`
    )
    .join("");

  contentEl.innerHTML = `
    ${noticeHtml(notice)}
    <div class="result-head">
      <div>
        <h1 class="headword">${esc(entry.word)}</h1>
        <div class="head-meta">
          ${entry.pronunciation ? `<span class="pron">${esc(entry.pronunciation)}</span><span class="sep"></span>` : ""}
          ${badgeHtml(entry.source, entry.sourceLabel)}
          ${counterHtml(notice)}
        </div>
        ${
          entry.redirectedFrom
            ? `<p class="redirect-note">“${esc(entry.redirectedFrom)}” is a form of “${esc(entry.word)}”</p>`
            : ""
        }
      </div>
      <div class="actions">
        <button id="copy-btn" class="btn" type="button">Copy</button>
        <button id="pin-btn" class="btn" type="button">Save</button>
      </div>
    </div>
    ${partsHtml}
    ${
      entry.etymology
        ? `<div class="origin"><span class="label">Origin</span><span class="origin-text">${esc(entry.etymology)}</span></div>`
        : ""
    }
  `;

  const copyBtn = document.getElementById("copy-btn");
  copyBtn.addEventListener("click", async () => {
    await window.api.copyText(entryAsText(entry));
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1500);
  });
  document.getElementById("pin-btn").addEventListener("click", () => window.api.toggleSaved(entry.word));
  shownWord = entry.word;
  refreshPinButton();
  setFooterNote(sourceNote(entry.source));
  scrollEl.scrollTop = 0;
}

// The button only reflects the main process's saved list.
let shownWord = null;

async function refreshPinButton() {
  const btn = document.getElementById("pin-btn");
  if (!btn || !shownWord) return;
  const saved = await window.api.isSaved(shownWord);
  btn.classList.toggle("on", saved);
  btn.textContent = saved ? "Saved" : "Save";
}

function renderNotFound(res) {
  hasContent = true;
  applyLayout();
  const near = res.suggestions || [];
  contentEl.innerHTML = `
    ${noticeHtml(res.notice)}
    <h2 class="state-title">No entry for <em>${esc(res.word)}</em></h2>
    ${near.length ? `<p class="state-text">Did you mean</p>` : ""}
    <div class="near">
      ${near
        .map(
          (s) => `
        <button class="near-row" type="button" data-word="${esc(s.word)}">
          <span class="near-word">${esc(s.word)}</span>
          ${s.pos ? `<span class="near-pos">${esc(s.pos)}</span>` : ""}
        </button>`
        )
        .join("")}
    </div>
    <div class="state-foot">${badgeHtml(res.source, res.sourceLabel)}${counterHtml(res.notice)}</div>
  `;
  contentEl.querySelectorAll(".near-row").forEach((row) => {
    row.addEventListener("click", () => openWord(row.dataset.word));
  });
  setFooterNote(sourceNote(res.source));
}

function renderLimitNoPack(res) {
  hasContent = true;
  applyLayout();
  contentEl.innerHTML = `
    <h2 class="state-title">Daily lookup limit reached</h2>
    <p class="state-text">
      The Merriam-Webster free tier allows ${res.max.toLocaleString()} lookups a day. It refreshes at
      midnight ET. Install the offline pack to keep looking up words.
    </p>
    <div class="state-foot"><span class="counter">${res.count.toLocaleString()} / ${res.max.toLocaleString()} today</span></div>
  `;
  setFooterNote("");
}

function renderError(message) {
  hasContent = true;
  applyLayout();
  contentEl.innerHTML = `<p class="state-text">${esc(message)}</p>`;
  setFooterNote("");
}

function renderLoading() {
  hasContent = true;
  applyLayout();
  contentEl.innerHTML = `
    <div class="skeleton">
      <div class="sk title"></div>
      <div class="sk"></div>
      <div class="sk w86"></div>
      <div class="sk w64"></div>
    </div>`;
}

// ---- Lookup ---------------------------------------------------------------

function cleanWord(word) {
  return word.replace(/·/g, "").trim();
}

function openWord(word) {
  input.value = cleanWord(word);
  runLookup();
}

async function runLookup() {
  const word = input.value.trim();
  if (!word) return;
  showLookupView();
  closeDropdown();
  updateInputUi();

  // A skeleton only appears if the answer takes a moment (offline is instant).
  const seq = ++lookupSeq;
  const timer = setTimeout(() => {
    if (seq === lookupSeq) renderLoading();
  }, 150);

  let res;
  try {
    res = await window.api.lookupWord(word);
  } catch (err) {
    res = { ok: false, error: "Something went wrong during the lookup." };
  }
  clearTimeout(timer);
  if (seq !== lookupSeq) return;

  if (!res.ok) renderError(res.error);
  else if (res.limit) renderLimitNoPack(res);
  else if (!res.found) renderNotFound(res);
  else renderEntry(res.entry, res.notice);
}

// ---- Autocomplete (3F) ------------------------------------------------------

function closeDropdown() {
  suggestions = [];
  active = -1;
  dropdownEl.hidden = true;
  dropdownEl.innerHTML = "";
  searchEl.setAttribute("aria-expanded", "false");
  updateGhost();
}

function updateGhost() {
  const typed = input.value;
  const top = suggestions[0];
  if (top && typed && top.word.toLowerCase().startsWith(typed.toLowerCase()) && top.word.length > typed.length) {
    ghostTyped.textContent = typed;
    ghostRest.textContent = top.word.slice(typed.length);
  } else {
    ghostTyped.textContent = "";
    ghostRest.textContent = "";
  }
}

function renderDropdown() {
  if (suggestions.length === 0) {
    closeDropdown();
    return;
  }
  const typed = input.value.trim();
  dropdownEl.hidden = false;
  searchEl.setAttribute("aria-expanded", "true");
  dropdownEl.innerHTML = `
    <div class="sugg-list">
      ${suggestions
        .map((s, i) => {
          const head = s.word.slice(0, typed.length);
          const rest = s.word.slice(typed.length);
          return `
          <div class="sugg${i === active ? " active" : ""}" role="option" data-i="${i}">
            <span class="sugg-word"><b>${esc(head)}</b>${esc(rest)}</span>
            ${s.pos ? `<span class="sugg-pos">${esc(s.pos)}</span>` : ""}
            ${i === active ? '<span class="sugg-enter">↵</span>' : ""}
          </div>`;
        })
        .join("")}
    </div>
    <div class="sugg-keys"><span>↑↓ move</span><span>tab complete</span><span>↵ open</span><span>esc close</span><span class="src">from offline pack</span></div>
  `;
  // mousedown (not click) so the input keeps focus.
  dropdownEl.querySelectorAll(".sugg").forEach((row) => {
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      openWord(suggestions[Number(row.dataset.i)].word);
    });
  });
  updateGhost();
}

async function updateSuggestions() {
  const typed = input.value.trim();
  const seq = ++completeSeq;
  if (typed.length < 2) {
    closeDropdown();
    return;
  }
  const found = await window.api.completeWord(typed);
  if (seq !== completeSeq) return;
  suggestions = found || [];
  active = -1;
  renderDropdown();
}

function updateInputUi() {
  const has = input.value.length > 0;
  clearBtn.hidden = !has;
  document.getElementById("slash-key").hidden = has;
}

function clearSearch() {
  showLookupView();
  input.value = "";
  lookupSeq++; // drop any lookup still in flight
  closeDropdown();
  updateInputUi();
  renderRecents();
  input.focus();
}

input.addEventListener("input", () => {
  updateInputUi();
  if (input.value.trim() === "") {
    clearSearch();
    return;
  }
  updateSuggestions();
});

input.addEventListener("keydown", (event) => {
  const open = !dropdownEl.hidden && suggestions.length > 0;
  if (event.key === "ArrowDown" && open) {
    event.preventDefault();
    active = (active + 1) % suggestions.length;
    renderDropdown();
  } else if (event.key === "ArrowUp" && open) {
    event.preventDefault();
    active = active <= 0 ? suggestions.length - 1 : active - 1;
    renderDropdown();
  } else if (event.key === "Tab" && open) {
    // Complete to the highlighted suggestion (or the top one) without opening it.
    event.preventDefault();
    const pick = suggestions[active >= 0 ? active : 0];
    input.value = pick.word;
    updateInputUi();
    updateSuggestions();
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (open && active >= 0) input.value = suggestions[active].word;
    runLookup();
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (open) closeDropdown();
    else if (input.value) clearSearch();
  }
});

input.addEventListener("blur", () => {
  setTimeout(closeDropdown, 100);
});

clearBtn.addEventListener("click", clearSearch);

document.getElementById("nav-lookup").addEventListener("click", clearSearch);

// "/" jumps to the search box from anywhere on the page.
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== input) {
    event.preventDefault();
    input.focus();
    input.select();
  }
});

// ---- Credit link ------------------------------------------------------------

creditLink.addEventListener("click", (event) => {
  event.preventDefault();
  window.api.openExternal(creditLink.href);
});

// ---- Boot -------------------------------------------------------------------

document.getElementById("nav-saved").addEventListener("click", showSavedView);
document.getElementById("nav-settings").addEventListener("click", showSettingsView);
document.getElementById("nav-about").addEventListener("click", showAboutView);
window.api.onShowPane(showPane);

// Saved list changed anywhere (bar, this window): refresh what depends on it.
window.api.onSavedChanged(() => {
  refreshSavedCount();
  if (view === "saved") renderSaved();
  else refreshPinButton();
});

// "Open in app" from the bar.
window.api.onShowWord((word) => {
  showLookupView();
  openWord(word);
});

window.api.onHistoryChanged(refreshHistory);
window.addEventListener("focus", () => {
  refreshHistory();
  loadPackStatus();
});

(async function boot() {
  await Promise.all([refreshHistory(), loadPackStatus(), refreshSavedCount()]);
  renderRecents();
  input.focus();
  // Opened from the bar's "Open in app": go straight to that word.
  const params = new URLSearchParams(window.location.search);
  if (params.get("word")) openWord(params.get("word"));
  else if (params.get("pane")) showPane(params.get("pane"));
})();

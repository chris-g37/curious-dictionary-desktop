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

function applyLayout() {
  // First launch (nothing ever looked up) gets the centered welcome.
  scrollEl.classList.toggle("hero", history.length === 0 && !hasContent);
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
  if (!hasContent) renderRecents();
  else applyLayout();
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
  setFooterNote(sourceNote(entry.source));
  scrollEl.scrollTop = 0;
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

window.api.onHistoryChanged(refreshHistory);
window.addEventListener("focus", () => {
  refreshHistory();
  loadPackStatus();
});

(async function boot() {
  await Promise.all([refreshHistory(), loadPackStatus()]);
  renderRecents();
  input.focus();
})();

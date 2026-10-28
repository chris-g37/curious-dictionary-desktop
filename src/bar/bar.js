const input = document.getElementById("search-input");
const resultEl = document.getElementById("result");
const historyEl = document.getElementById("history");
const hintEl = document.getElementById("selection-hint");
const appEl = document.getElementById("app");

// The initial theme rides in on the URL (set by main.js at loadFile time)
// so the very first paint is already correct — no flash while we wait on
// an IPC round trip. Live changes still arrive via onThemeChanged below.
const initialTheme = new URLSearchParams(window.location.search).get("theme");
document.documentElement.dataset.theme = initialTheme || "light";

window.api.onThemeChanged((theme) => {
  document.documentElement.dataset.theme = theme;
});

function reportSize() {
  // Tell the main process how tall our content is so it can resize the
  // (otherwise invisible, transparent) window to match — no dead click area.
  window.api.resizeBar(appEl.scrollHeight);
}

function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Everything shown comes from a dictionary (MW or Wiktionary) or the user's
// own typing, so it is escaped before going into innerHTML.
function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The bar is a quick look; the full entry is for the main window (Task 3/4).
const MAX_PARTS = 4;
const MAX_SENSES = 3;

function badgeHtml(source, label) {
  return `<span class="badge badge-${source === "mw" ? "mw" : "offline"}"><span class="badge-dot"></span>${esc(label)}</span>`;
}

function footerHtml(source, label, extraHtml = "") {
  return `<div class="footer">${badgeHtml(source, label)}${extraHtml}</div>`;
}

function noticeHtml(notice) {
  if (!notice) return "";
  return `
    <div class="notice notice-${esc(notice.kind)}">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path d="M12 7v6M12 16.5v.5" fill="none" stroke="currentColor" stroke-width="1.8" />
      </svg>
      <span>${esc(notice.text)}</span>
    </div>
  `;
}

function counterHtml(notice) {
  return notice && notice.kind === "limit"
    ? `<span class="counter">${notice.count.toLocaleString()} / ${notice.max.toLocaleString()}</span>`
    : "";
}

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path class="pin-shape" d="M6 3h12v18l-6-4-6 4z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  history: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
};

function entryAsText(entry) {
  const lines = [entry.word + (entry.pronunciation ? `  ${entry.pronunciation}` : "")];
  for (const part of entry.parts) {
    lines.push("", part.pos);
    part.senses.forEach((sense, i) => lines.push(`${i + 1}. ${sense.text}`));
  }
  lines.push("", `Source: ${entry.sourceLabel}`);
  return lines.join("\n");
}

function actionsHtml() {
  return `
    <div class="actions">
      <button class="icon-action" id="act-copy" type="button" title="Copy">${ICONS.copy}</button>
      <button class="icon-action" id="act-pin" type="button" title="Pin to Saved">${ICONS.pin}</button>
      <button class="icon-action" id="act-history" type="button" title="History">${ICONS.history}</button>
      <span class="actions-sep"></span>
      <button class="open-btn" id="act-open" type="button">${ICONS.open}Open in app</button>
    </div>`;
}

// Saved state lives in the main process; the button only reflects it.
async function refreshPinState(word) {
  const pin = document.getElementById("act-pin");
  if (!pin || word !== shownWord) return;
  const saved = await window.api.isSaved(word);
  pin.classList.toggle("on", saved);
  pin.title = saved ? "Remove from Saved" : "Pin to Saved";
  pin.querySelector(".pin-shape").setAttribute("fill", saved ? "currentColor" : "none");
}

function wireActions(entry) {
  shownWord = entry.word;
  const copy = document.getElementById("act-copy");
  copy.addEventListener("click", async () => {
    await window.api.copyText(entryAsText(entry));
    copy.title = "Copied";
    copy.classList.add("on");
    setTimeout(() => {
      copy.title = "Copy";
      copy.classList.remove("on");
    }, 1200);
  });
  document.getElementById("act-pin").addEventListener("click", async () => {
    await window.api.toggleSaved(entry.word);
  });
  document.getElementById("act-history").addEventListener("click", () => {
    input.value = "";
    resultEl.innerHTML = "";
    shownWord = null;
    showHistory();
    input.focus();
  });
  document.getElementById("act-open").addEventListener("click", () => {
    window.api.openInMainWindow(entry.word);
  });
  refreshPinState(entry.word);
}

let shownWord = null;
window.api.onSavedChanged(() => {
  if (shownWord) refreshPinState(shownWord);
});

function renderEntry(entry, notice) {
  const pronHtml = entry.pronunciation ? `<span class="pron">${esc(entry.pronunciation)}</span>` : "";
  const fromHtml = entry.redirectedFrom
    ? `<p class="redirect-note">“${esc(entry.redirectedFrom)}” is a form of “${esc(entry.word)}”</p>`
    : "";

  const partsHtml = entry.parts
    .slice(0, MAX_PARTS)
    .map((part) => {
      const posHtml = part.pos ? `<span class="pos-pill">${esc(part.pos)}</span>` : "";
      const defsHtml = part.senses
        .slice(0, MAX_SENSES)
        .map(
          (sense, i) => `
            <li>
              <span class="num">${i + 1}</span>
              <span>${esc(sense.text)}${
                sense.example ? `<span class="example">“${esc(sense.example)}”</span>` : ""
              }</span>
            </li>`
        )
        .join("");
      return `
        <div class="entry">
          ${posHtml}
          <ol class="defs">${defsHtml}</ol>
        </div>
      `;
    })
    .join("");

  resultEl.innerHTML = `
    <div class="card">
      ${noticeHtml(notice)}
      <div class="card-header">
        <h1 class="headword">${esc(entry.word)}</h1>
        ${pronHtml}
      </div>
      ${fromHtml}
      ${partsHtml}
      ${footerHtml(entry.source, entry.sourceLabel, counterHtml(notice) + actionsHtml())}
    </div>
  `;
  wireActions(entry);
}

function renderNotFound(response) {
  const suggestionsHtml =
    response.suggestions.length > 0
      ? `
        <p class="hint">Did you mean</p>
        <div class="suggestion-list">
          ${response.suggestions
            .map(
              (s) => `
                <button class="suggestion-row" type="button" data-word="${esc(s.word)}">
                  <span class="suggestion-word">${esc(s.word)}</span>
                  ${s.pos ? `<span class="suggestion-pos">${esc(s.pos)}</span>` : ""}
                </button>`
            )
            .join("")}
        </div>
      `
      : "";

  resultEl.innerHTML = `
    <div class="card">
      ${noticeHtml(response.notice)}
      <p class="not-found">No entry for <em>${esc(response.word)}</em></p>
      ${suggestionsHtml}
      ${footerHtml(response.source, response.sourceLabel, counterHtml(response.notice))}
    </div>
  `;

  resultEl.querySelectorAll(".suggestion-row").forEach((row) => {
    row.addEventListener("click", () => {
      input.value = row.dataset.word.replace(/·/g, "");
      runLookup();
    });
  });
}

// Design 2F: the daily limit is spent and there is no pack to fall back on.
function renderLimitNoPack(response) {
  resultEl.innerHTML = `
    <div class="card">
      <p class="not-found">Daily lookup limit reached</p>
      <p class="hint">
        The Merriam-Webster free tier allows ${response.max.toLocaleString()} lookups a day. It
        refreshes at midnight ET. Install the offline pack to keep looking up words.
      </p>
      <div class="footer">
        <span class="counter">${response.count.toLocaleString()} / ${response.max.toLocaleString()} today</span>
        <button id="open-settings" class="primary-btn" type="button">Open settings</button>
      </div>
    </div>
  `;
  document.getElementById("open-settings").addEventListener("click", () => {
    window.api.openSettings();
    window.api.hideBar();
  });
}

function renderError(message) {
  resultEl.innerHTML = `
    <div class="card">
      <p class="error-message">${esc(message)}</p>
    </div>
  `;
}

// Design 2C. Offline lookups answer in a few ms, so the skeleton only appears
// if a lookup is still pending after a short delay (avoids a flash).
function renderLoading() {
  resultEl.innerHTML = `
    <div class="card skeleton">
      <div class="sk-line sk-title"></div>
      <div class="sk-line sk-pos"></div>
      <div class="sk-line"></div>
      <div class="sk-line sk-w86"></div>
      <div class="sk-line sk-w64"></div>
      <div class="footer"><span class="loading-text">Looking up…</span></div>
    </div>
  `;
  reportSize();
}

let lookupSeq = 0;

async function runLookup() {
  const word = input.value.trim();
  if (!word) return;

  historyEl.innerHTML = "";
  clearHint();

  // Ignore replies from an older lookup if the user searched again meanwhile.
  const seq = ++lookupSeq;
  const loadingTimer = setTimeout(() => {
    if (seq === lookupSeq) renderLoading();
  }, 150);

  let response;
  try {
    response = await window.api.lookupWord(word);
  } catch (err) {
    response = { ok: false, error: "Something went wrong during the lookup." };
  }
  clearTimeout(loadingTimer);
  if (seq !== lookupSeq) return;

  if (!response.ok) {
    renderError(response.error);
  } else if (response.limit) {
    renderLimitNoPack(response);
  } else if (!response.found) {
    renderNotFound(response);
  } else {
    renderEntry(response.entry, response.notice);
  }

  reportSize();
}

async function showHistory() {
  const items = await window.api.getRecentHistory();
  if (!items || items.length === 0) {
    historyEl.innerHTML = "";
    reportSize();
    return;
  }

  historyEl.innerHTML = items
    .map(
      (item) => `
        <div class="history-item" data-word="${esc(item.word)}">
          <span class="history-word">${esc(item.word)}</span>
          <span class="history-meta">
            ${item.partOfSpeech ? `<span class="history-pos">${esc(item.partOfSpeech)}</span>` : ""}
            <span class="history-time">${formatRelativeTime(item.timestamp)}</span>
          </span>
        </div>
      `
    )
    .join("");

  historyEl.querySelectorAll(".history-item").forEach((row) => {
    row.addEventListener("click", () => {
      input.value = row.dataset.word;
      runLookup();
    });
  });

  reportSize();
}

function hideHistory() {
  if (historyEl.innerHTML !== "") {
    historyEl.innerHTML = "";
    reportSize();
  }
}

function showHint(message) {
  hintEl.textContent = message;
  reportSize();
}

function clearHint() {
  if (hintEl.textContent !== "") {
    hintEl.textContent = "";
    reportSize();
  }
}

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    runLookup();
  } else if (event.key === "Escape") {
    window.api.hideBar();
  }
});

input.addEventListener("input", () => {
  clearHint();
  if (input.value.trim() === "") {
    resultEl.innerHTML = "";
    showHistory();
  } else {
    hideHistory();
  }
  reportSize();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.api.hideBar();
  }
});

window.api.onBarShown((payload) => {
  input.focus();

  if (payload && payload.selection) {
    // A selection-triggered summon always overrides whatever was in the
    // box, even with an empty string — that's how it's told apart from a
    // plain re-summon, which leaves the last state alone (below).
    clearHint();
    resultEl.innerHTML = "";
    input.value = payload.word || "";

    if (payload.word) {
      hideHistory();
      runLookup();
    } else {
      showHistory();
      if (payload.hint) showHint(payload.hint);
    }
    return;
  }

  input.select();
  if (input.value.trim() === "") {
    showHistory();
  }
});

new ResizeObserver(reportSize).observe(appEl);
reportSize();

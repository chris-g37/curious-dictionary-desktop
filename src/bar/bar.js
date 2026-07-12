const input = document.getElementById("search-input");
const resultEl = document.getElementById("result");
const historyEl = document.getElementById("history");
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

function stripTags(text) {
  return text.replace(/\{[^}]*\}/g, "");
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

function renderEntries(word, entries) {
  const first = entries[0];
  const pronHtml = first.pronunciation
    ? `<span class="pron">\\${first.pronunciation}\\</span>`
    : "";

  const entriesHtml = entries
    .map((entry) => {
      const posHtml = entry.partOfSpeech
        ? `<span class="pos-pill">${entry.partOfSpeech}</span>`
        : "";
      const defsHtml = entry.shortdef
        .map(
          (def, i) =>
            `<li><span class="num">${i + 1}</span><span>${stripTags(def)}</span></li>`
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
      <div class="card-header">
        <h1 class="headword">${first.headword}</h1>
        ${pronHtml}
      </div>
      ${entriesHtml}
      <div class="footer">Merriam-Webster Collegiate</div>
    </div>
  `;
}

function renderNotFound(word, suggestions) {
  const suggestionsHtml =
    suggestions.length > 0
      ? `
        <p class="hint">Did you mean:</p>
        <div class="suggestions">
          ${suggestions
            .map((s) => `<button class="suggestion-chip" type="button">${s}</button>`)
            .join("")}
        </div>
      `
      : "";

  resultEl.innerHTML = `
    <div class="card">
      <p class="not-found">No entry found for "${word}".</p>
      ${suggestionsHtml}
      <div class="footer">Merriam-Webster Collegiate</div>
    </div>
  `;

  resultEl.querySelectorAll(".suggestion-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      input.value = chip.textContent;
      runLookup();
    });
  });
}

function renderError(message) {
  resultEl.innerHTML = `
    <div class="card">
      <p class="error-message">${message}</p>
    </div>
  `;
}

async function runLookup() {
  const word = input.value.trim();
  if (!word) return;

  historyEl.innerHTML = "";

  const response = await window.api.lookupWord(word);

  if (!response.ok) {
    renderError(response.error);
  } else if (!response.found) {
    renderNotFound(response.word, response.suggestions);
  } else {
    renderEntries(response.word, response.entries);
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
        <div class="history-item" data-word="${item.word}">
          <span class="history-word">${item.word}</span>
          <span class="history-meta">
            ${item.partOfSpeech ? `<span class="history-pos">${item.partOfSpeech}</span>` : ""}
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

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    runLookup();
  } else if (event.key === "Escape") {
    window.api.hideBar();
  }
});

input.addEventListener("input", () => {
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

window.api.onBarShown(() => {
  input.focus();
  input.select();
  if (input.value.trim() === "") {
    showHistory();
  }
});

new ResizeObserver(reportSize).observe(appEl);
reportSize();

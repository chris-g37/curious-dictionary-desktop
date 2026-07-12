const input = document.getElementById("search-input");
const resultEl = document.getElementById("result");
const appEl = document.getElementById("app");

function reportSize() {
  // Tell the main process how tall our content is so it can resize the
  // (otherwise invisible, transparent) window to match — no dead click area.
  window.api.resizeBar(appEl.scrollHeight);
}

function stripTags(text) {
  return text.replace(/\{[^}]*\}/g, "");
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

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    runLookup();
  } else if (event.key === "Escape") {
    window.api.hideBar();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.api.hideBar();
  }
});

window.api.onBarShown(() => {
  input.focus();
  input.select();
});

new ResizeObserver(reportSize).observe(appEl);
reportSize();

const apiKeyInput = document.getElementById("api-key");
const toggleKeyBtn = document.getElementById("toggle-key-visibility");
const eyeSlash = document.getElementById("eye-slash");
const keyStatus = document.getElementById("key-status");
const getKeyLink = document.getElementById("get-key-link");
const themeButtons = document.querySelectorAll(".theme-option");
const clearHistoryBtn = document.getElementById("clear-history");
const clearStatus = document.getElementById("clear-status");
const floatingIconToggle = document.getElementById("floating-icon-toggle");

const initialTheme = new URLSearchParams(window.location.search).get("theme");
document.documentElement.dataset.theme = initialTheme || "light";

window.api.onThemeChanged((theme) => {
  document.documentElement.dataset.theme = theme;
});

let flashStatusTimer = null;
function flashStatus(el, message) {
  el.textContent = message;
  clearTimeout(flashStatusTimer);
  flashStatusTimer = setTimeout(() => {
    el.textContent = "";
  }, 2000);
}

toggleKeyBtn.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
  eyeSlash.setAttribute("visibility", showing ? "hidden" : "visible");
  toggleKeyBtn.setAttribute("aria-label", showing ? "Show key" : "Hide key");
});

function saveApiKey() {
  window.api.saveApiKey(apiKeyInput.value).then(() => {
    flashStatus(keyStatus, "Saved");
  });
}

apiKeyInput.addEventListener("blur", saveApiKey);
apiKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    apiKeyInput.blur();
  }
});

getKeyLink.addEventListener("click", (event) => {
  event.preventDefault();
  window.api.openExternal("https://dictionaryapi.com");
});

function setActiveThemeButton(theme) {
  themeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

themeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveThemeButton(btn.dataset.theme);
    window.api.saveTheme(btn.dataset.theme);
  });
});

clearHistoryBtn.addEventListener("click", async () => {
  const { cleared } = await window.api.requestClearHistory();
  if (cleared) {
    flashStatus(clearStatus, "History cleared");
  }
});

const sourceButtons = document.querySelectorAll(".source-option");

function setActiveSourceButton(mode) {
  sourceButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
}

sourceButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveSourceButton(btn.dataset.mode);
    window.api.saveSourceMode(btn.dataset.mode);
  });
});

window.api.getSettings().then(({ apiKey, theme, sourceMode }) => {
  apiKeyInput.value = apiKey || "";
  setActiveThemeButton(theme || "system");
  setActiveSourceButton(sourceMode || "offline-first");
});

function setFloatingIconToggleUI(enabled) {
  floatingIconToggle.setAttribute("aria-checked", String(enabled));
}

floatingIconToggle.addEventListener("click", async () => {
  const next = floatingIconToggle.getAttribute("aria-checked") !== "true";
  setFloatingIconToggleUI(next);
  await window.api.setFloatingIconEnabled(next);
});

window.api.onFloatingIconEnabledChanged((enabled) => {
  setFloatingIconToggleUI(enabled);
});

window.api.getFloatingIconSettings().then(({ enabled }) => {
  setFloatingIconToggleUI(enabled);
});

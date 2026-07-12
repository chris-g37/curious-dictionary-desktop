// Main process: the only place with Node/OS access (windows, tray, global
// shortcuts, network calls, disk-backed settings). The renderers (src/bar/*,
// src/settings/*) are sandboxed webpages that can't touch any of this
// directly — they talk to us through preload.js's bridge.
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeTheme,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  dialog,
} = require("electron");
const path = require("path");
const Store = require("electron-store");

let config;
try {
  config = require("./config.js");
} catch (err) {
  config = { MW_API_KEY: "" };
}

// electron-store writes to a JSON file in the OS user-data folder (e.g.
// %APPDATA%/curious-dictionary-desktop/config.json on Windows) — this is
// what persists the API key, theme, and history across app restarts,
// instead of the gitignored config.js used only as a first-run fallback.
const store = new Store({
  defaults: {
    mwApiKey: "",
    theme: "system",
    history: [],
  },
});

// One-time migration: earlier versions only supported config.js. If the
// store has no key yet but config.js does, carry it over so nothing breaks.
if (!store.get("mwApiKey") && config.MW_API_KEY) {
  store.set("mwApiKey", config.MW_API_KEY);
}

const BAR_WIDTH = 640;
const INITIAL_HEIGHT = 64;
const TOP_OFFSET_RATIO = 0.15;
const ALLOWED_EXTERNAL_URLS = new Set(["https://dictionaryapi.com"]);

let barWindow = null;
let settingsWindow = null;
let tray = null;
let isQuitting = false;

function getEffectiveTheme() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function getApiKey() {
  return store.get("mwApiKey") || config.MW_API_KEY || "";
}

function getCenteredBounds(height) {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  return {
    x: Math.round((screenWidth - BAR_WIDTH) / 2),
    y: Math.round(screenHeight * TOP_OFFSET_RATIO),
    width: BAR_WIDTH,
    height,
  };
}

function createBarWindow() {
  barWindow = new BrowserWindow({
    ...getCenteredBounds(INITIAL_HEIGHT),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  barWindow.loadFile(path.join(__dirname, "src", "bar", "bar.html"), {
    query: { theme: getEffectiveTheme() },
  });

  barWindow.on("blur", () => {
    if (barWindow && barWindow.isVisible()) {
      barWindow.hide();
    }
  });
}

function showBar() {
  if (!barWindow) return;
  const bounds = barWindow.getBounds();
  barWindow.setBounds(getCenteredBounds(bounds.height));
  barWindow.show();
  barWindow.focus();
  barWindow.webContents.send("bar-shown");
}

function hideBar() {
  if (!barWindow) return;
  barWindow.hide();
}

function toggleBar() {
  if (!barWindow) return;
  if (barWindow.isVisible()) {
    hideBar();
  } else {
    showBar();
  }
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  const iconPath = path.join(__dirname, "assets", "icons", "tray-icon.png");
  const isDark = getEffectiveTheme() === "dark";

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    show: false,
    title: "Curious Dictionary Settings",
    icon: iconPath,
    backgroundColor: isDark ? "#2A211B" : "#FFFFFF",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.setMenuBarVisibility(false);

  settingsWindow.loadFile(
    path.join(__dirname, "src", "settings", "settings.html"),
    { query: { theme: getEffectiveTheme() } }
  );

  settingsWindow.once("ready-to-show", () => settingsWindow.show());

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "assets", "icons", "tray-icon.png");
  tray = new Tray(iconPath);
  tray.setToolTip("Curious Dictionary");

  tray.on("click", toggleBar);

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Search (Ctrl+Shift+Space)", click: toggleBar },
      { label: "Settings", click: createSettingsWindow },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

function broadcastTheme() {
  const theme = getEffectiveTheme();
  const bgForWindows = theme === "dark" ? "#2A211B" : "#FFFFFF";
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("theme-changed", theme);
  });
  if (settingsWindow) {
    settingsWindow.setBackgroundColor(bgForWindows);
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = store.get("theme", "system");

  createBarWindow();
  createTray();

  nativeTheme.on("updated", broadcastTheme);

  globalShortcut.register("Ctrl+Shift+Space", toggleBar);

  ipcMain.on("hide-bar", () => hideBar());

  ipcMain.on("resize-bar", (event, contentHeight) => {
    if (!barWindow) return;
    const bounds = barWindow.getBounds();
    const nextBounds = getCenteredBounds(Math.round(contentHeight));
    barWindow.setBounds({ ...nextBounds, x: bounds.x, y: bounds.y });
  });

  ipcMain.handle("lookup-word", async (event, word) => {
    const result = await lookupWord(word);
    if (result.ok && result.found) {
      saveHistoryEntry(result);
    }
    return result;
  });

  ipcMain.handle("get-recent-history", () => store.get("history", []).slice(0, 8));

  ipcMain.handle("request-clear-history", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["Cancel", "Clear History"],
      defaultId: 0,
      cancelId: 0,
      message: "Clear all search history?",
      detail: "This removes your recent lookups. This can't be undone.",
    });
    if (result.response === 1) {
      store.set("history", []);
      return { cleared: true };
    }
    return { cleared: false };
  });

  ipcMain.handle("get-settings", () => ({
    apiKey: store.get("mwApiKey", ""),
    theme: store.get("theme", "system"),
  }));

  ipcMain.handle("save-api-key", (event, key) => {
    store.set("mwApiKey", (key || "").trim());
    return true;
  });

  ipcMain.handle("save-theme", (event, theme) => {
    store.set("theme", theme);
    nativeTheme.themeSource = theme;
    broadcastTheme();
    return true;
  });

  ipcMain.handle("get-effective-theme", () => getEffectiveTheme());

  ipcMain.handle("open-external", (event, url) => {
    if (ALLOWED_EXTERNAL_URLS.has(url)) {
      shell.openExternal(url);
    }
  });
});

app.on("window-all-closed", (event) => {
  // The bar hides rather than closes, so this normally never fires. It
  // exists as a safety net — don't quit unless the tray's Quit item asked.
  if (!isQuitting) {
    event.preventDefault();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

function saveHistoryEntry({ entries }) {
  const primary = entries[0];
  const entry = {
    word: primary.headword,
    partOfSpeech: primary.partOfSpeech || "",
    timestamp: Date.now(),
  };
  const key = entry.word.toLowerCase().replace(/·/g, "");

  let history = store.get("history", []);
  history = history.filter((h) => h.word.toLowerCase().replace(/·/g, "") !== key);
  history.unshift(entry);
  if (history.length > 50) {
    history = history.slice(0, 50);
  }
  store.set("history", history);
}

async function lookupWord(word) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: "No API key configured. Open Settings from the tray icon and add your Merriam-Webster key.",
    };
  }

  const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(
    word
  )}?key=${apiKey}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    return { ok: false, error: "Network error — check your connection." };
  }

  if (!response.ok) {
    return { ok: false, error: "The dictionary service returned an error." };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    return { ok: false, error: "Couldn't parse the dictionary response." };
  }

  if (!Array.isArray(data) || data.length === 0) {
    return { ok: true, found: false, word, suggestions: [] };
  }

  // When MW doesn't have the word, it returns an array of suggestion strings
  // instead of entry objects.
  if (typeof data[0] === "string") {
    return { ok: true, found: false, word, suggestions: data };
  }

  const entries = data
    .filter((entry) => entry && entry.meta)
    .map((entry) => ({
      headword: entry.hwi && entry.hwi.hw ? entry.hwi.hw.replace(/\*/g, "·") : word,
      pronunciation:
        entry.hwi && entry.hwi.prs && entry.hwi.prs[0]
          ? entry.hwi.prs[0].mw
          : null,
      partOfSpeech: entry.fl || null,
      shortdef: entry.shortdef || [],
    }))
    .filter((entry) => entry.shortdef.length > 0);

  if (entries.length === 0) {
    return { ok: true, found: false, word, suggestions: [] };
  }

  return { ok: true, found: true, word, entries };
}

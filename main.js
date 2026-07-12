// Main process: the only place with Node/OS access (windows, global shortcuts,
// network calls). The renderer (src/bar/*) is a sandboxed webpage that can't
// touch any of this directly — it talks to us through preload.js's bridge.
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const path = require("path");

let config;
try {
  config = require("./config.js");
} catch (err) {
  config = { MW_API_KEY: "" };
}

const BAR_WIDTH = 640;
const INITIAL_HEIGHT = 64;
const TOP_OFFSET_RATIO = 0.15;

let barWindow = null;

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

  barWindow.loadFile(path.join(__dirname, "src", "bar", "bar.html"));

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

app.whenReady().then(() => {
  createBarWindow();

  globalShortcut.register("Ctrl+Shift+Space", toggleBar);

  ipcMain.on("hide-bar", () => hideBar());

  ipcMain.on("resize-bar", (event, contentHeight) => {
    if (!barWindow) return;
    const bounds = barWindow.getBounds();
    const nextBounds = getCenteredBounds(Math.round(contentHeight));
    barWindow.setBounds({ ...nextBounds, x: bounds.x, y: bounds.y });
  });

  ipcMain.handle("lookup-word", async (event, word) => {
    return lookupWord(word);
  });
});

app.on("window-all-closed", (event) => {
  // The bar hides rather than closes, and the app has no other windows yet,
  // so this only fires on real quit (Cmd/Ctrl+Q equivalents) — nothing to do.
  event.preventDefault();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

async function lookupWord(word) {
  if (!config.MW_API_KEY) {
    return {
      ok: false,
      error:
        "No API key configured. Copy config.example.js to config.js and add your Merriam-Webster key.",
    };
  }

  const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(
    word
  )}?key=${config.MW_API_KEY}`;

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

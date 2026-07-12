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
  clipboard,
} = require("electron");
const path = require("path");
const { execFile } = require("child_process");
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
    floatingIcon: { enabled: false, x: null, y: null, pinned: false },
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
const ICON_WINDOW_SIZE = 44;

let barWindow = null;
let settingsWindow = null;
let iconWindow = null;
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

// options.selection distinguishes "plain summon" (word/hint ignored, renderer
// keeps whatever was there before — the Task 1/2 behavior) from a
// selection-triggered summon, where word/hint (even if empty) should
// override the input box.
function showBar(options = {}) {
  if (!barWindow) return;
  const { selection = false, word = null, hint = null } = options;
  const bounds = barWindow.getBounds();
  barWindow.setBounds(getCenteredBounds(bounds.height));
  barWindow.show();
  barWindow.focus();
  barWindow.webContents.send("bar-shown", { selection, word, hint });
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sends Ctrl+C to whatever window currently has OS focus. We deliberately
// never show/focus our own window before calling this — globalShortcut
// fires without stealing focus, so the app the user was selecting text in
// (browser, Notepad, etc.) is still the foreground window, and PowerShell
// runs hidden so it can't steal focus either. SendKeys is the "boring"
// choice here: it ships with Windows, needs zero npm dependencies, and
// avoids the native-module/ABI-rebuild headaches of something like
// robotjs. The tradeoff is ~100-300ms of process-spawn latency per call,
// which is why we still cap the whole flow with the 150ms settle wait below
// rather than trying to shave it further.
//
// Sending that keystroke also has a side effect: Windows now considers
// PowerShell (not our app) the process that "recently generated input,"
// which is the only process Windows normally lets call SetForegroundWindow
// without restriction. Without a fix, our subsequent barWindow.focus() call
// in showBar() is silently downgraded — the window still becomes visible
// (it's alwaysOnTop) but never actually receives OS keyboard focus, so Esc
// keydowns go nowhere and no blur event ever fires when clicking away. The
// fix is AllowSetForegroundWindow: while PowerShell still holds that
// privilege, it explicitly hands it to our own process (by pid) so the
// focus() call right after actually works.
function sendCtrlC() {
  // process.pid is a plain integer we control, so it's safe to embed
  // directly in the script text — no quoting/escaping needed, and it
  // sidesteps a PowerShell CLI quirk where trailing execFile args after
  // "-Command" get glued onto the end of the script as literal text
  // instead of populating $args the way "-File" would.
  const psCommand =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "[System.Windows.Forms.SendKeys]::SendWait('^c'); " +
    "Add-Type -Name ForegroundHelper -Namespace Win32Interop -MemberDefinition " +
    "'[DllImport(\"user32.dll\")] public static extern bool AllowSetForegroundWindow(int dwProcessId);'; " +
    `[Win32Interop.ForegroundHelper]::AllowSetForegroundWindow(${process.pid}) | Out-Null`;

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-WindowStyle",
        "Hidden",
        "-Command",
        psCommand,
      ],
      { windowsHide: true, timeout: 3000 },
      (error) => resolve(!error)
    );
  });
}

// A snapshot of "what was on the clipboard before we touched it." We only
// capture/restore the plain-text (and paired HTML, for rich-text copies)
// representation. If the clipboard held something else — an image, a file
// from Explorer — readText() comes back empty while availableFormats()
// isn't, so isText is false and restoreClipboardSnapshot below skips the
// write entirely rather than guessing how to reconstruct it.
function captureClipboardSnapshot() {
  const formats = clipboard.availableFormats();
  const text = clipboard.readText();
  const isText = formats.length === 0 || text.length > 0;
  return {
    isText,
    text,
    html: isText ? clipboard.readHTML() : null,
  };
}

function restoreClipboardSnapshot(snapshot) {
  if (!snapshot.isText) return;
  if (snapshot.html) {
    clipboard.write({ text: snapshot.text, html: snapshot.html });
  } else {
    clipboard.writeText(snapshot.text);
  }
}

// trim -> first word only -> strip surrounding punctuation -> lowercase ->
// reject empty/too-long/no-letters. Returns "" for anything rejected.
function sanitizeSelection(raw) {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const firstToken = trimmed.split(/\s+/)[0];
  const stripped = firstToken.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const word = stripped.toLowerCase();
  if (!word || word.length > 30) return "";
  if (!/\p{L}/u.test(word)) return "";
  return word;
}

async function handleSelectionHotkey() {
  // 1. Save whatever is on the clipboard right now.
  const before = captureClipboardSnapshot();

  // 2. Ask the OS to send Ctrl+C to the still-focused foreground window.
  const sendOk = await sendCtrlC();

  // 3. Give the target app a moment to actually respond to the keystroke
  // and write to the clipboard before we go read it.
  await sleep(150);

  // 4. Read whatever landed there.
  const after = captureClipboardSnapshot();

  // 5. Put the user's original clipboard contents back, immediately —
  // before we do anything else with the grabbed text.
  restoreClipboardSnapshot(before);

  const grabbedNewText = sendOk && after.text.length > 0 && after.text !== before.text;

  if (!grabbedNewText) {
    // Either SendKeys itself failed, or the clipboard is byte-for-byte
    // the same as before — meaning nothing was selected, or the
    // foreground window (often an elevated/admin one) blocked the
    // synthetic keystroke. Either way, we didn't get anything new.
    showBar({
      selection: true,
      word: "",
      hint: "Couldn't grab the selection — type the word instead",
    });
    return;
  }

  // 6. Sanitize. A rejected result (whole sentence with no clean single
  // word, pure punctuation, etc.) just shows the empty bar, no hint —
  // we did grab a selection, it just wasn't lookup-shaped.
  const word = sanitizeSelection(after.text);
  showBar({ selection: true, word, hint: null });
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

function getDefaultFloatingIconPosition() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    x: width - ICON_WINDOW_SIZE,
    y: Math.round((height - ICON_WINDOW_SIZE) / 2),
  };
}

function createFloatingIconWindow() {
  const fi = store.get("floatingIcon");
  const pos =
    fi.x != null && fi.y != null ? { x: fi.x, y: fi.y } : getDefaultFloatingIconPosition();

  iconWindow = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: ICON_WINDOW_SIZE,
    height: ICON_WINDOW_SIZE,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    // Not focusable: clicking the icon must never steal OS keyboard focus
    // away from whatever the user was doing. Focus and mouse clicks are
    // separate OS-level concerns — this only opts the window out of ever
    // becoming the active/focused window (no WM_SETFOCUS), while mouse
    // hit-testing (mousedown/mousemove/mouseup/click) still works normally,
    // so dragging and clicking both function exactly as if it were a
    // regular window.
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  iconWindow.loadFile(path.join(__dirname, "src", "floating-icon", "icon.html"), {
    query: { theme: getEffectiveTheme(), pinned: String(fi.pinned) },
  });
}

function moveFloatingIcon(x, y) {
  if (!iconWindow) return;
  iconWindow.setPosition(Math.round(x), Math.round(y));
}

// Called on mouseup once a real drag (not just a click) happened. This is
// "released" — there's no polling involved, the renderer's own mouseup
// event is the signal, forwarded to us over IPC.
function endFloatingIconDrag() {
  if (!iconWindow) return;
  const [x, y] = iconWindow.getPosition();
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const centerX = x + ICON_WINDOW_SIZE / 2;
  const snappedX =
    centerX < screenWidth / 2 ? 0 : screenWidth - ICON_WINDOW_SIZE;
  const clampedY = Math.max(0, Math.min(y, screenHeight - ICON_WINDOW_SIZE));

  iconWindow.setPosition(snappedX, clampedY);

  const fi = store.get("floatingIcon");
  store.set("floatingIcon", { ...fi, x: snappedX, y: clampedY });
}

function toggleFloatingIconPinned() {
  const fi = store.get("floatingIcon");
  const pinned = !fi.pinned;
  store.set("floatingIcon", { ...fi, pinned });
  if (iconWindow) {
    iconWindow.webContents.send("floating-icon-pinned-changed", pinned);
  }
}

function setFloatingIconEnabled(enabled) {
  const fi = store.get("floatingIcon");
  store.set("floatingIcon", { ...fi, enabled });
  if (iconWindow) {
    if (enabled) {
      iconWindow.show();
    } else {
      iconWindow.hide();
    }
  }
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("floating-icon-enabled-changed", enabled);
  });
}

function showFloatingIconMenu() {
  const fi = store.get("floatingIcon");
  const menu = Menu.buildFromTemplate([
    { label: fi.pinned ? "Unpin" : "Pin", click: toggleFloatingIconPinned },
    { label: "Hide floating icon", click: () => setFloatingIconEnabled(false) },
    { type: "separator" },
    { label: "Settings", click: createSettingsWindow },
  ]);
  menu.popup({ window: iconWindow });
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
  createFloatingIconWindow();
  createTray();

  if (store.get("floatingIcon").enabled) {
    iconWindow.show();
  }

  nativeTheme.on("updated", broadcastTheme);

  globalShortcut.register("Ctrl+Shift+Space", toggleBar);
  globalShortcut.register("Ctrl+Shift+D", handleSelectionHotkey);

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

  ipcMain.on("move-floating-icon", (event, x, y) => moveFloatingIcon(x, y));
  ipcMain.on("end-floating-icon-drag", () => endFloatingIconDrag());
  ipcMain.on("click-floating-icon", () => toggleBar());
  ipcMain.on("show-floating-icon-menu", () => showFloatingIconMenu());

  ipcMain.handle("get-floating-icon-settings", () => {
    const fi = store.get("floatingIcon");
    return { enabled: fi.enabled, pinned: fi.pinned };
  });

  ipcMain.handle("set-floating-icon-enabled", (event, enabled) => {
    setFloatingIconEnabled(enabled);
    return true;
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

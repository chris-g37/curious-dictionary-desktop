// Preload runs in the renderer's process but with Node access, before the
// page's own scripts. It's the only bridge between the sandboxed renderer
// (bar.js, no Node/OS access) and the main process. We hand-pick exactly the
// functions the renderer needs — nothing else crosses the wall.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  lookupWord: (word) => ipcRenderer.invoke("lookup-word", word),
  hideBar: () => ipcRenderer.send("hide-bar"),
  resizeBar: (contentHeight) => ipcRenderer.send("resize-bar", contentHeight),
  onBarShown: (callback) =>
    ipcRenderer.on("bar-shown", (event, payload) => callback(payload)),

  getRecentHistory: () => ipcRenderer.invoke("get-recent-history"),
  requestClearHistory: () => ipcRenderer.invoke("request-clear-history"),

  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveApiKey: (key) => ipcRenderer.invoke("save-api-key", key),
  saveTheme: (theme) => ipcRenderer.invoke("save-theme", theme),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  getEffectiveTheme: () => ipcRenderer.invoke("get-effective-theme"),
  onThemeChanged: (callback) =>
    ipcRenderer.on("theme-changed", (event, theme) => callback(theme)),
});

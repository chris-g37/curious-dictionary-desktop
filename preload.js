// Preload runs in the renderer's process but with Node access, before the
// page's own scripts. It's the only bridge between the sandboxed renderer
// (bar.js, no Node/OS access) and the main process. We hand-pick exactly the
// functions the renderer needs — nothing else crosses the wall.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  lookupWord: (word) => ipcRenderer.invoke("lookup-word", word),
  hideBar: () => ipcRenderer.send("hide-bar"),
  resizeBar: (contentHeight) => ipcRenderer.send("resize-bar", contentHeight),
  onBarShown: (callback) => ipcRenderer.on("bar-shown", callback),
});

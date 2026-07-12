const btn = document.getElementById("icon-btn");
const pinDot = document.getElementById("pin-dot");

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get("theme") || "light";
pinDot.classList.toggle("visible", params.get("pinned") === "true");

window.api.onThemeChanged((theme) => {
  document.documentElement.dataset.theme = theme;
});

window.api.onFloatingIconPinnedChanged((pinned) => {
  pinDot.classList.toggle("visible", pinned);
});

// Dragging is done entirely by hand rather than native OS window-drag,
// because we need to know exactly when the mouse button is released (to
// snap to an edge) and whether the mouse actually moved (to tell a drag
// apart from a plain click). Both mousemove and mouseup keep firing on
// `window` for the whole gesture even once the cursor strays outside our
// tiny 44px window — the browser implicitly captures the mouse to us from
// the moment mousedown fires until the next mouseup, the same mechanism
// that lets you drag a slider past the edge of a normal web page.
const DRAG_THRESHOLD = 4;
let dragging = false;
let hasMoved = false;
let startScreenX = 0;
let startScreenY = 0;
let offsetX = 0;
let offsetY = 0;

btn.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  dragging = true;
  hasMoved = false;
  startScreenX = event.screenX;
  startScreenY = event.screenY;
  offsetX = event.clientX;
  offsetY = event.clientY;
  event.preventDefault();
});

window.addEventListener("mousemove", (event) => {
  if (!dragging) return;

  if (!hasMoved) {
    const dist = Math.hypot(event.screenX - startScreenX, event.screenY - startScreenY);
    if (dist < DRAG_THRESHOLD) return;
    hasMoved = true;
    btn.style.cursor = "grabbing";
  }

  window.api.moveFloatingIcon(event.screenX - offsetX, event.screenY - offsetY);
});

// This is "released": a mouseup while a drag was in progress. If the
// pointer never moved past the threshold, it was a click, not a drag.
window.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  btn.style.cursor = "grab";

  if (hasMoved) {
    window.api.endFloatingIconDrag();
  } else {
    window.api.clickFloatingIcon();
  }
});

btn.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.api.showFloatingIconMenu();
});

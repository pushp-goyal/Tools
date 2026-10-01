// Toolbar icon (or its shortcut, default Alt+Shift+D) shows / hides the
// notes tool on every tab.
chrome.action.onClicked.addListener(async () => {
  const { rpdnActive } = await chrome.storage.local.get("rpdnActive");
  await chrome.storage.local.set({ rpdnActive: !rpdnActive, rpdnPicking: !rpdnActive });
});

// "Start / pause selecting" shortcut (default Alt+S). It is a browser command,
// so anyone can change it at chrome://extensions/shortcuts. It also shows the
// tool if it was hidden.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-selecting") return;
  const { rpdnActive, rpdnPicking } = await chrome.storage.local.get(["rpdnActive", "rpdnPicking"]);
  if (!rpdnActive) await chrome.storage.local.set({ rpdnActive: true, rpdnPicking: true });
  else await chrome.storage.local.set({ rpdnPicking: !rpdnPicking });
});

async function shortcuts() {
  const all = await chrome.commands.getAll();
  const find = (name) => (all.find((c) => c.name === name) || {}).shortcut || "";
  return { toggle: find("toggle-selecting"), show: find("_execute_action") };
}

// First install: open the settings page once so people see the shortcuts and options.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

// Note count on the toolbar badge.
async function updateBadge() {
  const { rpdnNotes = [] } = await chrome.storage.local.get("rpdnNotes");
  chrome.action.setBadgeBackgroundColor({ color: "#0d6efd" });
  chrome.action.setBadgeText({ text: rpdnNotes.length ? String(rpdnNotes.length) : "" });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.rpdnNotes) updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);

// ---------- screenshots ----------
// The content script asks for a screenshot of the visible tab, cropped around
// the picked element with a red outline. On save it goes to
// Downloads/design-notes/ and the note keeps the full path, so the copied
// prompt can point the agent at the file.

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function capture(windowId, rect, view) {
  const full = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  if (!rect) return full;

  const bmp = await createImageBitmap(await (await fetch(full)).blob());
  const scale = bmp.width / view.w;

  // Element plus some room around it, at least 480x260 CSS px so there is context.
  const pad = 40;
  let x0 = rect.left - pad;
  let y0 = rect.top - pad;
  let x1 = rect.right + pad;
  let y1 = rect.bottom + pad;
  const grow = (a, b, min) => {
    const extra = Math.max(0, min - (b - a)) / 2;
    return [a - extra, b + extra];
  };
  [x0, x1] = grow(x0, x1, 480);
  [y0, y1] = grow(y0, y1, 260);
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(view.w, x1);
  y1 = Math.min(view.h, y1);

  const w = Math.round((x1 - x0) * scale);
  const h = Math.round((y1 - y0) * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, Math.round(x0 * scale), Math.round(y0 * scale), w, h, 0, 0, w, h);
  ctx.strokeStyle = "#EF4444";
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect((rect.left - x0) * scale, (rect.top - y0) * scale, rect.width * scale, rect.height * scale);
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

function waitForDownload(id) {
  return new Promise((resolve) => {
    const done = (state) => {
      chrome.downloads.onChanged.removeListener(onChange);
      resolve(state);
    };
    const onChange = (d) => {
      if (d.id === id && d.state && d.state.current !== "in_progress") done(d.state.current);
    };
    chrome.downloads.onChanged.addListener(onChange);
    chrome.downloads.search({ id }).then(([item]) => {
      if (item && item.state !== "in_progress") done(item.state);
    });
  });
}

// Save into Downloads/design-notes/ without Chrome's download bubble.
async function saveToDownloads(url, name) {
  try {
    await chrome.downloads.setUiOptions({ enabled: false });
  } catch (e) {}
  try {
    const id = await chrome.downloads.download({
      url,
      filename: "design-notes/" + name,
      conflictAction: "uniquify",
      saveAs: false,
    });
    const state = await waitForDownload(id);
    if (state !== "complete") throw new Error("File was not saved");
    const [item] = await chrome.downloads.search({ id });
    return { id, path: item.filename };
  } finally {
    try {
      await chrome.downloads.setUiOptions({ enabled: true });
    } catch (e) {}
  }
}

function saveShot(dataUrl, name) {
  return saveToDownloads(dataUrl, name);
}

// The whole prompt as a .md / .json file next to the screenshots, then the
// folder opens (Finder, Explorer or the Linux file manager) so the files can
// be dragged into any chat app.
async function saveNotesFile(text, ext) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const type = ext === "json" ? "application/json" : "text/markdown";
  const res = await saveToDownloads("data:" + type + ";charset=utf-8," + encodeURIComponent(text), "notes-" + stamp + "." + ext);
  chrome.downloads.show(res.id);
  return res;
}

async function deleteShots(ids) {
  for (const id of ids) {
    try {
      await chrome.downloads.removeFile(id);
    } catch (e) {}
    try {
      await chrome.downloads.erase({ id });
    } catch (e) {}
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = async () => {
    if (msg.type === "capture") return { dataUrl: await capture(sender.tab.windowId, msg.rect, msg.view) };
    if (msg.type === "saveShot") return saveShot(msg.dataUrl, msg.name);
    if (msg.type === "saveNotesFile") return saveNotesFile(msg.text, msg.ext);
    if (msg.type === "shortcuts") return shortcuts();
    if (msg.type === "settings") return chrome.runtime.openOptionsPage();
    if (msg.type === "deleteShots") return deleteShots(msg.ids);
    return null;
  };
  run()
    .then(reply)
    .catch((e) => reply({ error: String(e && e.message ? e.message : e) }));
  return true;
});

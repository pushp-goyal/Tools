// Design Notes - hover an element, click it, type what should change.
// Notes live in the browser's extension storage so they survive page changes,
// then "Copy all" (or "Save file") turns them into one prompt for any AI
// coding agent. Nothing leaves the browser.
(() => {
  if (window.top !== window) return;

  const K_NOTES = "rpdnNotes";
  const K_ACTIVE = "rpdnActive";
  const K_PICK = "rpdnPicking";
  const K_DOCK = "rpdnDockLeft";
  const K_SETTINGS = "dnSettings";

  const DEFAULT_SETTINGS = self.DN_DEFAULTS; // defaults.js
  const DEFAULT_INTRO = DEFAULT_SETTINGS.intro;

  let notes = [];
  let active = false;
  let picking = false;
  let dockLeft = false;
  let minimized = false;
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let keys = { toggle: "Alt+S", show: "Alt+Shift+D" };

  let host, root, hoverBox, hoverLabel, markersEl, panel, listEl, countEl, pickBtn, clearBtn, copyBtn, fileBtn, hintEl;
  let editor, edSel, edText, edShotRow, edShot, edShotTxt, edThumb, edSaveBtn;
  let pending = null; // snapshot of the element being commented
  let editIndex = -1; // -1 = new note
  let hovered = null;
  let rafId = 0;
  let clearTimer = 0;
  let capturing = false; // taking a screenshot, page clicks stay blocked
  let saving = false;

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  // ---------- page + element info ----------

  // Served pages give a path relative to the site root; file:// pages keep
  // the full disk path so the agent can still find the file.
  function pagePath() {
    const p = decodeURIComponent(location.pathname);
    if (location.protocol === "file:") return p;
    return p.replace(/^\//, "") || "/";
  }

  function site() {
    return location.protocol === "file:" ? "file://" : location.origin;
  }

  const here = () => site() + " " + pagePath();
  const noteKey = (n) => (n.site || "") + " " + n.page;

  // State classes and machine-made class names (CSS-in-JS hashes, Tailwind
  // variants) make selectors brittle, so they are left out.
  const STATE_CLASS = /^(show|showing|active|hover|focus|focused|open|collapsed|collapsing|fade|in|was-validated|is-active|is-open)$/;
  const MACHINE_CLASS = /^(css|sc|jsx|emotion|svelte|astro)-[a-z0-9]+$|[:[\]\/!@]/i;
  const TEST_ATTRS = ["data-testid", "data-test", "data-cy", "data-qa", "data-test-id"];

  // Generated ids (React useId ":r1:", "ember123", long numbers) change between renders.
  function stableId(id) {
    return !!id && !id.includes(":") && !/^(ember|ext-gen|yui_|mui-|radix-|headlessui-)/.test(id) && !/\d{4,}/.test(id);
  }

  function count(sel) {
    try {
      return document.querySelectorAll(sel).length;
    } catch (e) {
      return 0;
    }
  }

  // The best single-node anchor: a stable unique id, or a unique test attribute.
  function anchorFor(node) {
    if (stableId(node.id) && count("#" + CSS.escape(node.id)) === 1) return "#" + CSS.escape(node.id);
    for (const a of TEST_ATTRS) {
      const v = node.getAttribute(a);
      if (v) {
        const sel = "[" + a + '="' + CSS.escape(v) + '"]';
        if (count(sel) === 1) return sel;
      }
    }
    return null;
  }

  function selectorFor(el) {
    const own = anchorFor(el);
    if (own) return own;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node !== el) {
        const a = anchorFor(node);
        if (a) {
          parts.unshift(a);
          break;
        }
      }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((c) => !STATE_CLASS.test(c) && !MACHINE_CLASS.test(c)).slice(0, 3);
      if (classes.length) part += "." + classes.map((c) => CSS.escape(c)).join(".");
      const parent = node.parentElement;
      if (parent) {
        const twins = [...parent.children].filter((c) => {
          try {
            return c.matches(part);
          } catch (e) {
            return false;
          }
        });
        if (twins.length > 1) {
          const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
          part += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
        }
      }
      parts.unshift(part);
      if (count(parts.join(" > ")) === 1) break;
      node = parent;
    }
    return parts.join(" > ");
  }

  // Named ancestors (dialogs, drawers and menus flagged) so the agent can find
  // the spot quickly in large pages.
  function contextFor(el) {
    const out = [];
    let node = el.parentElement;
    while (node && node !== document.body && out.length < 3) {
      const a = anchorFor(node);
      if (a) {
        let label = a;
        const role = node.getAttribute("role");
        const cls = node.classList;
        if (node.tagName === "DIALOG" || role === "dialog" || role === "alertdialog" || cls.contains("modal")) label += " (dialog)";
        else if (cls.contains("offcanvas") || cls.contains("drawer")) label += " (drawer)";
        else if (role === "menu" || cls.contains("dropdown-menu")) label += " (menu)";
        out.unshift(label);
      }
      node = node.parentElement;
    }
    return out.join(" > ");
  }

  function openingTag(el) {
    const html = el.outerHTML;
    let tag = html.slice(0, html.indexOf(">") + 1).replace(/\s+/g, " ");
    if (tag.length > 240) tag = tag.slice(0, 237) + "...>";
    return tag;
  }

  function textOf(el) {
    const raw = el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("alt") || "";
    const t = String(raw).replace(/\s+/g, " ").trim();
    return t.length > 90 ? t.slice(0, 87) + "..." : t;
  }

  function shortLabel(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = [...el.classList].slice(0, 3);
    if (cls.length) s += "." + cls.join(".");
    const r = el.getBoundingClientRect();
    return s + "  " + Math.round(r.width) + "x" + Math.round(r.height);
  }

  function baseSnapshot() {
    return {
      site: site(),
      page: pagePath(),
      url: location.href,
      viewport: window.innerWidth + "x" + window.innerHeight,
    };
  }

  function snapshot(el) {
    return Object.assign(baseSnapshot(), {
      selector: selectorFor(el),
      context: contextFor(el),
      tag: openingTag(el),
      text: textOf(el),
    });
  }

  function findOnPage(note) {
    if (note.whole || noteKey(note) !== here()) return null;
    try {
      return document.querySelector(note.selector);
    } catch (e) {
      return null;
    }
  }

  // ---------- export ----------

  const intro = () => (settings.intro || DEFAULT_INTRO).trim();

  function groups() {
    const out = [];
    notes.forEach((n) => {
      const k = noteKey(n);
      let g = out.find((x) => x.key === k);
      if (!g) out.push((g = { key: k, site: n.site, page: n.page, url: n.url, notes: [] }));
      g.notes.push(n);
    });
    return out;
  }

  function buildMarkdown() {
    const lines = [intro(), ""];
    const gs = groups();
    const manySites = new Set(gs.map((g) => g.site)).size > 1;
    let i = 0;
    gs.forEach((g) => {
      const name = g.site === "file://" || !manySites ? g.page : g.site + "/" + g.page;
      lines.push("## " + name);
      lines.push("URL: " + g.url, "");
      g.notes.forEach((n) => {
        i += 1;
        lines.push("### " + i + ".");
        if (n.whole) {
          lines.push("- Area: whole screen, scrolled " + (n.scroll || 0) + "px down");
        } else {
          lines.push("- Selector: `" + n.selector + "`");
          if (n.context) lines.push("- Inside: `" + n.context + "`");
          lines.push("- Element: `" + n.tag + "`");
          if (n.text) lines.push('- Text: "' + n.text + '"');
        }
        lines.push("- Viewport: " + n.viewport);
        if (n.shot) lines.push("- Screenshot: `" + n.shot + "`");
        lines.push("- Change: " + n.comment.replace(/\n/g, "\n  "));
        lines.push("");
      });
    });
    return lines.join("\n").trim() + "\n";
  }

  function buildJson() {
    const list = notes.map((n, i) => {
      const o = { n: i + 1, url: n.url, page: n.page, viewport: n.viewport };
      if (n.whole) o.area = "whole screen, scrolled " + (n.scroll || 0) + "px down";
      else {
        o.selector = n.selector;
        if (n.context) o.inside = n.context;
        o.element = n.tag;
        if (n.text) o.text = n.text;
      }
      if (n.shot) o.screenshot = n.shot;
      o.change = n.comment;
      return o;
    });
    return JSON.stringify({ instructions: intro(), notes: list }, null, 2) + "\n";
  }

  const buildExport = () => (settings.format === "json" ? buildJson() : buildMarkdown());

  async function copyText(txt) {
    try {
      await navigator.clipboard.writeText(txt);
      return true;
    } catch (e) {
      // Pages that are not a secure context block the async clipboard.
      const ta = document.createElement("textarea");
      ta.value = txt;
      root.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  // ---------- storage ----------

  function saveNotes() {
    chrome.storage.local.set({ [K_NOTES]: notes });
  }

  function setPicking(on) {
    picking = on;
    chrome.storage.local.set({ [K_PICK]: on });
    renderPanel();
    if (!on) hideHover();
  }

  // ---------- UI ----------

  function build() {
    host = document.createElement("design-notes-ui");
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <link rel="stylesheet" href="${chrome.runtime.getURL("panel.css")}">
      <div class="wrap">
        <div class="hover-box"></div>
        <div class="hover-label"></div>
        <div class="markers"></div>
        <div class="panel">
          <div class="head">
            <strong>Design notes</strong>
            <span class="count">0</span>
            <span class="spacer"></span>
            <button class="pick" data-act="pick"><span class="dot"></span><span class="pick-txt"></span></button>
            <button class="icon" data-act="settings" title="Settings">&#9881;</button>
            <button class="icon" data-act="dock" title="Move to other side">&#8646;</button>
            <button class="icon" data-act="min" title="Minimize">-</button>
            <button class="icon" data-act="close">&#10005;</button>
          </div>
          <div class="body">
            <div class="bar">
              <button data-act="snap" title="Add a note with a screenshot of the whole visible screen">Screenshot</button>
              <span class="spacer"></span>
              <button data-act="clear">Clear</button>
              <button data-act="file" title="Save the notes as a file next to the screenshots and open that folder">Save file</button>
              <button class="primary" data-act="copy">Copy all</button>
            </div>
            <ul class="list"></ul>
            <div class="hint"></div>
          </div>
        </div>
        <div class="editor">
          <div class="ed-sel"></div>
          <textarea placeholder="What should change here?"></textarea>
          <label class="ed-shot">
            <input type="checkbox" checked>
            <span class="ed-shot-txt">Attach screenshot</span>
            <img class="ed-thumb" alt="">
          </label>
          <div class="ed-foot">
            <span>Enter saves, Shift+Enter new line</span>
            <button data-act="ed-del">Delete</button>
            <button data-act="ed-cancel">Cancel</button>
            <button class="primary" data-act="ed-save">Save</button>
          </div>
        </div>
      </div>`;

    hoverBox = root.querySelector(".hover-box");
    hoverLabel = root.querySelector(".hover-label");
    markersEl = root.querySelector(".markers");
    panel = root.querySelector(".panel");
    listEl = root.querySelector(".list");
    countEl = root.querySelector(".count");
    pickBtn = root.querySelector('[data-act="pick"]');
    clearBtn = root.querySelector('[data-act="clear"]');
    copyBtn = root.querySelector('[data-act="copy"]');
    fileBtn = root.querySelector('[data-act="file"]');
    hintEl = root.querySelector(".hint");
    editor = root.querySelector(".editor");
    edSel = root.querySelector(".ed-sel");
    edText = root.querySelector("textarea");
    edShotRow = root.querySelector(".ed-shot");
    edShot = edShotRow.querySelector("input");
    edShotTxt = edShotRow.querySelector(".ed-shot-txt");
    edThumb = edShotRow.querySelector(".ed-thumb");
    edSaveBtn = root.querySelector('[data-act="ed-save"]');

    root.addEventListener("click", onUiClick);
    edText.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        saveEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeEditor();
      }
    });
    // Keep typing and focus inside the tool away from the page. Modal and
    // drawer libraries trap focus with a document "focusin" listener and would
    // pull the cursor out of the comment box, so focus events stop here.
    ["keydown", "keyup", "keypress", "input", "focusin", "focusout", "focus", "blur"].forEach((t) =>
      host.addEventListener(t, (e) => e.stopPropagation())
    );

    document.documentElement.appendChild(host);
    send({ type: "shortcuts" }).then((k) => {
      if (k) keys = k;
      renderPanel();
    });
  }

  function onUiClick(e) {
    const btn = e.target.closest("[data-act]");
    const li = e.target.closest("li[data-i]");
    if (btn) {
      const act = btn.dataset.act;
      if (act === "pick") setPicking(!picking);
      else if (act === "min") {
        minimized = !minimized;
        renderPanel();
      } else if (act === "dock") {
        dockLeft = !dockLeft;
        chrome.storage.local.set({ [K_DOCK]: dockLeft });
        renderPanel();
      } else if (act === "settings") send({ type: "settings" });
      else if (act === "close") chrome.storage.local.set({ [K_ACTIVE]: false });
      else if (act === "copy") onCopy();
      else if (act === "file") onFile();
      else if (act === "clear") onClear();
      else if (act === "snap") snapScreen();
      else if (act === "del") {
        dropShots(notes.splice(Number(btn.dataset.i), 1));
        saveNotes();
        renderPanel();
      } else if (act === "ed-save") saveEditor();
      else if (act === "ed-cancel") closeEditor();
      else if (act === "ed-del") {
        if (editIndex >= 0) {
          dropShots(notes.splice(editIndex, 1));
          saveNotes();
        }
        closeEditor();
      }
      return;
    }
    if (li) editExisting(Number(li.dataset.i));
  }

  function flash(btn, text, back) {
    btn.textContent = text;
    setTimeout(() => (btn.textContent = back), 1600);
  }

  async function onCopy() {
    if (!notes.length) return;
    const ok = await copyText(buildExport());
    flash(copyBtn, ok ? "Copied " + notes.length : "Copy failed", "Copy all");
  }

  // For chat apps that cannot open files by path: save the prompt next to the
  // screenshots and open that folder, so everything can be dragged in at once.
  async function onFile() {
    if (!notes.length) return;
    const ext = settings.format === "json" ? "json" : "md";
    const res = await send({ type: "saveNotesFile", text: buildExport(), ext });
    flash(fileBtn, res && res.path ? "Saved" : "Save failed", "Save file");
  }

  function onClear() {
    if (!notes.length) return;
    if (clearBtn.classList.contains("danger")) {
      clearTimeout(clearTimer);
      dropShots(notes);
      notes = [];
      saveNotes();
      clearBtn.classList.remove("danger");
      clearBtn.textContent = "Clear";
      renderPanel();
      return;
    }
    clearBtn.classList.add("danger");
    clearBtn.textContent = "Clear all?";
    clearTimer = setTimeout(() => {
      clearBtn.classList.remove("danger");
      clearBtn.textContent = "Clear";
    }, 3000);
  }

  function renderPanel() {
    if (!host) return;
    host.style.display = active ? "" : "none";
    document.documentElement.classList.toggle("rpdn-selecting", active && picking);
    panel.classList.toggle("min", minimized);
    panel.classList.toggle("left", dockLeft);
    countEl.textContent = notes.length;
    pickBtn.querySelector(".pick-txt").textContent = picking ? "Selecting" : "Paused";
    pickBtn.classList.toggle("on", picking);
    pickBtn.title = "Start / pause selecting" + (keys.toggle ? " (" + keys.toggle + ")" : "");
    root.querySelector('[data-act="close"]').title = "Hide" + (keys.show ? " (" + keys.show + ")" : "");

    hintEl.textContent = "";
    const b = document.createElement("b");
    b.textContent = keys.toggle || "The Selecting pill";
    hintEl.append(
      b,
      " starts or pauses selecting. Pause to use the page normally (open a dialog, scroll, change pages), then start again to add notes. Esc also pauses."
    );

    listEl.textContent = "";
    if (!notes.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No notes yet. Hover an element and click it.";
      listEl.appendChild(li);
    }
    const now = here();
    notes.forEach((n, i) => {
      const li = document.createElement("li");
      li.dataset.i = i;
      li.title = "Click to edit";
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = i + 1;
      const main = document.createElement("div");
      main.className = "li-main";
      const sel = document.createElement("div");
      sel.className = "li-sel";
      sel.textContent = (noteKey(n) === now ? "" : n.page + "  ") + (n.whole ? "Whole screen" : n.selector);
      const txt = document.createElement("div");
      txt.className = "li-txt";
      txt.textContent = n.comment;
      main.append(sel, txt);
      if (n.shot) {
        const tag = document.createElement("span");
        tag.className = "shot-tag";
        tag.textContent = "Screenshot";
        main.append(tag);
      }
      const del = document.createElement("button");
      del.className = "icon";
      del.dataset.act = "del";
      del.dataset.i = i;
      del.title = "Delete note";
      del.textContent = "✕";
      li.append(num, main, del);
      listEl.appendChild(li);
    });
    scheduleMarkers();
  }

  function scheduleMarkers() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      drawMarkers();
      if (hovered && picking && !editorOpen()) drawHover(hovered);
    });
  }

  // Hidden, closed (dialog / drawer / collapse) or zero-size elements get no marker.
  function isShown(el) {
    if (!el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function drawMarkers() {
    if (!markersEl) return;
    markersEl.textContent = "";
    if (!active) return;
    notes.forEach((n, i) => {
      const el = findOnPage(n);
      if (!el || !isShown(el)) return;
      const r = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "marker-outline";
      Object.assign(box.style, { top: r.top + "px", left: r.left + "px", width: r.width + "px", height: r.height + "px" });
      const m = document.createElement("div");
      m.className = "marker";
      m.textContent = i + 1;
      Object.assign(m.style, { top: Math.max(0, r.top - 9) + "px", left: Math.max(0, r.left - 9) + "px" });
      markersEl.append(box, m);
    });
  }

  function drawHover(el) {
    const r = el.getBoundingClientRect();
    Object.assign(hoverBox.style, {
      display: "block",
      top: r.top + "px",
      left: r.left + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
    hoverLabel.textContent = shortLabel(el);
    const top = r.top > 22 ? r.top - 22 : r.bottom + 4;
    Object.assign(hoverLabel.style, { display: "block", top: top + "px", left: Math.max(0, r.left) + "px" });
  }

  function hideHover() {
    hovered = null;
    if (hoverBox) hoverBox.style.display = "none";
    if (hoverLabel) hoverLabel.style.display = "none";
  }

  // ---------- editor ----------

  function editorOpen() {
    return !!editor && editor.classList.contains("open");
  }

  function openEditor(el, snap, index) {
    pending = snap;
    editIndex = index;
    edSel.textContent = snap.whole ? "Whole screen" : snap.selector;
    edText.value = index >= 0 ? notes[index].comment : "";
    edSaveBtn.textContent = "Save";
    // New note: attach the screenshot just taken. Existing note: keep or drop the saved one.
    const shotUrl = index >= 0 ? null : snap.shotData;
    const hasShot = index >= 0 ? !!notes[index].shot : !!shotUrl;
    edShotRow.style.display = hasShot ? "" : "none";
    edShot.checked = index >= 0 ? true : settings.shots !== false;
    edShotTxt.textContent = index >= 0 ? "Keep screenshot" : "Attach screenshot";
    edThumb.style.display = shotUrl ? "" : "none";
    edThumb.src = shotUrl || "";
    root.querySelector('[data-act="ed-del"]').style.display = index >= 0 ? "" : "none";
    editor.classList.add("open");

    const w = 320;
    const h = editor.offsetHeight || 180;
    let top = window.innerHeight / 2 - h / 2;
    let left = window.innerWidth / 2 - w / 2;
    if (el) {
      const r = el.getBoundingClientRect();
      drawHover(el);
      top = r.bottom + 8 + h < window.innerHeight ? r.bottom + 8 : r.top - h - 8;
      left = r.left;
    }
    top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    Object.assign(editor.style, { top: top + "px", left: left + "px" });
    setTimeout(() => edText.focus(), 0);
  }

  function closeEditor() {
    editor.classList.remove("open");
    pending = null;
    editIndex = -1;
    hideHover();
    renderPanel();
  }

  async function saveEditor() {
    if (saving) return;
    const comment = edText.value.trim();
    if (!comment) {
      edText.focus();
      return;
    }
    if (editIndex >= 0) {
      const n = notes[editIndex];
      n.comment = comment;
      if (n.shot && !edShot.checked) {
        dropShots([n]);
        delete n.shot;
        delete n.shotId;
      }
    } else {
      const n = Object.assign({ id: Date.now() }, pending, { comment });
      delete n.shotData;
      if (pending.shotData && edShot.checked) {
        saving = true;
        edSaveBtn.textContent = "Saving...";
        const slug = n.page.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(-60) || "page";
        const res = await send({ type: "saveShot", dataUrl: pending.shotData, name: slug + "-" + n.id + ".png" });
        if (res && res.path) {
          n.shot = res.path;
          n.shotId = res.id;
        }
        saving = false;
      }
      notes.push(n);
    }
    saveNotes();
    closeEditor();
  }

  function editExisting(i) {
    const n = notes[i];
    const el = findOnPage(n);
    if (el) {
      el.scrollIntoView({ block: "center" });
      setTimeout(() => openEditor(el, n, i), 60);
    } else openEditor(null, n, i);
  }

  // ---------- screenshots ----------

  // Hide the tool, let the page repaint, then capture the visible tab. With an
  // element, the background crops around it and outlines it in red.
  async function grabShot(el) {
    host.style.visibility = "hidden";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const b = el ? el.getBoundingClientRect() : null;
      const rect = b && { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
      const res = await send({ type: "capture", rect, view: { w: window.innerWidth, h: window.innerHeight } });
      return (res && res.dataUrl) || null;
    } finally {
      host.style.visibility = "";
    }
  }

  async function pickElement(el) {
    capturing = true;
    const snap = snapshot(el);
    snap.shotData = await grabShot(el);
    capturing = false;
    openEditor(el, snap, -1);
  }

  async function snapScreen() {
    if (capturing || editorOpen()) return;
    capturing = true;
    const snap = Object.assign(baseSnapshot(), {
      whole: true,
      selector: "(whole screen)",
      context: "",
      tag: "",
      text: "",
      scroll: Math.round(window.scrollY),
    });
    snap.shotData = await grabShot(null);
    capturing = false;
    openEditor(null, snap, -1);
  }

  // Delete the image files of notes that are removed.
  function dropShots(list) {
    const ids = list.filter((n) => n.shotId).map((n) => n.shotId);
    if (ids.length) send({ type: "deleteShots", ids });
  }

  // ---------- page events ----------

  function isOurs(e) {
    return e.target === host;
  }

  function onMove(e) {
    if (!active || !picking || editorOpen() || capturing) return;
    const t = e.target;
    if (isOurs(e) || !(t instanceof Element)) {
      hideHover();
      return;
    }
    hovered = t;
    drawHover(t);
  }

  // Swallow page interaction while selecting (or while the comment box is open)
  // so buttons, links and menus do not fire.
  function onBlock(e) {
    if (!active || isOurs(e)) return;
    if (!picking && !editorOpen() && !capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "click" && picking && !editorOpen() && !capturing && e.target instanceof Element) {
      pickElement(e.target);
    }
  }

  function onKey(e) {
    if (!active || isOurs(e)) return;
    if (e.key === "Escape" && editorOpen()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeEditor();
      return;
    }
    if (e.key === "Escape" && picking && !capturing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setPicking(false);
    }
  }

  window.addEventListener("mousemove", onMove, true);
  ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick"].forEach((t) =>
    window.addEventListener(t, onBlock, true)
  );
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", scheduleMarkers, true);
  window.addEventListener("resize", scheduleMarkers);
  // Opening or closing a dialog, drawer, collapse, tab or menu moves things
  // without a scroll or resize, so redraw the markers after those (Bootstrap's
  // own events plus any CSS transition or animation ending), and shortly after
  // page clicks and keys.
  [
    "shown.bs.modal", "hidden.bs.modal",
    "shown.bs.offcanvas", "hidden.bs.offcanvas",
    "shown.bs.collapse", "hidden.bs.collapse",
    "shown.bs.tab", "shown.bs.dropdown", "hidden.bs.dropdown",
    "transitionend", "animationend",
  ].forEach((t) => document.addEventListener(t, () => active && scheduleMarkers(), true));
  ["click", "keyup"].forEach((t) => document.addEventListener(t, () => active && setTimeout(scheduleMarkers, 50)));

  // ---------- state ----------

  function applyState(s) {
    if (K_NOTES in s) notes = s[K_NOTES] || [];
    if (K_ACTIVE in s) active = !!s[K_ACTIVE];
    if (K_PICK in s) picking = !!s[K_PICK];
    if (K_DOCK in s) dockLeft = !!s[K_DOCK];
    if (K_SETTINGS in s) settings = Object.assign({}, DEFAULT_SETTINGS, s[K_SETTINGS] || {});
    if (active && !host) build();
    if (!active) {
      hideHover();
      if (editorOpen()) closeEditor();
    }
    if (!picking) hideHover();
    renderPanel();
  }

  chrome.storage.local.get([K_NOTES, K_ACTIVE, K_PICK, K_DOCK, K_SETTINGS], applyState);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const s = {};
    Object.keys(changes).forEach((k) => (s[k] = changes[k].newValue));
    applyState(s);
  });
})();

// RP Design Notes - hover an element, click it, type what should change.
// Notes live in chrome.storage.local so they survive page changes, then
// "Copy all" turns them into one prompt for Claude.
(() => {
  if (window.top !== window) return;

  const K_NOTES = "rpdnNotes";
  const K_ACTIVE = "rpdnActive";
  const K_PICK = "rpdnPicking";
  const K_DOCK = "rpdnDockLeft";

  let notes = [];
  let active = false;
  let picking = false;
  let dockLeft = false;
  let minimized = false;

  let host, root, hoverBox, hoverLabel, markersEl, panel, listEl, countEl, pickBtn, clearBtn, copyBtn;
  let editor, edSel, edText, edShotRow, edShot, edShotTxt, edThumb, edSaveBtn;
  let pending = null; // snapshot of the element being commented
  let editIndex = -1; // -1 = new note
  let hovered = null;
  let rafId = 0;
  let clearTimer = 0;
  let capturing = false; // taking a screenshot, page clicks stay blocked
  let saving = false;

  // ---------- element info ----------

  function pagePath() {
    // Served pages (Live Server etc.) give a repo-relative path; file:// pages
    // keep the full disk path so Claude can still find the file.
    const p = decodeURIComponent(location.pathname);
    if (location.protocol === "file:") return p;
    return p.replace(/^\//, "") || "index.html";
  }

  const NOISY_CLASS = /^(show|showing|active|hover|focus|collapsed|collapsing|fade|was-validated)$/;

  function uniqueId(el) {
    return el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1;
  }

  function isUnique(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch (e) {
      return false;
    }
  }

  function selectorFor(el) {
    if (uniqueId(el)) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node !== el && uniqueId(node)) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((c) => !NOISY_CLASS.test(c)).slice(0, 3);
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
      if (isUnique(parts.join(" > "))) break;
      node = parent;
    }
    return parts.join(" > ");
  }

  // Ancestors with an id (modals / offcanvas flagged) so Claude can find the
  // spot quickly in very large pages.
  function contextFor(el) {
    const out = [];
    let node = el.parentElement;
    while (node && node !== document.body && out.length < 3) {
      if (node.id) {
        let label = "#" + node.id;
        if (node.classList.contains("modal")) label += " (modal)";
        else if (node.classList.contains("offcanvas")) label += " (offcanvas)";
        else if (node.classList.contains("dropdown-menu")) label += " (dropdown)";
        out.unshift(label);
      }
      node = node.parentElement;
    }
    return out.join(" > ");
  }

  function openingTag(el) {
    const html = el.outerHTML;
    let tag = html.slice(0, html.indexOf(">") + 1).replace(/\s+/g, " ");
    if (tag.length > 220) tag = tag.slice(0, 217) + "...>";
    return tag;
  }

  function textOf(el) {
    const t = (el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("alt") || "")
      .replace(/\s+/g, " ")
      .trim();
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

  function snapshot(el) {
    return {
      page: pagePath(),
      url: location.href,
      selector: selectorFor(el),
      context: contextFor(el),
      tag: openingTag(el),
      text: textOf(el),
      viewport: window.innerWidth + "x" + window.innerHeight,
    };
  }

  function findOnPage(note) {
    if (note.page !== pagePath()) return null;
    try {
      return document.querySelector(note.selector);
    } catch (e) {
      return null;
    }
  }

  // ---------- export ----------

  function buildExport() {
    const lines = [
      "Please fix these UI issues in this repo, all in one pass. Each note gives the page file, a CSS selector for the element, the element's opening tag and what I want changed. Follow the repo's CLAUDE.md rules if it has one.",
      "Where a note has a screenshot, open the PNG first: the element is outlined in red.",
      "",
    ];
    const pages = [];
    notes.forEach((n) => {
      if (!pages.includes(n.page)) pages.push(n.page);
    });
    let i = 0;
    pages.forEach((page) => {
      lines.push("## " + page, "");
      notes
        .filter((n) => n.page === page)
        .forEach((n) => {
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

  async function copyText(txt) {
    try {
      await navigator.clipboard.writeText(txt);
      return true;
    } catch (e) {
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
    host = document.createElement("rp-design-notes");
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
            <button class="pick" data-act="pick" title="Start / pause selecting (Alt+S)"><span class="dot"></span><span class="pick-txt"></span></button>
            <button class="icon" data-act="dock" title="Move to other side">&#8646;</button>
            <button class="icon" data-act="min" title="Minimize">-</button>
            <button class="icon" data-act="close" title="Hide (Alt+Shift+D)">&#10005;</button>
          </div>
          <div class="body">
            <div class="bar">
              <button data-act="snap" title="Note with a screenshot of the whole visible screen">Screenshot</button>
              <span class="spacer"></span>
              <button data-act="clear">Clear</button>
              <button class="primary" data-act="copy">Copy all</button>
            </div>
            <ul class="list"></ul>
            <div class="hint"><b>Alt+S</b> starts or pauses selecting. Pause to use the page normally (open a modal, scroll, switch tabs), then start again to add notes. Esc also pauses.</div>
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
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeEditor();
      }
    });
    // Keep typing and focus inside the tool away from the page. Bootstrap
    // modals / offcanvas trap focus with a document "focusin" listener and
    // would pull the cursor out of the comment box, so focus events stop here.
    ["keydown", "keyup", "keypress", "input", "focusin", "focusout", "focus", "blur"].forEach((t) =>
      host.addEventListener(t, (e) => e.stopPropagation())
    );

    document.documentElement.appendChild(host);
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
      } else if (act === "close") chrome.storage.local.set({ [K_ACTIVE]: false });
      else if (act === "copy") onCopy();
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

  async function onCopy() {
    if (!notes.length) return;
    const ok = await copyText(buildExport());
    copyBtn.textContent = ok ? "Copied " + notes.length : "Copy failed";
    setTimeout(() => (copyBtn.textContent = "Copy all"), 1600);
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

    listEl.textContent = "";
    if (!notes.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No notes yet. Hover an element and click it.";
      listEl.appendChild(li);
    }
    const here = pagePath();
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
      sel.textContent = (n.page === here ? "" : n.page + "  ") + (n.whole ? "Whole screen" : n.selector);
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

  // Hidden, closed (modal / offcanvas / collapse) or zero-size elements get no marker.
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
      if (!el) return;
      if (!isShown(el)) return;
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
    return editor && editor.classList.contains("open");
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
    edShot.checked = true;
    edShotTxt.textContent = index >= 0 ? "Keep screenshot" : "Attach screenshot";
    edThumb.style.display = shotUrl ? "" : "none";
    edThumb.src = shotUrl || "";
    root.querySelector('[data-act="ed-del"]').style.display = index >= 0 ? "" : "none";
    editor.classList.add("open");

    const w = 320;
    const h = editor.offsetHeight || 160;
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
        const name = n.page.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") + "-" + n.id + ".png";
        try {
          const res = await chrome.runtime.sendMessage({ type: "saveShot", dataUrl: pending.shotData, name });
          if (res && res.path) {
            n.shot = res.path;
            n.shotId = res.id;
          }
        } catch (e) {}
        saving = false;
      }
      notes.push(n);
    }
    saveNotes();
    closeEditor();
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
      const res = await chrome.runtime.sendMessage({ type: "capture", rect, view: { w: window.innerWidth, h: window.innerHeight } });
      return (res && res.dataUrl) || null;
    } catch (e) {
      return null;
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
    const snap = {
      page: pagePath(),
      url: location.href,
      whole: true,
      selector: "(whole screen)",
      context: "",
      tag: "",
      text: "",
      viewport: window.innerWidth + "x" + window.innerHeight,
      scroll: Math.round(window.scrollY),
    };
    snap.shotData = await grabShot(null);
    capturing = false;
    openEditor(null, snap, -1);
  }

  // Delete the PNG files of notes that are removed.
  function dropShots(list) {
    const ids = list.filter((n) => n.shotId).map((n) => n.shotId);
    if (ids.length) chrome.runtime.sendMessage({ type: "deleteShots", ids }).catch(() => {});
  }

  function editExisting(i) {
    const n = notes[i];
    const el = findOnPage(n);
    if (el) {
      el.scrollIntoView({ block: "center" });
      setTimeout(() => openEditor(el, n, i), 60);
    } else openEditor(null, n, i);
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

  // Swallow page interaction while picking (or while the editor is open)
  // so buttons, links and dropdowns do not fire.
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
    // Alt+S: start / pause selecting. Works from anywhere on the page, and
    // also shows the tool if it was hidden.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyS") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (capturing) return;
      if (editorOpen()) {
        closeEditor();
        setPicking(false);
        return;
      }
      if (!active) chrome.storage.local.set({ [K_ACTIVE]: true, [K_PICK]: true });
      else setPicking(!picking);
      return;
    }
    if (!active || isOurs(e)) return;
    if (e.key === "Escape" && editorOpen()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeEditor();
      return;
    }
    if (e.key === "Escape" && picking && !editorOpen()) {
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
  // Opening or closing a modal, offcanvas, collapse, tab or dropdown moves
  // things without a scroll or resize, so redraw the markers after those.
  [
    "shown.bs.modal", "hidden.bs.modal",
    "shown.bs.offcanvas", "hidden.bs.offcanvas",
    "shown.bs.collapse", "hidden.bs.collapse",
    "shown.bs.tab", "shown.bs.dropdown", "hidden.bs.dropdown",
  ].forEach((t) => document.addEventListener(t, scheduleMarkers));
  ["click", "keyup"].forEach((t) => document.addEventListener(t, () => active && setTimeout(scheduleMarkers, 50)));

  // ---------- state ----------

  function applyState(s) {
    if (K_NOTES in s) notes = s[K_NOTES] || [];
    if (K_ACTIVE in s) active = !!s[K_ACTIVE];
    if (K_PICK in s) picking = !!s[K_PICK];
    if (K_DOCK in s) dockLeft = !!s[K_DOCK];
    if (active && !host) build();
    if (!active) {
      hideHover();
      if (editorOpen()) closeEditor();
    }
    renderPanel();
  }

  chrome.storage.local.get([K_NOTES, K_ACTIVE, K_PICK, K_DOCK], applyState);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const s = {};
    Object.keys(changes).forEach((k) => (s[k] = changes[k].newValue));
    applyState(s);
  });
})();

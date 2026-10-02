// Shared defaults for the content script, the background and the settings page.
self.DN_DEFAULTS = {
  intro:
    "Please fix these UI issues in this project, all in one pass. Each note names the page, gives a CSS selector for the element, the element's opening tag and what should change. Where a note has a screenshot, open the image first: the element is outlined in red. Follow the project's own agent rules (for example CLAUDE.md, AGENTS.md or .cursorrules) if it has any.",
  shots: true,
  format: "markdown",
  folder: "design-notes",
};

// Browsers only let extensions save inside the Downloads folder, so the save
// folder is a path relative to it. Returns { folder } or { error } with names
// that are valid on macOS, Windows and Linux.
self.DN_cleanFolder = (input) => {
  const typed = String(input || "").trim().replace(/\\/g, "/");
  // Full paths ("/Users/...", "C:/...", "~/...") cannot be used.
  if (/^\/[^/]+\/[^/]+|^[a-z]:(\/|$)|^~/i.test(typed)) return { error: "Use a folder inside Downloads, not a full path." };
  const raw = typed.replace(/^\/+|\/+$/g, "");
  if (!raw) return { folder: self.DN_DEFAULTS.folder };
  const parts = raw.split("/").filter(Boolean);
  if (parts.length > 5) return { error: "Use at most 5 folder levels." };
  for (const p of parts) {
    if (p === "." || p === "..") return { error: 'Folder names cannot be "." or "..".' };
    if (/[<>:"|?*\x00-\x1f]/.test(p)) return { error: 'Folder names cannot contain < > : " | ? *' };
    if (/[. ]$/.test(p)) return { error: "Folder names cannot end with a dot or a space." };
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(p)) return { error: '"' + p + '" is a reserved name on Windows.' };
    if (p.length > 100) return { error: "Folder names can be at most 100 characters." };
  }
  return { folder: parts.join("/") };
};

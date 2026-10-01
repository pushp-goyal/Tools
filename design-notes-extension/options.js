// Settings page. Changes save as soon as they are made.
const K = "dnSettings";
const $ = (id) => document.getElementById(id);
const status = $("status");
let timer = 0;

function load() {
  chrome.storage.local.get(K, (s) => {
    const v = Object.assign({}, self.DN_DEFAULTS, s[K] || {});
    $("intro").value = v.intro;
    $("shots").checked = v.shots !== false;
    document.querySelector('input[name="format"][value="' + v.format + '"]').checked = true;
  });
}

function save() {
  const v = {
    intro: $("intro").value.trim() || self.DN_DEFAULTS.intro,
    shots: $("shots").checked,
    format: document.querySelector('input[name="format"]:checked').value,
  };
  chrome.storage.local.set({ [K]: v }, () => {
    status.textContent = "Saved";
    clearTimeout(timer);
    timer = setTimeout(() => (status.textContent = ""), 1500);
  });
}

$("intro").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(save, 400);
});
$("shots").addEventListener("change", save);
document.querySelectorAll('input[name="format"]').forEach((r) => r.addEventListener("change", save));
$("resetIntro").addEventListener("click", () => {
  $("intro").value = self.DN_DEFAULTS.intro;
  save();
});

chrome.commands.getAll((all) => {
  const find = (name) => (all.find((c) => c.name === name) || {}).shortcut;
  $("kShow").textContent = find("_execute_action") || "Not set";
  $("kToggle").textContent = find("toggle-selecting") || "Not set";
});
$("openShortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

chrome.extension.isAllowedFileSchemeAccess((ok) => {
  $("fileAccess").hidden = ok;
});
$("openDetails").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id }));

load();

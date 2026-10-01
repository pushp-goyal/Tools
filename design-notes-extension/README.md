# Design Notes for AI

A browser extension for UI review. Hover any element on a page, click it, type what should change, and keep going across pages. Then copy every note as one prompt for your AI coding agent and let it fix everything in one pass.

Each note carries what an agent needs to find the code: the page, a CSS selector, the element's opening tag, its text, the window size, and an optional screenshot with the element outlined in red.

- Works with any agent: Claude Code, Codex CLI, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Aider, or a chat app like ChatGPT or Claude.ai
- Works with any project: plain HTML, React, Vue, Svelte, Angular, Tailwind, Bootstrap - anything that runs in the browser, local or live
- Works on macOS, Windows and Linux, in Chrome, Edge, Brave, Arc, Opera, Vivaldi and other Chromium browsers (version 116 or newer)
- No account, no server, no tracking. Notes stay in your browser; screenshots are saved to your own Downloads folder

## Install

The extension is not in a web store yet, so install it from this folder:

1. Download this repo (green **Code** button > **Download ZIP**, then unzip it) or `git clone` it
2. Open your browser's extensions page: `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`)
3. Turn on **Developer mode**
4. Click **Load unpacked** and pick the `design-notes-extension` folder
5. Optional: pin the extension to the toolbar
6. Reload tabs that were already open

To update later: replace the folder with the new version (or `git pull`), then click the reload arrow on the extension card.

**Pages opened as `file://`:** open the extension's **Details** and turn on **Allow access to file URLs**. Pages served from a local dev server (`localhost`) work without this.

## Use

| Action | How |
|---|---|
| Show or hide the panel | Toolbar icon, or **Alt+Shift+D** |
| Start or pause selecting | **Alt+S**, the Selecting / Paused pill in the panel, or **Esc** to pause |
| Add a note | While selecting, click an element, type, press **Enter** (Shift+Enter for a new line) |
| Note about the whole screen | **Screenshot** button in the panel |
| Edit or delete a note | Click it in the panel |
| Hand the notes to your agent | **Copy all**, or **Save file** (see below) |
| Start over | **Clear** (click twice) |

On a Mac, Alt is the Option key. You can change both shortcuts at `chrome://extensions/shortcuts`; the settings page (gear icon in the panel) shows the current ones.

While selecting, the cursor is a crosshair and clicks on the page only add notes. Pause to use the page normally (open a dialog, scroll, log in, change pages), then start again. Notes stay when you change pages, and noted elements get an orange number.

## Giving the notes to your agent

**Agents that can read files on your computer** (Claude Code, Codex CLI, Cursor, Copilot in VS Code, Gemini CLI, Aider, Windsurf and similar): click **Copy all** and paste. Screenshot paths are in the text, so the agent opens the images itself. Some agents ask permission the first time they read from Downloads.

**Chat apps in the browser** (ChatGPT, Claude.ai, Gemini and similar) cannot open paths on your computer. Click **Save file**: the notes are saved as a file next to the screenshots in `Downloads/design-notes/`, and that folder opens. Drag the notes file and the screenshots into the chat, or paste the copied text and drag in just the images.

## What gets copied

```
Please fix these UI issues in this project, all in one pass. ...

## settings/profile
URL: http://localhost:3000/settings/profile

### 1.
- Selector: `[data-testid="save-profile"]`
- Inside: `#profile-form`
- Element: `<button data-testid="save-profile" class="btn btn-primary btn-sm" type="submit">`
- Text: "Save changes"
- Viewport: 1440x900
- Screenshot: `/Users/you/Downloads/design-notes/settings-profile-1759300000000.png`
- Change: make this full width on mobile and move it below the form
```

Notes are grouped by page. Pages from a server show the path after the domain; pages opened as `file://` show the full path on disk. When notes come from more than one site, the site is added to each heading. "Inside" lists the nearest named ancestors (id or test id), with dialogs, drawers and menus flagged, so the agent can find the spot in large pages.

Selectors prefer a stable `id` or a test attribute (`data-testid`, `data-test`, `data-cy`, `data-qa`). Generated ids (`:r1:`, `radix-...`), state classes (`active`, `show`, `open`) and machine-made class names (`css-1x2y3z`, Tailwind variants like `hover:bg-blue-500`) are left out so the selector still matches after a rebuild.

## Settings

Open them from the gear icon in the panel, or the extension's **Details** > **Extension options**.

- **Instructions at the top:** the sentence that goes before the notes. Mention your project's rules or stack if you like
- **Format:** Markdown (default, reads well for any agent) or JSON (for scripts and tools)
- **Screenshots:** whether new notes attach one by default

## Privacy

The extension has no server and sends nothing anywhere. It needs these permissions:

- **Read and change data on all sites:** to show the panel and highlight elements on whatever page you review, and to take the screenshot. It does nothing on a page until you open the panel
- **Downloads:** to save screenshots and note files to `Downloads/design-notes/`, and to delete a screenshot when you delete its note
- **Storage:** to keep your notes and settings in the browser

## Limits

- Elements inside iframes and inside closed shadow DOM cannot be picked; the frame or the component's outer element is picked instead
- Browser pages (`chrome://`, the web store) do not allow extensions
- A screenshot covers what is visible in the window; scroll the element into view first
- Firefox and Safari are not supported yet

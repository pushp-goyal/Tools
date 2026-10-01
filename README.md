# Tools

Micro tools for making work simple. Free, open source, no accounts.

| Tool | What it does |
|---|---|
| [Design Notes for AI](#design-notes-for-ai) | Browser extension: click elements on any page, say what should change, hand every note to your AI coding agent in one go |

---

## Design Notes for AI

<img src="design-notes-extension/icons/icon128.png" alt="" width="64" align="right">

Reviewing a UI with an AI agent usually means describing each problem in words: "the button on the settings page, the second one, under the form...". The agent guesses, gets some wrong, and you go back and forth.

Design Notes removes the guessing. Point at the element, click it, type what's wrong, keep going across pages. When you're done, one click copies every note with everything the agent needs to find the exact code:

- **The page** and its URL
- **A CSS selector** that matches only that element
- **The element's opening tag** and visible text
- **The window size**, for responsive issues
- **A screenshot** with the element outlined in red (optional)
- **Your comment**

Paste it into your agent and it fixes everything in one pass.

### Works everywhere

- **Any AI agent:** Claude Code, Codex CLI, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Aider, or a chat app like ChatGPT or Claude.ai
- **Any project:** plain HTML, React, Vue, Svelte, Angular, Tailwind, Bootstrap, local or live
- **Any computer:** macOS, Windows and Linux, in Chrome, Edge, Brave, Arc, Opera and other Chromium browsers
- **Private:** no account, no server, no tracking. Notes stay in your browser, screenshots go to your Downloads folder

### Quick start

1. [Download this repo](https://github.com/pushp-goyal/Tools/archive/refs/heads/main.zip) and unzip it, or `git clone https://github.com/pushp-goyal/Tools.git`
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`) and turn on **Developer mode**
3. Click **Load unpacked** and pick the `design-notes-extension` folder
4. Open any page and press **Alt+Shift+D** (Option+Shift+D on a Mac) to show the panel
5. Click an element, type what should change, press **Enter**. Repeat
6. Click **Copy all** and paste into your agent

| Shortcut | Does |
|---|---|
| Alt+Shift+D | Show or hide the panel |
| Alt+S | Start or pause selecting, so you can use the page normally in between |
| Esc | Pause selecting, or close the comment box |

Both shortcuts can be changed at `chrome://extensions/shortcuts`.

### Example of what gets copied

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

Full guide (chat apps, settings, privacy, limits): [design-notes-extension/README.md](design-notes-extension/README.md)

---

## License

MIT, see [LICENSE](LICENSE).

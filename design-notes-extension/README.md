# RP Design Notes (Chrome extension)

Point at any element on a page, type what should change, keep going across pages, then copy every note as one prompt for Claude. No server, no database: notes sit in Chrome's local extension storage until you clear them.

## Install (once)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`design-notes-extension` in this repo)
4. If you open pages as `file://` instead of Live Server: click **Details** on the extension and turn on **Allow access to file URLs**
5. Reload any tab that was already open

## Use

1. Click the extension icon (or press **Alt+Shift+D**) to show the panel
2. Hover: the element under the mouse gets a blue outline with its tag, id and classes
3. Click: a box opens - type the change, press **Enter** to save (Shift+Enter for a new line)
4. Keep going. Notes stay when you move to another page. Noted elements get an orange number
5. **Start / pause selecting** any time with **Alt+S** (or the Selecting / Paused pill in the panel header, visible even when minimized). While selecting, the cursor is a crosshair and page clicks only add notes. Paused, the page works normally: open a modal, scroll, use dropdowns, change pages - then Alt+S again to add more. Esc also pauses
6. **Screenshots:** every click takes a screenshot of the area around the element with the element outlined in red. Untick "Attach screenshot" in the comment box if you don't want it. The **Screenshot** button in the panel adds a note for the whole visible screen. Files are saved to `Downloads/design-notes/` and their paths go into the copied text, so Claude opens them itself. Deleting a note or clearing all also deletes its screenshot file
7. Click a note in the panel to edit or delete it
8. **Copy all**, paste into Claude Code, then **Clear** (click twice)

## What gets copied

```
Please fix these UI issues in this repo, all in one pass. ...

## dashboard.html

### 1.
- Selector: `#wfdGetStarted > div.card-body > button.btn.btn-primary`
- Inside: `#wfdGetStarted`
- Element: `<button class="btn btn-primary btn-sm" type="button">`
- Text: "Connect profile"
- Viewport: 1440x900
- Screenshot: `/Users/you/Downloads/design-notes/dashboard-html-1759300000000.png`
- Change: make this a secondary button, it competes with the main CTA
```

Notes are grouped by page file. Pages served over HTTP (for example VS Code Live Server) show a path relative to the site root; pages opened as `file://` show the full path on disk. "Inside" lists the nearest ancestors with an id (flagged as modal / offcanvas / dropdown) so Claude can find the spot fast in the very large pages.

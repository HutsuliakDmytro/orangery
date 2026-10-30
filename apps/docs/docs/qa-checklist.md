# Manual QA checklist

What automated tests cannot reach: the real window, the real file system, the
real printer, and the judgement of whether something _feels_ right.

Run before tagging a release. Record the OS version and the result of every
line — "not tested" is a valid result and more useful than a blank.

## Before you start

- Build with `pnpm tauri build`, install from the DMG, and run the installed app.
  Testing `pnpm tauri dev` misses everything the bundle does: icon, file
  associations, signing, updater.
- Use a machine that has never run the app, or clear
  `~/Library/Application Support/com.orangery.docs` first. Half the interesting
  bugs only happen on first launch.

## First launch

- [ ] The app opens without a Gatekeeper warning.
- [ ] The icon in the Dock and Finder is the app icon, not a generic document.
- [ ] The welcome screen appears with the three templates and an empty recent list.
- [ ] Choosing a template opens an editable document.
- [ ] The window opens at a sensible size on a 13" display, with nothing clipped.

## Documents

- [ ] Open a `.docx` you did not create. It renders without a repair prompt.
- [ ] The warnings banner appears only when the document contains something
      unsupported, and its details list is accurate.
- [ ] Edit one word, save, and open the result in Word. Word does not offer to
      repair it, and nothing but that word has changed.
- [ ] Save As to a new name. The original file is untouched.
- [ ] Overwrite an existing file. A `.bak` appears next to it with the previous
      contents.
- [ ] Open a document with tables, images and a header. All three survive a
      save-and-reopen.
- [ ] Open a 200-page document. Typing does not stutter.

## Losing work

These are the ones that matter most. Take them seriously.

- [ ] Type, wait five seconds, then kill the app from Activity Monitor. On
      relaunch the recovery banner offers the document, and recovering it
      restores the text.
- [ ] Type, save, then kill the app. On relaunch there is **no** recovery offer —
      the file on disk is authoritative.
- [ ] Close a window with unsaved changes. The prompt appears; Cancel keeps the
      window open; Don't Save closes it; Save closes it only after the save
      lands.
- [ ] Cancel the Save dialog from that prompt. The window stays open and the
      document is still dirty.
- [ ] Pull out the disk / fill it, then save. The failure is reported and the
      original file is intact.

## Editing

- [ ] Every toolbar button does what its tooltip says, and its active state
      follows the cursor.
- [ ] `Cmd+A` then a list toggle removes the list.
- [ ] Undo after a burst of typing undoes the burst, not one character.
- [ ] Find and replace reports the right count as you type, and Replace All
      replaces every match.
- [ ] Paste from Word, from a browser and from a plain-text editor. Nothing
      arrives with markup that does not belong.
- [ ] Paste a screenshot. It embeds as an image, not as a broken link.
- [ ] Drag an image file onto the page. Same.

## Interface

- [ ] Dark and light themes both render the page white and the chrome correctly.
- [ ] "Match system" follows a live change of the system appearance.
- [ ] Switching the language to Ukrainian translates the interface, and back.
- [ ] Every dialog closes on Escape.
- [ ] Tab moves through the interface in a sensible order, and the toolbar is a
      single stop with arrow keys inside it.
- [ ] Focus rings are visible everywhere, in both themes.
- [ ] Zoom at 50% and 200%: the page stays centred and the scroll area is right.
- [ ] Full-screen mode: the layout fills the screen without clipping.
- [ ] On a Retina display, text and icons are sharp, not doubled or blurry.

## Printing

- [ ] `Cmd+P` opens the system print sheet.
- [ ] The preview shows the document page size, not the window.
- [ ] Save as PDF produces a file whose page size and margins match Page Setup.
- [ ] Headers, footers and page numbers appear on the printed page.
- [ ] The toolbar, ruler and status bar do **not** appear on the printed page.

## Windows and files

- [ ] **App closed.** Quit it (`Cmd+Q`, not just the window). Double-click a
      `.docx` in Finder. The app starts **on the file** — at no point does the
      welcome screen appear first, not even for a frame.
- [ ] **App open, on the welcome screen.** Double-click a `.docx`. It opens in
      that window; no second window appears.
- [ ] **App open, a file in it with unsaved changes.** Double-click another
      `.docx`. It opens in a **new** window; the first is untouched, edits
      and all, and nothing asks anything.
- [ ] **App open, a file in it, saved.** Double-click another. New window too.
- [ ] Select three `.docx` files in Finder and press `Cmd+O`. Three windows,
      one file each.
- [ ] Right-click a `.pptx` → Open With → Orangery Docs. The window says Orangery Docs could
      not open it and why, with Open Another… — not a bare welcome screen. (It
      should not have been offered: Orangery Docs does not claim `.pptx`. If it
      was, that is a bug in `tauri.conf.json`.)
- [ ] A file the app may not read. `chmod 000` a copy of a `.docx` — but do
      **not** double-click it: macOS refuses that itself (error -5000) before
      the app is ever asked, which is the system's answer and not ours. Start
      the app with it instead:
      `"/Applications/Orangery Docs.app/Contents/MacOS/orangery-docs" locked.docx`.
      The window says there is no permission to read it. Put the permissions
      back after.
- [ ] Double-click a `.docx` that is not one — a text file renamed. The window
      says why it would not open.
- [ ] **Windows / Linux:** the same five, plus — with the app running, open a
      file from Explorer / the file manager. No second copy of the app appears
      in the taskbar; the file arrives in the first.
- [ ] Dropping a file onto a window with unsaved changes opens it in a new window.
- [ ] Recent files lists what you actually opened, most recent first.

## Record

| Item     | macOS 14 | macOS 15 |
| -------- | -------- | -------- |
| Tester   |          |          |
| Build    |          |          |
| Date     |          |          |
| Failures |          |          |

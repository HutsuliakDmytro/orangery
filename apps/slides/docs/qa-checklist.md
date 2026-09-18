# Manual QA checklist

What automated tests cannot reach: the real window, the real file system, the
real PowerPoint, and the judgement of whether something _feels_ right.

Run before tagging a release. Record the OS version and the result of every
line — "not tested" is a valid result and more useful than a blank.

Two checks live in their own file because they need hardware: the projector and
the raster export, both in `presenting-checklist.md`. Run that one too.

## Before you start

- Build with `pnpm tauri build`, install from the DMG, and run the installed
  app. Testing `pnpm tauri dev` misses everything the bundle does: icon, file
  associations, signing, updater.
- Use a machine that has never run the app, or clear
  `~/Library/Application Support/com.orangery.slides` first. Half the
  interesting bugs only happen on first launch.
- Have PowerPoint and LibreOffice Impress installed. Several lines below are
  answered by another program, not by ours.

## First launch

- [ ] The app opens without a Gatekeeper warning.
- [ ] The icon in the Dock and Finder is the Slides icon — not Docs', and not a
      generic document.
- [ ] The welcome screen appears with New, New from Template, Open, and an empty
      recent list.
- [ ] The window opens at a sensible size on a 13" display, with the filmstrip,
      canvas, format panel and notes all visible and nothing clipped.

## Making a deck

- [ ] New Presentation gives one empty title slide, and the window says
      "Untitled Presentation" with no unsaved dot.
- [ ] New from Template lists six, each with a line saying what it is for.
- [ ] Each of the five templates builds: the right number of slides, on the
      right layouts, with text in the placeholders and none of them empty.
- [ ] Add Slide builds on the layout of the slide you were on, so a slide added
      after a section header looks like its neighbours.
- [ ] Change Layout offers the six, and switching between them keeps the text
      and takes the new layout's geometry.
- [ ] Type in a title; the filmstrip thumbnail and the outline both follow.

## Somebody else's deck

- [ ] Open a `.pptx` you did not create — ideally from Keynote or Google Slides
      export. It renders without an error banner.
- [ ] The warnings banner appears only when the deck holds something we only
      approximate, and its list is accurate.
- [ ] Move one shape, save, and open the result in PowerPoint. PowerPoint does
      **not** offer to repair it, and nothing but that shape has moved.
- [ ] Open a deck with animations, a chart and SmartArt. Save without editing.
      In PowerPoint, all three are still there and still work.
- [ ] Save As to a new name. The original file is untouched.
- [ ] Overwrite an existing file. A `.bak` appears beside it with the previous
      contents.
- [ ] Open a deck with an embedded video. It plays in the editor and in the show.
- [ ] Open a deck with styled tables beside PowerPoint and compare. Ours draws
      an approximation of "Medium Style 2" whenever the deck names one of
      PowerPoint's built-in styles, because those live inside PowerPoint and not
      in the file. Write down how far off it looks: banding, header colour, and
      whether the text is the right weight. This is the check that decides
      whether the approximation is worth keeping.

## Losing work

These are the ones that matter most. Take them seriously.

- [ ] Edit a slide, wait five seconds, then kill the app from Activity Monitor.
      On relaunch the recovery banner offers the deck, and recovering it
      restores the edit.
- [ ] Edit, save, then kill the app. On relaunch there is **no** recovery offer —
      the file on disk is authoritative.
- [ ] Do the same with a deck that was never saved: New Presentation, add a
      slide, wait, kill. The recovery offer says "Untitled Presentation" and
      brings back the whole deck, not an empty one.
- [ ] Insert a picture, wait five seconds, kill. The recovered deck still shows
      the picture rather than a gap where it was.
- [ ] Close the window with unsaved changes. The prompt appears; Cancel keeps
      the window; Don't Save closes it; Save closes it only after the save
      lands.
- [ ] Cancel the Save dialog from that prompt. The window stays open and the
      deck is still dirty.
- [ ] Recover a deck, then relaunch again. It is **not** offered a second time.
- [ ] With two windows open, both showing the same recovery offer, recover in
      one. The other window's offer is stale — note what taking it does. This is
      known and unfixed; the check is to see whether it is worse than untidy.
- [ ] Fill the disk, then save. The failure is reported and the original file is
      intact.

## Editing

- [ ] Every format-panel control does what it says, and its state follows the
      selection.
- [ ] Undo after a drag undoes the whole drag, not every pixel of it.
- [ ] Undo after Replace All undoes the whole replacement in one step.
- [ ] Undo after saving marks the deck unsaved again.
- [ ] Find and Replace finds a word split across runs — one somebody made bold
      in the middle.
- [ ] Insert a picture from a file, from the clipboard, and by dragging it onto
      a slide.
- [ ] Delete a slide, undo, redo. The filmstrip selection ends up somewhere
      sensible each time.
- [ ] Drag slides in the filmstrip to reorder, including into and out of a
      section.

## Getting a deck in

- [ ] Double-clicking a `.pptx` in Finder opens it in the app.
- [ ] Double-clicking a `.odp` does too, and the banner says it was converted.
- [ ] Dropping a file onto a clean window opens it there.
- [ ] Dropping a file onto a window with unsaved changes opens it in a **new**
      window, and asks nothing.
- [ ] Recent lists what you actually opened, most recent first, and a file that
      failed to open is not in it.
- [ ] Open a recent entry whose file has since been moved. The failure is said
      out loud.
- [ ] New Window opens an empty second window and leaves the first alone.
- [ ] Two windows, two different decks, both editable at once. Closing one does
      not close or disturb the other.

## OpenDocument

Our ODP support is a conversion in both directions. These lines are about how
much survives, and the answers belong in the file next to the checkbox.

- [ ] Open an `.odp` made in Impress. The slides are there, the text is on them,
      and the frames are roughly where Impress puts them.
- [ ] The banner names how many items did not come across, and the number is
      believable against what the file contains.
- [ ] Saving the imported deck asks where to put it and offers `.pptx`. It does
      **not** silently overwrite the `.odp`.
- [ ] Export as OpenDocument, then open the result in Impress. Impress opens it
      without complaint; the pages, the words and the pictures are there.
- [ ] Note what was lost in that round trip. Shapes, tables and charts are
      expected to be; anything else is a bug.

## Big decks

- [ ] Open a 300-slide deck with pictures. It opens in under three seconds.
- [ ] Scroll the filmstrip from top to bottom. It does not stutter.
- [ ] Typing on slide 150 is as responsive as on slide 1.
- [ ] Memory after five minutes of that is under 800 MB (Activity Monitor).
- [ ] Save it. The write takes a sensible time and the file opens in PowerPoint.
- [ ] Save a deck carrying more than 20 MB of pictures. The offer to shrink
      appears, names a believable saving, and Cancel writes nothing at all.
- [ ] Take the offer. The file is smaller, the pictures still look right on
      screen and on the projector, and PowerPoint opens it.

## Interface

- [ ] Dark and light themes both render the chrome correctly — and the slide
      itself is drawn in the **deck's** colours in both, never tinted by ours.
- [ ] "Match system" follows a live change of the system appearance.
- [ ] Every dialog closes on Escape.
- [ ] Tab moves through the interface in a sensible order.
- [ ] Focus rings are visible everywhere, in both themes.
- [ ] Zoom at 25% and 400%: the slide stays centred and the scroll area is right.
- [ ] Rulers and guides: drag a guide out, move it, drag it away.
- [ ] Full-screen mode fills the screen without clipping.
- [ ] On a Retina display, text and icons are sharp, not doubled or blurry.

## Printing and the show

- [ ] `Cmd+P` opens the system print sheet, and the preview shows slides rather
      than the window.
- [ ] Save as PDF, with notes, and as a handout. All three layouts are right.
- [ ] Run the whole of `presenting-checklist.md` on a real second display.
- [ ] Start a show, then try to close the editor window from the menu. Whatever
      happens to the unsaved-changes prompt, it must not be asked on a window
      the room is looking at.
- [ ] With two decks open in two windows, start a show from each in turn. There
      is one set of show windows; the second show takes them over. Confirm that
      is what happens and that nothing is left behind.

## Record

| Item     | macOS 14 | macOS 15 |
| -------- | -------- | -------- |
| Tester   |          |          |
| Build    |          |          |
| Date     |          |          |
| Failures |          |          |

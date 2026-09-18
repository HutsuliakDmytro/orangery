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
- [ ] Insert → Header and Footer, tick the slide number, Apply to All. Every
      slide shows its own number, in the place its own layout puts it — a deck
      built from several layouts puts them in several places, which is right.
- [ ] Reorder the slides afterwards. The numbers follow; none of them keeps the
      number it had.
- [ ] Tick the date as well, save, and open the file in PowerPoint tomorrow. It
      shows tomorrow's date, not today's.
- [ ] Tick “Don't show on title slide” and Apply to All. The title slides have
      nothing; the rest do.
- [ ] Double-click into the footer and type beside the slide number. The number
      is one thing the caret steps over, not digits you can edit — and after
      leaving the shape it still follows the slide.
- [ ] Give a shape a gradient, a thick outline and a shadow. Copy Formatting,
      pick another shape, Paste Formatting. All three arrive; the shape keeps
      its own outline, its own place and its own size.
- [ ] Paint a shape whose text is a link. The link survives, and the shape it
      was painted from does not lend it one.
- [ ] View → Grid and Guides. Turn the grid on; it appears behind the shapes,
      not over them. Turn snapping on and drag a shape; it lands on the lines.
- [ ] Change the spacing, save, reopen. The spacing is still what you chose.
- [ ] Drag a guide out of the ruler and drag a shape near it. The shape takes
      the guide, and the guide is still there on every other slide.
- [ ] Turn snapping on with the grid hidden. Dragging still lands on the grid —
      the two switches are separate on purpose.
- [ ] Copy a themed shape from one deck and paste it into another with a
      different theme. It arrives in the second deck's colours.
- [ ] Do it again with Paste Special → keep source formatting. It arrives
      looking like where it came from, transforms and all.
- [ ] Paste Special → text only. A text box appears with the words and no fill.
- [ ] Copy three different things, then Paste Special. All three are listed,
      newest first, and picking the oldest pastes the oldest.
- [ ] Insert an icon, Edit Points. Click a dot on a side: a corner appears
      there. Double-click a corner: it goes.
- [ ] Try to delete corners until there are two left. It stops at three.
- [ ] Do the same to a shape with a curved side. The curve's handles cannot be
      deleted on their own, and deleting the corner takes the curve with it.
- [ ] Find a word that appears on several slides. Replace, once. The view goes
      to that slide first, one match changes, and the count drops by one.
- [ ] Press Replace repeatedly. It walks forward through the deck without
      skipping any.
- [ ] Save Theme. **Open the `.thmx` in PowerPoint** — Design → Browse for
      Themes. It appears in the gallery and applies; the colours, the fonts and
      the layouts are the ones the deck had. This is the check the unit tests
      cannot make: they prove the package holds together, not that Office
      accepts it.
- [ ] Do it on a deck whose master has a background picture. The picture comes
      with the theme.
- [ ] Insert → Shape. Every shape in the gallery draws as the thing it is
      named after, not as a rectangle.
- [ ] Open a deck full of flowchart shapes beside PowerPoint. Compare shape by
      shape; note any that read wrong rather than merely differ in proportion.
- [ ] Find a shape somebody has reshaped by its yellow handle — a rounded
      rectangle dragged square, an arrow with a big head. Ours draws it the way
      PowerPoint does.
- [ ] Stretch a rounded rectangle wide. The corners stay round rather than
      turning oval.
- [ ] Type into a placeholder until the text is too long for it. It shrinks,
      and stops shrinking — it does not flicker between two sizes.
- [ ] Delete most of it again. The text grows back, once.
- [ ] Save and open in PowerPoint. PowerPoint agrees about the size rather than
      resizing it again on open.
- [ ] Put a text box set to "resize shape to fit text" on a slide and type into
      it. The box grows a line at a time, and shrinks again when you delete.
- [ ] Do the same inside a group. The box grows and nothing else in the group
      moves.
- [ ] Open a deck with a scatter chart. The points sit where their numbers put
      them, not at even steps.
- [ ] Open one with columns and a line over them on a second axis. Both are
      drawn, each numbered in its own units, and the gridlines are one set.
- [ ] Open one with data labels. The numbers are there, and a chart without
      them shows none.
- [ ] Open a deck somebody has commented on in a current PowerPoint. The banner
      says the comments are kept but not shown, and naming the slides they are
      on. Save and reopen in PowerPoint: the comments are still there.
- [ ] Open a deck of three hundred slides with pictures on them. Scroll the
      filmstrip from top to bottom. It keeps up, and the thumbnails are there
      by the time you stop — this is the one that needs a real display.
- [ ] Drag the scrollbar from top to bottom in one motion. Nothing jumps, and
      the strip does not change length as it fills in.
- [ ] Save a deck from PowerPoint with "embed fonts" ticked, in a typeface this
      machine does not have. Open it here: the text is in that typeface and the
      lines break where PowerPoint broke them. **This is the check the unit
      tests cannot make** — whether a real engine reads a real `.fntdata`.
- [ ] If it cannot, the banner says which typeface, and the deck still opens.
- [ ] Close that deck and open another using the same typeface name without
      embedding it. It is drawn in the substitute, not in the first deck's font.
- [ ] Present a deck with builds on it. Each press plays the next one; the
      slide only moves on after the last. Go back: the build goes back first.
- [ ] Reach an animated slide backwards. It is at its end, not its start.
- [ ] Compare a deck of varied effects beside PowerPoint. Note which read wrong
      rather than merely differ — everything we do not model fades, which is
      the intent, and a motion path stays put.
- [ ] Add a fade to a shape, save, **open in PowerPoint**. The animation is
      there, in PowerPoint's own pane, and plays. This is the check the unit
      tests cannot make.
- [ ] Do it on a slide that already had animations from PowerPoint. The old
      ones are still there and still play.
- [ ] Remove the last effect of a step. The press that played it is gone too —
      no press that does nothing.
- [ ] Make two slides in PowerPoint with Morph between them and present here.
      The shapes travel; the slide does not fade.
- [ ] Do it on slides where two shapes share a name. Those two stay put rather
      than swapping places — refusing to guess is the intended behaviour.
- [ ] Rehearse Timings, talk through a few slides, end. The summary shows each
      slide's time and they add up to the run.
- [ ] Keep them, save, open in PowerPoint. Slide Show → the timings are there
      and nothing has started dissolving.
- [ ] Open a deck somebody rehearsed in PowerPoint. It does not fade between
      slides that were never given a transition.
- [ ] In the presenter view, the time on this slide resets at each slide and
      the time on the presentation does not.
- [ ] Present, press `P`, draw on a slide. The line follows the pointer and the
      slide does not advance. `E` rubs a line out; `L` is a laser that leaves
      nothing; `A` puts the pointer back.
- [ ] Draw, go to the next slide and back. The ink is on the slide it was drawn
      on and not on the other.
- [ ] End the show and keep the ink. Save, open in PowerPoint: the marks are
      there as freeform shapes — **not as PowerPoint's own ink**, which is the
      known difference.
- [ ] Record Slide Show, talk over two slides, end, keep. Each slide has a
      sound icon; clicking it plays what was said on that slide and not the
      other. **Needs a microphone** — the unit tests stand one in.
- [ ] Save and open in PowerPoint. The narration plays there too, and the
      timings came with it.
- [ ] Deny the microphone, or run on a machine with none. The show still runs;
      only the narration is missing.
- [ ] Export as Video on a short deck. The banner counts the slides through and
      **takes as long as the deck plays for** — that is the design, not a hang.
- [ ] Play the file. Every slide is there, in order, for its own time. There is
      no sound yet; that is known.
- [ ] Press Stop half way. The file saves and holds the slides recorded so far.
- [ ] Pick a chart, change a number in the panel. The chart redraws. Save,
      open in PowerPoint, **and open Edit Data**: the workbook holds the new
      number too — that is the check the cache alone would fail.
- [ ] The chart's colours and styling are the ones it had; nothing was rebuilt.
- [ ] Open a deck with SmartArt made in PowerPoint. It is drawn — the boxes,
      the arrows and the words — and the banner says nothing about it.
- [ ] Open one whose SmartArt was made by something else and never opened in
      PowerPoint. It is a labelled box, and the banner says so.
- [ ] Convert SmartArt to Shapes. The picture does not move or change; the
      boxes can now be selected and dragged. Save and open in PowerPoint: the
      shapes are there, and it does not offer to repair the file.

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

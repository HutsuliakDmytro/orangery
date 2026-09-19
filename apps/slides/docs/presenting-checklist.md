# Presenting on a second screen — the manual check

Everything else about the show is covered by tests. This is not, and cannot be:
it needs two physical panels, a projector that negotiates a mode, and a machine
that goes to sleep with a window open on a display that then disappears. None of
that exists in a test environment, and all of it is what goes wrong on stage.

Run it on macOS before a release, with a real projector or a second monitor.

## Before

- Open a deck with at least ten slides, speaker notes on several, and one video.
- Connect the second display. Leave it mirrored for the first pass.

## Mirrored displays

1. `F5`. The show fills the screen; the editor is behind it.
2. There is **no presenter view** — with one logical screen it would be the thing
   the room is looking at. That is the intended answer, not a fault.
3. `Esc` ends the show and gives the window back at the size it was.

## Extended displays

1. Set the displays to extended and make the laptop panel the main one.
2. `F5`. The show fills the **second** display; the presenter view opens on the
   main one.
3. The presenter view shows the slide that is up, the one coming, the notes, a
   timer counting from zero, and the clock.
4. `Next` on the presenter moves the show. The show moves the presenter too.
5. Click a slide in the presenter's strip: both windows go there.
6. `B` on either window blanks the show and leaves the presenter readable.
7. The notes `+` and `−` change only the presenter.
8. `Esc` on either window closes **both**.

## The video

1. Go to the slide with the video. The poster frame is there.
2. Click it: it plays, and the slide does **not** advance.
3. Click beside it: the slide advances.

## Sleep and disconnection

1. Start a show on the second display. Close the lid, wait for sleep, reopen.
   Both windows are still there and still on the right displays.
2. Start a show, then unplug the projector mid-show. The show window survives —
   it may move to the remaining display. `Esc` still ends it.
3. Plug it back in and start a show again. It goes to the projector.

## What to write down

Anything that needed a second try, and anything that took longer than a second
to respond. A presentation that works and hesitates is a presentation nobody
wants to give.

---

# Exporting pictures — the other manual check

A slide's text is HTML inside a `foreignObject`, and whether an engine will
rasterise that out of an `<img>` is a question about the engine. WebKit has been
inconsistent about it for years, and WebKit is what the app runs in on macOS.
The SVG path has no such question; the PNG and JPEG ones do.

**Most of this is now automatic.** `tests/e2e/raster.spec.ts` exports the open
slide through the app's own code in both Chromium and WebKit and counts the
pixels, which is how the two bugs below were found at all. What stays here is
what a browser Playwright downloads cannot answer for: the packaged app's
WKWebView is a different build of WebKit, and a real file opened in a real
viewer is a different question from bytes measured in a canvas.

Two failures worth recognising, because both saved without complaining:

- A picture with the shapes and **no words**. The text of a slide is laid out in
  CSS pixels and scaled back into EMU — laid out in EMU it is past what an
  engine will do, and Blink drops it entirely.
- A picture that is **blank white**. The exported SVG has to carry the XHTML
  namespace on the content of every `foreignObject`; without it a `div` is a
  `div` in the SVG namespace, which nothing draws.

1. Open a deck with text, a picture, a table and a chart on one slide.
2. **Export Slide as SVG.** Open the file in a browser: everything is there. Open
   it in Inkscape or Illustrator: the shapes are there and the text may be laid
   out differently, because the fonts are named and not embedded.
3. **Export Slide as PNG.** Open it. The text must be there. A picture with the
   shapes and no words is the failure this check exists for.
4. **Export Slide as JPEG.** Same, and the background is white rather than black.
5. **Export Every Slide as PNG** into an empty directory. One file per slide,
   named so the directory sorts in the order the deck runs.
6. Try a deck of forty slides. It should finish, and it should not freeze the
   window while it does.

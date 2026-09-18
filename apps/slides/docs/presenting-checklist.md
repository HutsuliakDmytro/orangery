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

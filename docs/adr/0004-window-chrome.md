# 0004 — Window chrome per platform

- Status: accepted
- Date: 2026-09-16

## Context

The app has a black-and-orange interface and a dark default theme. Each desktop
platform draws the window frame differently, and each has a different idea of who
owns it:

- **macOS** draws the title bar and traffic lights itself. An app that replaces
  them loses window-snapping behaviour, the proxy icon, and the double-click
  title action — all things macOS users use without thinking about them.
- **Windows** draws a title bar the app can restyle or replace. Since Windows 11
  the rounded corners and snap layouts come from the system, and a custom frame
  has to reimplement the snap menu or lose it.
- **Linux** is split. GNOME expects client-side decorations drawn by the app;
  KDE and most tiling window managers expect server-side ones. WebKitGTK gives
  us neither for free.

Update 1 ships Windows and Linux, so this has to be decided rather than
discovered per platform.

## Decision

**Use the system frame on every platform.** No custom title bar.

On macOS the window keeps its native title bar with `titleBarStyle: default`.
The document name and edited marker go in the title, which is where macOS users
already look for them.

On Windows the default frame stays. The title bar will not match the dark theme
in light system mode, and that is accepted.

On Linux the window is left to the window manager. GNOME will draw a header bar
around it; KDE will draw its own decoration. Neither looks wrong, because both
look like every other application on that desktop.

## Rationale

The product principle is "familiar, not novel" and "native feel on macOS"
(CLAUDE.md). A custom title bar is the single most common way a cross-platform
app announces that it is not native. It also costs real behaviour: window
snapping, the accessibility tree, and the platform's own conventions for
double-click, right-click and drag.

The theme mismatch on Windows is the price. It is visible but shallow — one
strip at the top of the window — and Windows users see it in most applications
that are not Microsoft's own.

## Alternatives considered

**Custom chrome everywhere, for a consistent look.** Consistent across platforms
means wrong on all of them. Rejected on the product principle.

**Custom chrome on Windows and Linux only, native on macOS.** Splits the layout
code in two and puts platform branching into the app shell rather than behind
`src/platform/`. The gain is one strip of colour. Rejected.

**`titleBarStyle: overlay` on macOS** (traffic lights over the content, no bar).
Tempting for the extra vertical space, and it keeps the native controls. Rejected
for now because the toolbar would have to reserve space for the traffic lights,
and getting that wrong by a few pixels looks broken in a way users notice. Worth
revisiting once the toolbar layout has settled.

## Consequences

- No platform branching for window chrome; `tauri.conf.json` has one window
  definition.
- The Windows title bar will not follow the app theme. If that becomes a
  complaint, the narrow fix is Windows' own dark-mode title bar attribute, not a
  custom frame.
- The document name has to stay accurate in the window title, since on macOS that
  is the only place it appears. Covered by `windowTitle` in `document-store.ts`.

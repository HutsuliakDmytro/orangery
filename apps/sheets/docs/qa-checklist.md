# Manual QA checklist

What automated tests cannot reach: the real window, the real file system, the
real Excel, and the judgement of whether something _feels_ right. A canvas
grid is most of this app and none of it is visible to jsdom — every test we
have asserts what the grid was handed, never what it drew.

Run before tagging a release. Record the OS version and the result of every
line — "not tested" is a valid result and more useful than a blank.

## Before you start

- Build with `pnpm --filter sheets tauri build`, install from the DMG, and run
  the installed app. Testing `pnpm tauri dev` misses everything the bundle
  does: icon, file associations, signing, updater.
- Use a machine that has never run the app, or clear
  `~/Library/Application Support/com.orangery.sheets` first. Half the
  interesting bugs only happen on first launch.
- Have Excel and LibreOffice Calc installed. A good third of the lines below
  are answered by another program, not by ours.
- Bring **your own workbooks**. Not the fixtures — the ones you actually use,
  with the pivot tables and the macros and the column of dates that came out
  of some system in 2014. Anything that breaks goes into the corpus.

## First launch

- [ ] The app opens without a Gatekeeper warning.
- [ ] The icon in the Dock and Finder is the Sheets icon — the grid, not Docs'
      page and not a generic document.
- [ ] The window opens at a sensible size on a 13" display: toolbar, formula
      bar, headers, grid and sheet tabs all visible, nothing clipped.
- [ ] With nothing open, the window says so and offers the one thing there is
      to do.

## Somebody else's workbook

The core of the product. Take these slowly.

- [ ] Open an `.xlsx` you did not create. It renders without an error banner,
      and the numbers match what Excel shows — including the formatted ones.
- [ ] Open it, change nothing, save. Excel opens the result **without offering
      to repair it**.
- [ ] Open a workbook with a pivot table. The pivot's cells show their figures,
      the banner says it will not refresh, and after a save Excel still
      refreshes it against its source.
- [ ] Open an `.xlsm`. The macros banner appears. Save, reopen in Excel: the
      macros are still there and still run.
- [ ] Open a workbook with external links, slicers or a Power Query connection.
      Save. All three survive.
- [ ] Open one with conditional formatting, data validation and defined names.
      Each shows, each survives a save.
- [ ] Save As to a new name — the original is untouched.
- [ ] Overwrite an existing file — a `.bak` appears beside it with the previous
      contents.
- [ ] Open a workbook saved by Google Sheets and one saved by LibreOffice. Both
      open; note anything that looks wrong.

## The numbers are right

The highest-severity bug this app can have. Compare against Excel, not against
our own engine.

- [ ] Take three of your own workbooks with real formulas. Recalculate the whole
      workbook (`F9`) and compare every changed cell against the value Excel
      cached in the file. **Any difference is a bug** — write down the formula,
      the inputs and both answers.
- [ ] Dates: a column of them from a `date1904` workbook, and one from an
      ordinary workbook, in the same session.
- [ ] Money: a `PMT`/`IPMT` schedule, checked against Excel to the cent.
- [ ] `TEXT`, `VLOOKUP`/`XLOOKUP`, `SUMIFS` and `COUNTIFS` over your own data.
- [ ] `=0.1+0.2-0.3` shows 0, as Excel shows it.
- [ ] A formula the engine does not know stays as text, the cell says `#NAME?`,
      and the file still opens in Excel afterwards.

## Typing, and the grid under it

- [ ] Type into a cell; the formula bar follows. Type into the formula bar; the
      cell follows.
- [ ] `F2`, `Enter`, `Tab`, `Alt+Enter`, `Esc` all do what Excel does.
- [ ] `15%` becomes 0.15 with a percent format. `01-01-24` becomes a date.
      `'007` stays text.
- [ ] A cell with a list validation offers the list while you type in it.
- [ ] Fill handle: drag numbers, dates, `Item 1`, and a formula. Double-click it
      beside a filled column.
- [ ] Undo and redo, twenty steps deep, including a paste, a fill, a sort and a
      row insertion.
- [ ] Copy from Excel and paste here; copy from here and paste into Excel; paste
      into a mail client and check the plain text.
- [ ] `F4` inside a formula cycles the dollars — in the cell and in the formula
      bar.
- [ ] Right-click a sheet tab: rename, duplicate, colour, hide, delete. Deleting
      asks first.

## Drawn rather than built

Everything on this list is canvas, and the canvas is what no test sees.

- [ ] Merged cells, wrapped text, rotated text and indented text all draw the way
      Excel draws them. Compare side by side.
- [ ] Freeze panes: scroll both ways and watch the frozen rows and columns stay.
- [ ] Zoom to 50%, 100% and 200%. Clicks land on the cell under the pointer at
      every zoom.
- [ ] On a Retina display, text is sharp and gridlines are one pixel — not two,
      not grey mush.
- [ ] Conditional formatting: colour scales, data bars and icon sets all draw,
      and they follow the value when you type over it.
- [ ] Sparklines draw and follow their cells.
- [ ] A chart on a sheet redraws when the cells behind it change, and moves when
      a column is widened.
- [ ] A picture on a sheet is at the size the file says it is.
- [ ] Resize the window slowly while the grid is scrolled to the middle of a big
      sheet. Nothing flickers, nothing goes blank.

## Speed, on a real machine

The budgets, measured where they matter. `pnpm --filter sheets test:speed`
covers opening; the rest only exists here.

- [ ] Open a workbook of a million rows. Under five seconds, and the window is
      usable the moment it appears.
- [ ] Scroll that sheet from top to bottom with a trackpad. **60 fps** — no
      tearing, no blank rows catching up behind the pointer.
- [ ] Hold an arrow key down. The selection keeps up.
- [ ] Watch memory in Activity Monitor with that workbook open: under 1 GB.
- [ ] Type into a cell that a hundred thousand formulas depend on. The sheet
      catches up in well under a second.
- [ ] Turn a filter on over a hundred thousand rows. Immediate.

## A workbook that waits

- [ ] Set Calculation to Manual. Type into a cell: that cell works out, nothing
      else does, and the bottom strip says **Calculate**.
- [ ] `F9` catches everything up and the word goes away.
- [ ] Save, reopen: the workbook is still on manual. Open it in Excel — Excel
      agrees it is on manual.
- [ ] Switch back to Automatic: the whole workbook works itself out at once.
- [ ] Goal Seek still finds its answer while the workbook is on manual, and
      leaves it on manual afterwards.

## Losing work

These are the ones that matter most.

- [ ] Edit a workbook, then kill the app from Activity Monitor. Reopen: the
      recovery banner offers the workbook, and recovering it gives back the
      edits.
- [ ] Ignore the recovery offer once. It does not come back on the next launch.
- [ ] Pull the power on a save — or the nearest safe equivalent, killing the app
      mid-write of a large file. The original file is either the old one or the
      new one, never a half of each.
- [ ] Edit a workbook and try to close the window. It asks.
- [ ] Open the same file in two windows. Nothing is lost when both save.
- [ ] Open a file from a network share or an external disk, edit, save. Then
      unplug the disk and try to save again — the failure is said out loud.

## The rest of the file formats

- [ ] Import a `.csv` with Windows-1251 Ukrainian text. The wizard's preview
      shows the mangling before you fix the encoding, and fixing it fixes the
      preview.
- [ ] Export to `.csv` and open the result in Excel on Windows. The Ukrainian
      column is right (this is what the BOM is for).
- [ ] Open an `.ods`. The banner says it was converted. Save — it asks where,
      and writes `.xlsx`.
- [ ] Export to `.ods` and open the result in LibreOffice.

## Print and PDF

- [ ] Print a sheet with a print area set. Only that area prints.
- [ ] Print a sheet with repeating header rows. They repeat.
- [ ] Landscape, fit-to-width and margins all do what they say.
- [ ] Export to PDF and open it in Preview. The numbers are formatted as they
      are on screen, not as they are stored.

## The shell around it

- [ ] Double-click an `.xlsx` in Finder: it opens in Sheets, in a new window if
      one is already open.
- [ ] The native menu bar has everything the command palette has, and the
      shortcuts shown match the ones that work.
- [ ] Every `Mod+` shortcut in the app is the one Excel uses for that thing.
- [ ] Full screen, then Mission Control, then back. The grid is still drawn.
- [ ] Disconnect from the network entirely. Everything above still works.
- [ ] Check Activity Monitor: no network traffic at all, ever.

## Before you tag

- [ ] The version in `tauri.conf.json`, `package.json` and the About window all
      agree.
- [ ] The DMG opens with the app and the Applications folder laid out sensibly.
- [ ] Every line above is either ticked or has a written reason it is not.

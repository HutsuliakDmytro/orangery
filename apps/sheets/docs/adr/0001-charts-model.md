# 0001 — Charts: one engine, three apps

- Status: accepted
- Date: 2026-09-19
- Note: Sheets numbers its own ADRs from 0001, as `apps/sheets/PLAN.md` names
  them. The workspace-wide 0001 lives at `docs/adr/0001-monorepo.md` and is a
  different sequence. This first one is about a shared package rather than about
  Sheets, because charts are Sheets' phase 0 and Docs and Slides need them now.

## Context

Charts already exist in the suite, in three pieces that nobody planned
together:

- `packages/ooxml-drawingml/src/chart.ts` reads a `c:chartSpace` into a small
  model, from the cached values only, and writes nothing.
- `apps/slides/src/render/chart-view.tsx` draws five families of that model in
  SVG, and lives inside Slides because Slides is where charts first had to
  appear.
- `packages/ooxml-presentation/src/chart-data.ts` changes the numbers, patching
  both the cache and the workbook embedded beside the chart part.

Docs renders no chart at all: a `w:drawing` holding one is passed through and
shows as nothing. Sheets has not started, and its charts are a different animal
again — they point at a range in the workbook they live in, and that range is
edited by the app itself, continuously.

So the same `c:*` vocabulary is about to be needed by three apps with three
relationships to the data behind it, and the read-only fraction of it is already
spread across a markup package, an app and a format package.

**The obvious cheap answer — each app grows the chart code it needs — is
wrong.** `c:*` is the largest vocabulary in OOXML outside DrawingML itself: 30-odd
chart types with variants, axes, labels, trendlines, error bars, three separate
style mechanisms. Written three times it would be wrong in three different ways,
and the failure is visible to users: a chart copied from a deck into a document
would not look like itself.

There is also a wrong place to put it. `ooxml-drawingml` describes itself as
"the `a:*` and `pic:*` markup shared by documents and decks" — a markup library.
A chart is not only markup: it is a part of its own with its own relationships,
an embedded workbook, a layout problem and an editor. Growing all of that inside
a markup package would make that package the thing every app depends on for
everything.

## Decision

**`packages/charts` owns everything `c:*`: the model, the parser, the SVG
renderer, the edit operations and the serializer. The three existing pieces move
into it.**

It depends on `ooxml-core` (XML, packages, parts) and `ooxml-drawingml`
(colours, theme, `a:spPr`, text bodies — a chart's title is an `a:` text body,
and its fills are `a:` fills). It will depend on `ooxml-spreadsheet` for the
embedded workbook, once that exists; `ooxml-spreadsheet` must never depend on
`charts`, so a sheet's drawing points at a chart part and the app wires the two.
It depends on no app, and has no app-specific branch in it.

What each app keeps is the wiring only: where the chart part sits in its own
package, what frame it is drawn into, and how a selection maps to the chart.

### One model, and the original XML beside it

The rule Slides set for shapes (`apps/slides/docs/adr/0002-pptx-roundtrip.md`)
applies here without change, for the same reason: what we do not model is not
beside the chart, it is inside it. A plain column chart from a real template
carries `c:spPr` gradients, `c:txPr` run properties, `c:dLbls` per point,
`c:extLst` with the Excel 2016 chart-style id, a `cs:chartStyle` part, a
`c:autoTitleDeleted`, a `c:dispBlanksAs`. A model that captured "columns, these
numbers, this title" and rebuilt the part from it would throw all of that away
on the first save of a file the user only looked at.

So: on open, a chart is parsed into a model **and keeps the `c:chartSpace` node
it was parsed from**. On save, we walk the original node and write back only the
elements the model owns and that actually changed. Everything else stays in
place, in its original order — and order is part of the format here as much as
in `a:spPr`: `c:chart` wants its children as title, autoTitleDeleted, pivotFmts,
view3D, floor, sideWall, backWall, plotArea, legend, plotVisOnly, dispBlanksAs,
and Excel offers to repair a file that says otherwise.

A chart nobody edited is written back byte-identical.

### Modelled in MVP

Drawn and editable:

| Group        | `c:*`             | Variants                                                  |
| ------------ | ----------------- | --------------------------------------------------------- |
| Bar / column | `c:barChart`      | clustered, stacked, percentStacked; `c:barDir` col or bar |
| Line         | `c:lineChart`     | with and without markers, stacked, percentStacked         |
| Pie          | `c:pieChart`      | with `c:firstSliceAng`, exploded                          |
| Doughnut     | `c:doughnutChart` | `c:holeSize`                                              |
| Scatter      | `c:scatterChart`  | `c:scatterStyle` lineMarker, marker, smoothMarker         |
| Area         | `c:areaChart`     | plain, stacked, percentStacked                            |
| Radar        | `c:radarChart`    | marker, filled                                            |

Several groups in one plot area is a combination chart and is modelled as such:
columns with a line over them is two groups, and a group naming none of the
first group's `c:axId`s is measured against the secondary axis. There are never
more than two pairs.

**3-D variants (`c:bar3DChart`, `c:line3DChart`, `c:pie3DChart`,
`c:area3DChart`) are modelled as their flat counterparts and drawn flat.** A
flat drawing of a 3-D column chart reads the same numbers, and the markup is
preserved, so Excel and PowerPoint still show the file in 3-D. Drawing a
perspective box we cannot edit would cost weeks and buy a worse chart.

Modelled around the plot: `c:title`, `c:legend` with position, `c:catAx`,
`c:valAx`, `c:dateAx` (scale, number format, reversed, crossing, major unit,
gridlines), `c:dLbls` at group and point level, `c:varyColors`, `c:gapWidth`,
`c:overlap`, `c:holeSize`, series `c:spPr` fills and lines, `c:marker`.

Rendered, not editable in MVP: `c:trendline`, `c:errBars`, `c:dTable`.

**Everything else is `UnsupportedChart`: a labelled frame at the chart's size,
with its XML preserved verbatim.** That is stock, surface, bubble-3D, and the
whole `cx:chartSpace` family — treemap, sunburst, waterfall, funnel, histogram,
box-and-whisker — which is a different namespace with a different schema and is
not worth modelling to ship a spreadsheet. A frame that says "Waterfall chart"
is honest; a waterfall drawn as bars is a lie, and the numbers would be wrong.

### Data comes from a resolved table, never from XML

The renderer is handed a `ChartData` — categories, series names, numbers — and
never reads a cache itself. Two providers fill it, and which one is authoritative
is the whole difference between the apps:

- **Docs and Slides: the cache is the truth.** `c:numCache` and `c:strCache`
  are what PowerPoint itself draws until somebody opens the data, which is why
  a chart still renders in a file whose embedded workbook has been stripped. An
  edit writes **both** the cache and the embedded workbook, because PowerPoint
  rebuilds the cache from the workbook the moment anyone opens "Edit Data" — a
  chart edited only in its cache is a chart whose edit disappears the first time
  someone looks at it. `chart-data.ts` already gets this right and moves as is.
- **Sheets: the range is the truth.** The chart points at cells in the workbook
  it lives in; the formula engine recalculates them; the cache is regenerated
  from the range on save, and there is no embedded workbook to keep in step.

Same model, same renderer, same serializer. Only the provider differs, and it
is chosen by the host app when it constructs the chart, not by a flag the
package reads.

### The renderer is SVG in all three apps

Including Sheets, whose grid is a `<canvas>` for reasons that do not apply here.
A sheet has a million cells and a handful of charts; charts are floating objects
in a layer above the grid, positioned from their `twoCellAnchor`. SVG keeps
their text real text — measurable, selectable, the same glyphs Docs and Slides
show — and keeps one renderer instead of one per app. The canvas is for cells.

### Rules carried over

- **EMU internally, px only at the edge of the renderer.** Sizes round-trip as
  the integers they were.
- **`schemeClr` stays symbolic.** Theme colours resolve when drawing and never
  when saving, so a theme change recolours the chart the way Office does instead
  of baking today's accents into the file.
- **Series colours follow `accent1..6` in order, as Office does**, unless the
  series states its own `c:spPr`.
- **Office's defaults are the target, not our taste**: gap width 150, overlap
  -27 for clustered columns and 100 for stacked, marker size 5, axis crossing at
  zero. These are the numbers a render diff against PowerPoint measures.

## Consequences

- Slides gives up ~1100 lines to the package and gets chart editing back;
  Docs gets chart rendering as a side effect of the move, which closes a
  PLAN-2 item it was never going to get to on its own.
- Removing `readChart` and friends from `ooxml-drawingml`'s exports breaks every
  importer in Slides and `ooxml-presentation`. It is one mechanical commit, and
  it happens before any new chart work, not after.
- The model is a view over XML, not a replacement for it, so every modelled
  property needs to know how to find its element in an existing subtree and how
  to insert one in schema order when absent. That is the price of the
  guarantee, and it is paid per property.
- **The quiet failure is a stale subtree**: a property that is modelled and
  rendered but whose writer was forgotten leaves the old XML in place, so the
  edit silently does not save. Losing markup fails loudly in Excel; this fails
  in silence. Every modelled property therefore needs a test that edits it,
  saves, reopens and reads it back — not only a test that parses it.
- Three apps depend on this package, so a mistake in its API is expensive to
  correct. The surface stays small on purpose: parse, render, a list of edit
  operations, serialize.
- Charts are phase 0 of Sheets but a feature of Slides and Docs, so `pnpm check`
  at the root is the gate for every commit here, not `pnpm --filter charts`.

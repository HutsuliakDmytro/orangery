# 0002 — PPTX round-trip: per-shape passthrough

- Status: accepted
- Date: 2026-09-17
- Note: numbered 0002 because 0001 is the workspace-wide monorepo decision at
  the repository root. Slides' own ADRs continue from here.

## Context

PPTX is the native format, and the guarantee is the one Docs already makes for
DOCX: open a deck, save it without edits, and PowerPoint renders a file
identical to the one it was given. Docs gets there by holding the package as
read and regenerating only `word/document.xml`, keeping unmodelled elements
inside it as opaque `passthrough` nodes (`apps/docs/docs/adr/0003`).

The same recipe does not transfer, for a reason worth stating plainly.

**A document is a stream; a deck is a tree of independent objects.** In
`document.xml`, the things we do not model are islands in a river of paragraphs:
a field, an OLE object, a `w:sdt` we leave alone. Preserving them as opaque
blocks costs nothing, because the paragraphs around them are fully modelled.

In a deck, the unmodelled markup is not beside the shape — it is _inside_ it. A
plain rectangle with text in it, a shape we absolutely do model, still carries:

- `a:effectLst` with an outer shadow, a glow, a reflection, a soft edge
- `a:scene3d` and `a:sp3d`: bevels, camera, lighting
- `a:gradFill` with a `a:path` shade and half a dozen stops
- `a:prstGeom` with `a:avLst` adjustment values that reshape the preset
- `p:nvSpPr` extension lists (`p:extLst`) carrying creation ids PowerPoint uses
  to match shapes across a Morph transition
- `a:custGeom` with an arbitrary path

A model that captures "rectangle, this fill, this text" and rebuilds the shape
from it loses every one of those — on a shape the user never touched, in a deck
where they only edited the title. That is precisely the failure the guarantee
exists to prevent, and it would happen on the first save of almost any real
deck, because real decks come from templates and templates are full of this.

Modelling all of it is not an answer either. DrawingML's effect, 3-D and
geometry vocabulary is larger than everything Docs models put together, and it
would have to be finished before the first useful save.

## Decision

**Every shape keeps its own original XML subtree, and editing a shape patches
that subtree rather than replacing it.**

Concretely:

1. On open, each shape in a `p:spTree` is parsed into a model _and_ keeps the
   node it was parsed from.
2. On save, for each shape we walk the original node and write back only the
   properties the model owns and that actually changed — the transform, the
   fill, the text body, the line. Everything else in the subtree is untouched,
   in place, in its original order.
3. A shape whose type we do not model at all (SmartArt, OLE, an unknown
   `graphicFrame`) is never rebuilt: it renders as a labelled bounding box and
   is written back byte-identical.
4. A shape the user never selected is written back byte-identical regardless of
   type, because nothing asked to change it.

This is stricter than Docs, not looser. Docs regenerates a paragraph from its
model and relies on `passthrough` children to carry the rest; Slides does not
regenerate the shape at all.

**Child order is part of the format.** `a:spPr` requires its children in schema
order — `a:xfrm`, then geometry, then fill, then `a:ln`, then effects, then
3-D. Inserting a fill after the line makes PowerPoint offer to repair the file,
the same way an out-of-order `w:pPr` does in Word. Patching in place gets this
right by construction for elements that were already there; inserting a new one
goes through the same schema-order helper Docs uses.

### Modelled in MVP

Held as read, never regenerated: `presentation.xml`, `slideLayouts`,
`slideMasters`, `theme`, `notesSlides`, `notesMaster`, `handoutMaster`,
`tableStyles`, `viewProps`, `presProps`, comments, media.

Parsed, rendered and editable: `p:sp` with `a:xfrm`, preset geometry, solid and
gradient fills, lines, a basic outer shadow; `p:txBody` with paragraphs, runs,
bullets and autofit; `p:pic`; `p:grpSp` with nested transforms; `p:cxnSp`;
`p:graphicFrame` holding a table.

Parsed and rendered, never written: `c:chart` — four common types drawn from
the chart XML, which is passed through untouched on save. Editing a chart is
post-MVP, so there is no path by which we could write a `c:*` element.

Rendered as a labelled box, written back verbatim: SmartArt (`dgm:*`), OLE,
embedded objects, unknown `graphicFrame` content.

Preserved verbatim, not interpreted: `p:timing` — animations do not play in
MVP and every object shows in its final state. `p:transition` is read only far
enough to pick one of none/fade/push/wipe for the slideshow; anything else
plays as a fade and is written back as whatever it was.

### Rules that follow

- **EMU internally, px only in the renderer.** Coordinates round-trip as the
  integers they were. Storing px would make every save a lossy conversion.
- **`schemeClr` stays symbolic.** A theme colour is resolved to RGB when
  drawing and never when saving, so changing the deck's theme recolours it the
  way PowerPoint does instead of baking today's palette into the file.
- **Placeholder inheritance is resolved at render time.** A title's font comes
  from the layout, which comes from the master. Writing the resolved value into
  the slide would look identical on screen and would detach the shape from its
  layout forever — the next theme change would skip it.
- **Autofit is computed after layout and written the way PowerPoint writes it**
  (`fontScale`, `lnSpcReduction` on `a:normAutofit`), because those attributes
  are what PowerPoint itself reads back.

## Consequences

- The model is a view over the XML rather than a replacement for it. Every
  property we add has to know how to find its element in an existing subtree and
  how to create one in the right position when it is absent. That is more work
  per property than Docs' approach and it is the price of the guarantee.
- Diffs on save are small and local, which makes the round-trip test sharp: a
  structural diff of a deck saved without edits should be empty, and a deck
  saved after one edit should differ in exactly one shape.
- We can ship an editor that supports a fraction of DrawingML without that
  fraction being visible to anyone who opens the result in PowerPoint. The parts
  we do not model are not "lost but rare" — they are not lost.
- **The risk is a stale subtree.** If a property is modelled but its writer is
  forgotten, the shape keeps its old XML and the edit silently does not save.
  That fails quietly, unlike losing markup, which fails loudly in PowerPoint. So
  every modelled property needs a test that edits it, saves, reopens and reads
  it back — not only a test that parses it.

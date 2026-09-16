# 0003 — DOCX as the native format, with round-trip preservation

- Status: accepted
- Date: 2026-09-16
- Note: PLAN.md calls this ADR `0002-docx-native-roundtrip`; 0002 was already
  taken by the command registry, so it is filed as 0003.

## Context

DOCX is the native format: new documents are DOCX, Save writes DOCX, and there is
no app-specific format (CLAUDE.md, "Document / file rules"). That makes the OOXML
layer the product, not a feature — an import/export sidecar would be acceptable for
an app with its own format, and is not acceptable here.

The guarantee we are committing to: **opening a DOCX and saving it without edits
must produce a file Word and LibreOffice render identically.** Every existing
JS library fails this, for structural reasons rather than bugs:

- **mammoth** converts DOCX to HTML. It is explicitly lossy and one-way; it
  discards `styles.xml`, numbering definitions, section properties, themes and
  anything it does not map to an HTML tag. Round-trip is not a goal of the project.
- **docx (npm)** is a _generator_. It builds a package from scratch out of its own
  object model. It has no reader, so "open then save" is really "parse with
  something else, rebuild from a lossy intermediate" — every part we did not model
  is gone.
- **docx4js / docxtemplater** read the package but expose it as their own trees;
  preserving unmodelled XML is not part of their contract.

The failure mode is always the same and always invisible until a user complains:
a document opens, looks right, saves — and the recipient's Word shows lost list
numbering, a missing theme font, broken cross-references, or a repair prompt.

## Decision

Write our own layer in `src/ooxml/`, built on two primitives only: JSZip for the
package and fast-xml-parser for XML.

**1. The package is held, not rebuilt.** On open, every part of the zip is kept in
memory exactly as it was read: `styles.xml`, `numbering.xml`, `settings.xml`,
`theme/*`, `fontTable.xml`, headers and footers, `customXml`, media binaries,
`[Content_Types].xml` and every `.rels`. On save, those bytes are written back
unchanged. Only `word/document.xml` is regenerated.

**2. Unknown XML inside `document.xml` becomes a `passthrough` node or mark.**
The parser walks the document body. Elements it understands become ProseMirror
nodes; elements it does not are stored verbatim as serialised XML on a
`passthrough` node (block level) or mark (inline level), and written back byte-for-byte
on save. An unsupported construct therefore survives editing elsewhere in the file.

**3. The ProseMirror schema mirrors OOXML, not HTML.** `paragraph` carries `pPr`
(style id, numbering reference, spacing, indentation, alignment), runs carry
`rPr`. Modelling on HTML would force a lossy translation in both directions and
invent formatting on export that was never in the source.

**4. Fidelity is measured, not asserted.** Round-trip tests compare `document.xml`
structurally — ignoring `w:rsid*` revision-save ids and attribute order, which Word
itself varies between saves — across the whole corpus in `tests/fixtures/docx/`.
CI additionally renders before and after through headless LibreOffice to PDF and
diffs the pages, because structural equality is necessary but not sufficient.

## Alternatives considered

**Use mammoth for import and docx-npm for export.** This is the standard approach
and was the original plan in PLAN.md. It cannot meet the preservation guarantee:
the two libraries share no model, so a round-trip is a translation through HTML.
Rejected once DOCX became the native format rather than an interchange format.

**Keep an internal format and treat DOCX as import/export.** Rejected in CLAUDE.md
as a product decision: users would hit "which copy is the real one?" and every
save would need two writes.

**Edit the XML in place with a DOM-diff instead of regenerating `document.xml`.**
Maximum fidelity, but it makes every editing command a tree-patch operation and
throws away ProseMirror's transaction model. Rejected as disproportionate: the
passthrough mechanism covers the same ground for the parts we do not model.

## Consequences

- Reading and writing OOXML is our maintenance burden, indefinitely. Budgeted:
  it is the core of the product.
- XML must be parsed with attribute order and whitespace preserved, and
  `xml:space="preserve"` respected, or round-trip fails on whitespace alone.
- The parser must never throw on unknown input. Anything unrecognised degrades to
  passthrough plus a warning in `document.warnings[]` — never a crash, never a
  silent drop (CLAUDE.md).
- Editing _inside_ an unsupported construct is not possible; it is an opaque block.
  That is an accepted limitation, and the UI must show it as such rather than
  pretending the content is editable.
- The corpus in `tests/fixtures/docx/real/` is load-bearing. Synthetic fixtures
  prove the parser handles constructs; only real documents prove preservation.

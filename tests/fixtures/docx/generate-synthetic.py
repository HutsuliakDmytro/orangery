#!/usr/bin/env python3
"""Generates the synthetic half of the DOCX fidelity corpus.

These files are structurally valid OOXML but authored by python-docx, not by Word.
They cover individual features in isolation, which makes failures easy to localise.
They do NOT replace the `real/` corpus: documents produced by Word, Google Docs and
LibreOffice carry styles.xml, theme1.xml, settings.xml, fontTable.xml and rels that
no generator reproduces faithfully, and round-trip preservation is judged against those.

Run:  python3 tests/fixtures/docx/generate-synthetic.py
"""

from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.shared import Inches, Pt, RGBColor

OUT = Path(__file__).parent / "synthetic"
LOREM = (
    "The quick brown fox jumps over the lazy dog. "
    "Portez ce vieux whisky au juge blond qui fume. "
    "Чуєш їх, доцю, га? Кумедна ж ти, прощайся без ґольфів."
)


def plain_paragraphs() -> Document:
    doc = Document()
    for i in range(5):
        doc.add_paragraph(f"Paragraph {i + 1}. {LOREM}")
    return doc


def headings() -> Document:
    doc = Document()
    doc.add_heading("Title of the document", level=0)
    for level in range(1, 7):
        doc.add_heading(f"Heading level {level}", level=level)
        doc.add_paragraph(LOREM)
    return doc


def character_formatting() -> Document:
    doc = Document()
    p = doc.add_paragraph()
    p.add_run("bold ").bold = True
    p.add_run("italic ").italic = True
    p.add_run("underline ").underline = True
    strike = p.add_run("strikethrough ")
    strike.font.strike = True
    sup = p.add_run("superscript ")
    sup.font.superscript = True
    sub = p.add_run("subscript ")
    sub.font.subscript = True
    colored = p.add_run("colored ")
    colored.font.color.rgb = RGBColor(0xFF, 0x7A, 0x00)
    sized = p.add_run("18pt ")
    sized.font.size = Pt(18)
    named = p.add_run("Courier New")
    named.font.name = "Courier New"
    return doc


def paragraph_formatting() -> Document:
    doc = Document()
    for align, label in (
        (WD_ALIGN_PARAGRAPH.LEFT, "left"),
        (WD_ALIGN_PARAGRAPH.CENTER, "center"),
        (WD_ALIGN_PARAGRAPH.RIGHT, "right"),
        (WD_ALIGN_PARAGRAPH.JUSTIFY, "justified"),
    ):
        p = doc.add_paragraph(f"This paragraph is {label}. {LOREM}")
        p.alignment = align

    spaced = doc.add_paragraph(f"Double spaced, indented. {LOREM}")
    spaced.paragraph_format.line_spacing = 2.0
    spaced.paragraph_format.left_indent = Inches(0.5)
    spaced.paragraph_format.space_before = Pt(12)
    spaced.paragraph_format.space_after = Pt(12)
    spaced.paragraph_format.first_line_indent = Inches(0.25)
    return doc


def lists() -> Document:
    doc = Document()
    doc.add_heading("Bulleted", level=1)
    for i in range(3):
        doc.add_paragraph(f"Bullet {i + 1}", style="List Bullet")
    doc.add_paragraph("Nested bullet", style="List Bullet 2")
    doc.add_paragraph("Deeper bullet", style="List Bullet 3")

    doc.add_heading("Numbered", level=1)
    for i in range(3):
        doc.add_paragraph(f"Item {i + 1}", style="List Number")
    doc.add_paragraph("Nested item", style="List Number 2")
    return doc


def tables() -> Document:
    doc = Document()
    doc.add_heading("Simple grid", level=1)
    table = doc.add_table(rows=4, cols=3)
    table.style = "Table Grid"
    for r, row in enumerate(table.rows):
        for c, cell in enumerate(row.cells):
            cell.text = f"r{r + 1}c{c + 1}"

    doc.add_heading("Merged cells and widths", level=1)
    merged = doc.add_table(rows=3, cols=3)
    merged.style = "Table Grid"
    merged.cell(0, 0).merge(merged.cell(0, 2)).text = "merged across three columns"
    merged.cell(1, 0).merge(merged.cell(2, 0)).text = "merged down two rows"
    for row in merged.rows:
        row.cells[1].width = Inches(2.5)
    return doc


def headers_and_footers() -> Document:
    doc = Document()
    section = doc.sections[0]
    section.header.paragraphs[0].text = "Orangery Docs — header"
    section.footer.paragraphs[0].text = "Footer text, page number lives in fldSimple"
    doc.add_paragraph(LOREM)
    doc.add_paragraph(LOREM)
    return doc


def sections_and_page_setup() -> Document:
    doc = Document()
    doc.add_paragraph("Portrait section. " + LOREM)
    landscape = doc.add_section(WD_SECTION.NEW_PAGE)
    landscape.orientation = WD_ORIENT.LANDSCAPE
    landscape.page_width, landscape.page_height = landscape.page_height, landscape.page_width
    landscape.left_margin = Inches(0.5)
    landscape.right_margin = Inches(0.5)
    doc.add_paragraph("Landscape section with narrow margins. " + LOREM)
    return doc


def breaks_and_rules() -> Document:
    doc = Document()
    doc.add_paragraph("Before the page break. " + LOREM)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    doc.add_paragraph("After the page break. " + LOREM)
    p = doc.add_paragraph("Line one")
    p.add_run().add_break(WD_BREAK.LINE)
    p.add_run("line two after a soft break")
    return doc


def images() -> Document:
    """A document with an embedded picture, which brings in media parts and rels."""
    from io import BytesIO
    import struct
    import zlib

    def png(width: int, height: int, colour: tuple[int, int, int]) -> BytesIO:
        rows = b"".join(b"\x00" + bytes(colour) * width for _ in range(height))

        def chunk(tag: bytes, data: bytes) -> bytes:
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data))
            )

        data = (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9))
            + chunk(b"IEND", b"")
        )
        return BytesIO(data)

    doc = Document()
    doc.add_heading("With pictures", level=1)
    doc.add_paragraph("An inline picture follows.")
    doc.add_picture(png(120, 80, (0xFF, 0x7A, 0x00)), width=Inches(2))
    doc.add_paragraph(LOREM)
    doc.add_picture(png(60, 60, (0x0B, 0x0B, 0x0B)), width=Inches(1))
    return doc


def footnotes() -> Document:
    """python-docx cannot add footnotes, so the part is written by hand."""
    doc = Document()
    doc.add_paragraph("Body text with a note reference.")
    doc.add_paragraph(LOREM)
    return doc


def styled_paragraphs() -> Document:
    doc = Document()
    for style in ("Title", "Subtitle", "Intense Quote", "Quote", "Caption"):
        try:
            doc.add_paragraph(f"{style} sample", style=style)
        except KeyError:
            # Not every build of the default template defines every style.
            doc.add_paragraph(f"{style} sample")
    doc.add_paragraph("Body", style="Normal")
    return doc


def nested_lists() -> Document:
    doc = Document()
    for level in range(1, 4):
        suffix = "" if level == 1 else f" {level}"
        for index in range(2):
            doc.add_paragraph(
                f"Bullet level {level} item {index + 1}", style=f"List Bullet{suffix}"
            )
    for level in range(1, 4):
        suffix = "" if level == 1 else f" {level}"
        doc.add_paragraph(f"Number level {level}", style=f"List Number{suffix}")
    return doc


def wide_table() -> Document:
    doc = Document()
    doc.add_heading("A wide table", level=2)
    table = doc.add_table(rows=6, cols=6)
    table.style = "Table Grid"
    for r, row in enumerate(table.rows):
        for c, cell in enumerate(row.cells):
            cell.text = f"{r + 1}-{c + 1}"
    # A merged header spanning the full width.
    merged = table.cell(0, 0).merge(table.cell(0, 5))
    merged.text = "Header spanning every column"
    return doc


def mixed_content() -> Document:
    """Everything at once, which is what a real document looks like."""
    doc = Document()
    doc.add_heading("Report", level=0)
    doc.add_paragraph("Prepared for review.", style="Subtitle" if "Subtitle" else None)
    doc.add_heading("Findings", level=1)
    doc.add_paragraph(LOREM)
    for index in range(3):
        doc.add_paragraph(f"Finding {index + 1}", style="List Number")

    table = doc.add_table(rows=3, cols=3)
    table.style = "Table Grid"
    for r, row in enumerate(table.rows):
        for c, cell in enumerate(row.cells):
            cell.text = f"r{r + 1}c{c + 1}"

    doc.add_heading("Conclusion", level=1)
    paragraph = doc.add_paragraph()
    paragraph.add_run("Bold conclusion. ").bold = True
    paragraph.add_run("With a ")
    italic = paragraph.add_run("qualification")
    italic.italic = True
    paragraph.add_run(".")

    section = doc.sections[0]
    section.header.paragraphs[0].text = "Report — confidential"
    section.footer.paragraphs[0].text = "Page"
    return doc


def hyperlinks_and_unicode() -> Document:
    doc = Document()
    doc.add_paragraph("Плоский текст українською з лапками «ялинками» та тире — ось так.")
    doc.add_paragraph("Emoji and symbols: ✓ ✗ → ± § ¶ … “quoted” ‘single’")
    doc.add_paragraph("RTL sample: مرحبا بالعالم")
    doc.add_paragraph("CJK sample: 日本語のテキストです")
    return doc


BUILDERS = {
    "plain-paragraphs": plain_paragraphs,
    "headings": headings,
    "character-formatting": character_formatting,
    "paragraph-formatting": paragraph_formatting,
    "lists": lists,
    "tables": tables,
    "headers-footers": headers_and_footers,
    "sections-page-setup": sections_and_page_setup,
    "breaks": breaks_and_rules,
    "unicode": hyperlinks_and_unicode,
    "images": images,
    "footnotes": footnotes,
    "styled-paragraphs": styled_paragraphs,
    "nested-lists": nested_lists,
    "wide-table": wide_table,
    "mixed-content": mixed_content,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, build in BUILDERS.items():
        path = OUT / f"{name}.docx"
        build().save(path)
        print(f"{path.relative_to(Path.cwd())}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()

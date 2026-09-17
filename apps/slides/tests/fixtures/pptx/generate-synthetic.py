#!/usr/bin/env python3
"""Generates the synthetic half of the PPTX fidelity corpus.

Structurally valid OOXML, authored by python-pptx rather than by PowerPoint.
Each deck isolates one construct so a failing round-trip points straight at what
broke.

These do NOT replace the `real/` corpus. python-pptx writes a spare package: one
master, one theme, no `p:timing`, no effects, no extension lists, and a rels
graph far simpler than anything PowerPoint produces. Passing round-trip here
proves the parser handles the constructs; it proves nothing about preserving the
parts we do not understand, which is the whole guarantee (see
`apps/slides/docs/adr/0002-pptx-roundtrip.md`).

Run:  python3 apps/slides/tests/fixtures/pptx/generate-synthetic.py
"""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.util import Emu, Inches, Pt

OUT = Path(__file__).parent / "synthetic"

LOREM = "The quick brown fox jumps over the lazy dog."
CYRILLIC = "Чуєш їх, доцю, га? Кумедна ж ти, прощайся без ґольфів."


def blank(prs):
    """The layout with no placeholders, for decks that place their own shapes."""
    return prs.slide_layouts[6]


def title_only(prs):
    return prs.slide_layouts[5]


def empty() -> Presentation:
    """One slide, nothing on it — the smallest package that is still a deck."""
    prs = Presentation()
    prs.slides.add_slide(blank(prs))
    return prs


def placeholders() -> Presentation:
    """Title and content placeholders, which inherit from layout and master."""
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Placeholder inheritance"
    slide.placeholders[1].text = f"{LOREM}\n{CYRILLIC}"
    return prs


def text_formatting() -> Presentation:
    """Runs that differ in weight, slope, size and colour inside one paragraph."""
    prs = Presentation()
    slide = prs.slides.add_slide(blank(prs))
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(3))
    frame = box.text_frame

    paragraph = frame.paragraphs[0]
    for text, bold, italic, size, colour in [
        ("Plain ", False, False, 18, None),
        ("bold ", True, False, 18, None),
        ("italic ", False, True, 18, None),
        ("large ", False, False, 32, None),
        ("orange", False, False, 18, RGBColor(0xFF, 0x7A, 0x00)),
    ]:
        run = paragraph.add_run()
        run.text = text
        run.font.bold = bold
        run.font.italic = italic
        run.font.size = Pt(size)
        if colour is not None:
            run.font.color.rgb = colour

    second = frame.add_paragraph()
    second.text = CYRILLIC
    second.level = 1
    return prs


def shapes() -> Presentation:
    """Preset geometries with fills and lines — the common case for spPr."""
    prs = Presentation()
    slide = prs.slides.add_slide(blank(prs))

    for index, preset in enumerate(
        [MSO_SHAPE.RECTANGLE, MSO_SHAPE.OVAL, MSO_SHAPE.RIGHT_ARROW, MSO_SHAPE.STAR_5_POINT]
    ):
        shape = slide.shapes.add_shape(
            preset, Inches(0.5 + index * 2.2), Inches(1.5), Inches(2), Inches(1.5)
        )
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor(0x16, 0x16, 0x16)
        shape.line.color.rgb = RGBColor(0xFF, 0x7A, 0x00)
        shape.line.width = Pt(2)
        shape.text_frame.text = preset.name.title()

    return prs


def groups_and_connectors() -> Presentation:
    """Nested transforms and a connector, which carry their own coordinate space."""
    prs = Presentation()
    slide = prs.slides.add_slide(blank(prs))


    first = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1), Inches(2), Inches(2), Inches(1)
    )
    second = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(5), Inches(2), Inches(2), Inches(1)
    )
    first.text_frame.text = "From"
    second.text_frame.text = "To"

    connector = slide.shapes.add_connector(
        MSO_CONNECTOR.STRAIGHT, Inches(3), Inches(2.5), Inches(5), Inches(2.5)
    )
    connector.begin_connect(first, 3)
    connector.end_connect(second, 1)

    # A group states where it sits and the coordinate space its children are
    # written in; the two differ here, so a reader that ignores chOff/chExt
    # puts the children in the wrong place.
    group = slide.shapes.add_group_shape()
    inner = group.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(1), Inches(4), Inches(1), Inches(1)
    )
    inner.text_frame.text = "In a group"
    group.shapes.add_shape(MSO_SHAPE.OVAL, Inches(2.5), Inches(4), Inches(1), Inches(1))
    group.left, group.top = Inches(5), Inches(4)
    group.width, group.height = Inches(3), Inches(1)
    return prs


def table() -> Presentation:
    """A graphicFrame holding a:tbl, the one graphic frame we model fully."""
    prs = Presentation()
    slide = prs.slides.add_slide(title_only(prs))
    slide.shapes.title.text = "Table"

    frame = slide.shapes.add_table(3, 3, Inches(1), Inches(2), Inches(8), Inches(2))
    grid = frame.table
    for column in range(3):
        grid.cell(0, column).text = f"Head {column + 1}"
    for row in range(1, 3):
        for column in range(3):
            grid.cell(row, column).text = f"r{row}c{column}"
    return prs


def picture() -> Presentation:
    """A pic with a media part behind it, so the rels graph has something in it."""
    prs = Presentation()
    slide = prs.slides.add_slide(blank(prs))
    slide.shapes.add_picture(str(Path(__file__).parent / "sample.png"), Inches(2), Inches(1.5))
    return prs


def notes() -> Presentation:
    """A notesSlide, which is its own part with its own master."""
    prs = Presentation()
    slide = prs.slides.add_slide(title_only(prs))
    slide.shapes.title.text = "Slide with notes"
    slide.notes_slide.notes_text_frame.text = f"{LOREM} {CYRILLIC}"
    return prs


def many_slides() -> Presentation:
    """Enough slides that ordering through sldIdLst is worth asserting."""
    prs = Presentation()
    for index in range(8):
        slide = prs.slides.add_slide(title_only(prs))
        slide.shapes.title.text = f"Slide {index + 1}"
    return prs


def widescreen() -> Presentation:
    """16:9, where python-pptx's template is 4:3, so slide size is not assumed."""
    prs = Presentation()
    prs.slide_width = Emu(12192000)
    prs.slide_height = Emu(6858000)
    prs.slides.add_slide(title_only(prs)).shapes.title.text = "Sixteen by nine"
    return prs


DECKS = {
    "empty": empty,
    "placeholders": placeholders,
    "text-formatting": text_formatting,
    "shapes": shapes,
    "groups-and-connectors": groups_and_connectors,
    "table": table,
    "picture": picture,
    "notes": notes,
    "many-slides": many_slides,
    "sixteen-by-nine": widescreen,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, build in DECKS.items():
        build().save(OUT / f"{name}.pptx")
        print(f"wrote {name}.pptx")


if __name__ == "__main__":
    main()

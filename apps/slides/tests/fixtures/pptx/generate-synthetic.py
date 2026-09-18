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

import io
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.oxml import parse_xml
from pptx.oxml.ns import qn
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


def charts() -> Presentation:
    """Three chart types on one slide, each its own part under ppt/charts."""
    prs = Presentation()
    slide = prs.slides.add_slide(blank(prs))

    data = CategoryChartData()
    data.categories = ["Q1", "Q2", "Q3", "Q4"]
    data.add_series("Revenue", (10.5, 14.2, 9.8, 18.1))
    data.add_series("Costs", (7.1, 8.4, 8.9, 10.0))

    columns = slide.shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.5), Inches(0.5), Inches(4.5), Inches(3), data
    ).chart
    columns.has_legend = True
    columns.legend.position = XL_LEGEND_POSITION.BOTTOM
    columns.legend.include_in_layout = False

    slide.shapes.add_chart(
        XL_CHART_TYPE.LINE, Inches(5.2), Inches(0.5), Inches(4), Inches(3), data
    )

    single = CategoryChartData()
    single.categories = ["Alpha", "Beta", "Gamma"]
    single.add_series("Share", (45, 30, 25))
    slide.shapes.add_chart(
        XL_CHART_TYPE.PIE, Inches(0.5), Inches(3.8), Inches(4), Inches(2.8), single
    )

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



NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS_P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"


def add_transition(slide, xml: str) -> None:
    """Appends raw transition markup, which python-pptx has no model for.

    `p:transition` comes after `p:cSld` and `p:clrMapOvr` and before `p:timing`,
    and a slide built here has neither of the latter, so appending is in order.
    """
    slide._element.append(parse_xml(xml))


def transitions() -> Presentation:
    """One slide per kind, including two we deliberately do not animate.

    A dissolve is not none — it is a change we cannot draw, and the show has to
    decide what to do with it rather than pretend the slide simply appeared.
    The last slide writes its duration the way PowerPoint 2010 onwards does,
    inside `mc:AlternateContent`, which is the form most real decks carry.
    """
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(9144000), Emu(6858000)

    plain = [
        ("Fade", f'<p:transition xmlns:p="{NS_P}" spd="slow"><p:fade/></p:transition>'),
        ("Push", f'<p:transition xmlns:p="{NS_P}" spd="med"><p:push dir="u"/></p:transition>'),
        ("Wipe", f'<p:transition xmlns:p="{NS_P}" spd="fast"><p:wipe dir="r"/></p:transition>'),
        ("Dissolve", f'<p:transition xmlns:p="{NS_P}"><p:dissolve/></p:transition>'),
    ]

    for title, xml in plain:
        slide = prs.slides.add_slide(title_only(prs))
        slide.shapes.title.text = title
        add_transition(slide, xml)

    slide = prs.slides.add_slide(title_only(prs))
    slide.shapes.title.text = "Timed"
    add_transition(
        slide,
        f'''<mc:AlternateContent xmlns:mc="{NS_MC}" xmlns:p="{NS_P}" xmlns:p14="{NS_P14}">
          <mc:Choice Requires="p14">
            <p:transition spd="slow" p14:dur="1500"><p:fade/></p:transition>
          </mc:Choice>
          <mc:Fallback>
            <p:transition spd="slow"><p:fade/></p:transition>
          </mc:Fallback>
        </mc:AlternateContent>''',
    )

    return prs



TIMING = """<p:timing xmlns:p="{ns}">
  <p:tnLst>
    <p:par>
      <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">
        <p:childTnLst>
          <p:seq concurrent="1" nextAc="seek">
            <p:cTn id="2" dur="indefinite" nodeType="mainSeq">
              <p:childTnLst>
                <p:par>
                  <p:cTn id="3" fill="hold">
                    <p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>
                    <p:childTnLst>
                      <p:par>
                        <p:cTn id="4" fill="hold">
                          <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                          <p:childTnLst>
                            <p:par>
                              <p:cTn id="5" presetID="10" presetClass="entr" presetSubtype="0"
                                     fill="hold" nodeType="clickEffect">
                                <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                                <p:childTnLst>
                                  <p:set>
                                    <p:cBhvr>
                                      <p:cTn id="6" dur="1" fill="hold">
                                        <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                                      </p:cTn>
                                      <p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>
                                      <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>
                                    </p:cBhvr>
                                    <p:to><p:strVal val="visible"/></p:to>
                                  </p:set>
                                  <p:animEffect transition="in" filter="fade">
                                    <p:cBhvr>
                                      <p:cTn id="7" dur="500"/>
                                      <p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>
                                    </p:cBhvr>
                                  </p:animEffect>
                                </p:childTnLst>
                              </p:cTn>
                            </p:par>
                          </p:childTnLst>
                        </p:cTn>
                      </p:par>
                    </p:childTnLst>
                  </p:cTn>
                  <p:prevCondLst>
                    <p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond>
                  </p:prevCondLst>
                  <p:nextCondLst>
                    <p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond>
                  </p:nextCondLst>
                </p:par>
              </p:childTnLst>
            </p:cTn>
          </p:seq>
        </p:childTnLst>
      </p:cTn>
    </p:par>
  </p:tnLst>
</p:timing>"""


def animations() -> Presentation:
    """A slide with an entrance animation, and one with a hidden shape.

    The timing is real markup nothing here models: the point of the deck is that
    it comes back out of a round-trip exactly as it went in. The hidden shape is
    the other half of "objects in their final state" — a shape PowerPoint does
    not draw is one we must not draw either, animation or no animation.
    """
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(9144000), Emu(6858000)

    slide = prs.slides.add_slide(title_only(prs))
    slide.shapes.title.text = "Animated"
    box = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1), Inches(3), Inches(3), Inches(1.5)
    )
    box.text_frame.text = "Fades in"
    slide._element.append(parse_xml(TIMING.format(ns=NS_P, spid=box.shape_id)))

    second = prs.slides.add_slide(title_only(prs))
    second.shapes.title.text = "Hidden shape"
    shown = second.shapes.add_shape(
        MSO_SHAPE.OVAL, Inches(1), Inches(3), Inches(2), Inches(2)
    )
    shown.text_frame.text = "Shown"
    unseen = second.shapes.add_shape(
        MSO_SHAPE.OVAL, Inches(4), Inches(3), Inches(2), Inches(2)
    )
    unseen.text_frame.text = "Not shown"
    unseen._element.nvSpPr.cNvPr.set("hidden", "1")

    return prs



def media() -> Presentation:
    """A video on one slide and an audio clip on another.

    The bytes are a stand-in: nothing in the tests decodes them, and a real
    encoder is a dependency this corpus does not need. What has to be real is
    the package around them — the media part, its content type, the two
    relationships a video carries, and the poster frame the slide draws until it
    is played.
    """
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(9144000), Emu(6858000)

    clip = io.BytesIO(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)
    slide = prs.slides.add_slide(title_only(prs))
    slide.shapes.title.text = "Video"
    slide.shapes.add_movie(
        clip,
        Inches(1),
        Inches(2.5),
        Inches(6),
        Inches(3.5),
        poster_frame_image=str(Path(__file__).parent / "sample.png"),
        mime_type="video/mp4",
    )

    tune = io.BytesIO(b"ID3\x03\x00\x00\x00" + b"\x00" * 64)
    second = prs.slides.add_slide(title_only(prs))
    second.shapes.title.text = "Audio"
    sound = second.shapes.add_movie(
        tune,
        Inches(1),
        Inches(3),
        Inches(1),
        Inches(1),
        poster_frame_image=str(Path(__file__).parent / "sample.png"),
        mime_type="audio/mpeg",
    )

    # python-pptx writes a video whatever the mime type says, and PowerPoint
    # writes `a:audioFile` for a sound. That difference is the whole of what
    # tells a player to draw a control instead of a picture.
    nv_pr = sound._element.nvPicPr.nvPr
    video = nv_pr.find(qn("a:videoFile"))
    nv_pr.replace(
        video,
        parse_xml(
            '<a:audioFile xmlns:a="%s" xmlns:r="%s" r:link="%s"/>'
            % (NS_A, NS_R, video.get(qn("r:link")))
        ),
    )

    return prs


DECKS = {
    "empty": empty,
    "placeholders": placeholders,
    "text-formatting": text_formatting,
    "shapes": shapes,
    "groups-and-connectors": groups_and_connectors,
    "table": table,
    "picture": picture,
    "charts": charts,
    "notes": notes,
    "many-slides": many_slides,
    "sixteen-by-nine": widescreen,
    "transitions": transitions,
    "animations": animations,
    "media": media,
}


def main() -> None:
    """Writes every deck, or only the ones named on the command line.

    Naming one matters: python-pptx writes a slightly different package from
    version to version, so regenerating a deck nobody changed would rewrite
    files the round-trip corpus is pinned to.
    """
    OUT.mkdir(parents=True, exist_ok=True)

    wanted = sys.argv[1:] or list(DECKS)
    for name in wanted:
        build = DECKS.get(name)
        if build is None:
            raise SystemExit(f"no such deck: {name}")
        build().save(OUT / f"{name}.pptx")
        print(f"wrote {name}.pptx")


if __name__ == "__main__":
    main()

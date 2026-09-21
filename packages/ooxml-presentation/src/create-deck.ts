import { writePackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { addSlide } from './add-slide'
import { readDeck } from './deck'
import { THEME_GALLERY } from './theme-gallery'
import { setThemeColors, setThemeFonts, setThemeName } from './write-theme'

/**
 * The deck a new presentation starts from.
 *
 * A new deck is a real OOXML package from the first keystroke (CLAUDE.md), so
 * there is never a moment where the app holds something that is not the native
 * format — no internal representation to convert, nothing to lose on the first
 * save. What is written here is the minimum PowerPoint opens without offering
 * to repair the file, and no more: every part is one we model, so a deck made
 * here and saved unedited is a deck we can also read back.
 *
 * The master and its layouts are written out by hand rather than generated from
 * a smaller description. A layout is a fixed thing — PowerPoint's own eleven are
 * fixed too — and the description that produced six of them would be a second
 * language to learn, with the placeholder geometry still written out inside it.
 */

const EMU_PER_INCH = 914400

/** Widescreen, which is what every deck made since about 2013 is. */
const SLIDE_WIDTH = 12192000
const SLIDE_HEIGHT = 6858000

/** Notes pages are portrait Letter, as PowerPoint writes them. */
const NOTES_WIDTH = 6858000
const NOTES_HEIGHT = 9144000

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

const P_NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'

const RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** Body margins, in EMU: half an inch each side of a 16:9 slide. */
const MARGIN = EMU_PER_INCH / 2

function xml(body: string): string {
  return `${DECLARATION}${body}`
}

function relationships(entries: { id: string; type: string; target: string }[]): string {
  const list = entries
    .map(
      (entry) =>
        `<Relationship Id="${entry.id}" Type="${RELATIONSHIP}/${entry.type}" Target="${entry.target}"/>`,
    )
    .join('')
  return xml(`<Relationships ${RELS_NS}>${list}</Relationships>`)
}

/** `a:off`/`a:ext` for a shape, which is all the geometry a placeholder states. */
function frame(x: number, y: number, width: number, height: number): string {
  return `<a:xfrm><a:off x="${String(Math.round(x))}" y="${String(Math.round(y))}"/><a:ext cx="${String(Math.round(width))}" cy="${String(Math.round(height))}"/></a:xfrm>`
}

interface PlaceholderSpec {
  id: number
  name: string
  /** `p:ph` type; omitted for the body placeholder, whose type is the default. */
  type?: string
  /** `p:ph` index, which is what tells two bodies on one layout apart. */
  index?: number
  box: { x: number; y: number; width: number; height: number }
  /** `a:prstTxWarp`-free body properties; the anchor is the only thing that varies. */
  anchor?: 'ctr' | 'b'
  /** Prompt text, shown by PowerPoint when the placeholder is empty. */
  prompt: string
}

function placeholder(spec: PlaceholderSpec): string {
  const type = spec.type === undefined ? '' : ` type="${spec.type}"`
  const index = spec.index === undefined ? '' : ` idx="${String(spec.index)}"`
  const anchor = spec.anchor === undefined ? '' : ` anchor="${spec.anchor}"`

  return `<p:sp><p:nvSpPr><p:cNvPr id="${String(spec.id)}" name="${spec.name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${type}${index}/></p:nvPr></p:nvSpPr><p:spPr>${frame(spec.box.x, spec.box.y, spec.box.width, spec.box.height)}</p:spPr><p:txBody><a:bodyPr${anchor}/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${spec.prompt}</a:t></a:r></a:p></p:txBody></p:sp>`
}

/** The empty group every shape tree opens with. */
function treeHead(): string {
  return `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`
}

/**
 * Where the title and the body sit on an ordinary slide.
 *
 * One set of numbers, used by the master and by every layout that follows it:
 * a layout states its own geometry, and two layouts that disagree about where
 * the title goes are two layouts a deck visibly jumps between.
 */
const TITLE_BOX = {
  x: MARGIN,
  y: MARGIN,
  width: SLIDE_WIDTH - MARGIN * 2,
  height: EMU_PER_INCH * 1.2,
}

const BODY_BOX = {
  x: MARGIN,
  y: MARGIN + EMU_PER_INCH * 1.4,
  width: SLIDE_WIDTH - MARGIN * 2,
  height: SLIDE_HEIGHT - MARGIN * 2 - EMU_PER_INCH * 1.4,
}

/** The three strips along the bottom that every master carries. */
function footerPlaceholders(startId: number): string {
  const y = SLIDE_HEIGHT - MARGIN - EMU_PER_INCH * 0.3
  const width = (SLIDE_WIDTH - MARGIN * 2) / 3
  const height = EMU_PER_INCH * 0.3

  return [
    { type: 'dt', index: 10, name: 'Date Placeholder', x: MARGIN },
    { type: 'ftr', index: 11, name: 'Footer Placeholder', x: MARGIN + width },
    { type: 'sldNum', index: 12, name: 'Slide Number Placeholder', x: MARGIN + width * 2 },
  ]
    .map(
      (spec, offset) =>
        `<p:sp><p:nvSpPr><p:cNvPr id="${String(startId + offset)}" name="${spec.name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${spec.type}" sz="quarter" idx="${String(spec.index)}"/></p:nvPr></p:nvSpPr><p:spPr>${frame(spec.x, y, width, height)}</p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`,
    )
    .join('')
}

/**
 * The colour map, which is what makes `bg1` mean something.
 *
 * A slide says `schemeClr bg1`; the map says which of the theme's twelve slots
 * that is. Without it PowerPoint has no way to resolve a single scheme colour
 * and refuses the file.
 */
const COLOR_MAP =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'

/**
 * The master's text styles: what a title, a body and everything else start as.
 *
 * Nine body levels because `p:txStyles` is a sequence PowerPoint expects to be
 * complete; a deck with three of them opens, and then indents the fourth level
 * against nothing.
 */
function textStyles(): string {
  const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    .map((level) => {
      const indent = EMU_PER_INCH * 0.35 * (level + 1)
      const size = Math.max(2800 - level * 300, 1200)
      return `<a:lvl${String(level + 1)}pPr marL="${String(Math.round(indent))}" indent="${String(Math.round(-EMU_PER_INCH * 0.25))}"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="${String(size)}"/></a:lvl${String(level + 1)}pPr>`
    })
    .join('')

  const other = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((level) => `<a:lvl${String(level)}pPr><a:defRPr sz="1800"/></a:lvl${String(level)}pPr>`)
    .join('')

  return `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle>${levels}</p:bodyStyle><p:otherStyle>${other}</p:otherStyle></p:txStyles>`
}

function slideMaster(layoutCount: number): string {
  const layoutIds = Array.from(
    { length: layoutCount },
    // The ids are arbitrary but have to be above 2147483648 by the schema, and
    // PowerPoint's own start here.
    (_, index) =>
      `<p:sldLayoutId id="${String(2147483649 + index)}" r:id="rId${String(index + 1)}"/>`,
  ).join('')

  const shapes = [
    placeholder({
      id: 2,
      name: 'Title Placeholder',
      type: 'title',
      box: TITLE_BOX,
      anchor: 'ctr',
      prompt: 'Click to edit Master title style',
    }),
    placeholder({
      id: 3,
      name: 'Text Placeholder',
      type: 'body',
      index: 1,
      box: BODY_BOX,
      prompt: 'Click to edit Master text styles',
    }),
    footerPlaceholders(4),
  ].join('')

  return xml(
    `<p:sldMaster ${P_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${treeHead()}${shapes}</p:spTree></p:cSld>${COLOR_MAP}<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>${textStyles()}</p:sldMaster>`,
  )
}

interface LayoutSpec {
  /** `p:sldLayout type`, which is how PowerPoint labels it in the gallery. */
  type: string
  name: string
  shapes: string
}

/**
 * The layouts a new deck offers.
 *
 * Six rather than PowerPoint's eleven: these are the ones a deck actually uses,
 * and the remaining five (vertical text, content with caption, picture with
 * caption) are each a different answer to a question nobody asks of a blank
 * deck. Adding one later is adding a part and an entry, not a migration.
 */
function layoutSpecs(): LayoutSpec[] {
  const half = (SLIDE_WIDTH - MARGIN * 2 - EMU_PER_INCH * 0.25) / 2

  return [
    {
      type: 'title',
      name: 'Title Slide',
      shapes: [
        placeholder({
          id: 2,
          name: 'Title',
          type: 'ctrTitle',
          box: {
            x: MARGIN,
            y: SLIDE_HEIGHT * 0.3,
            width: SLIDE_WIDTH - MARGIN * 2,
            height: EMU_PER_INCH * 1.6,
          },
          anchor: 'b',
          prompt: 'Click to edit Master title style',
        }),
        placeholder({
          id: 3,
          name: 'Subtitle',
          type: 'subTitle',
          index: 1,
          box: {
            x: MARGIN,
            y: SLIDE_HEIGHT * 0.3 + EMU_PER_INCH * 1.8,
            width: SLIDE_WIDTH - MARGIN * 2,
            height: EMU_PER_INCH,
          },
          prompt: 'Click to edit Master subtitle style',
        }),
      ].join(''),
    },
    {
      type: 'obj',
      name: 'Title and Content',
      shapes: [
        placeholder({
          id: 2,
          name: 'Title',
          type: 'title',
          box: TITLE_BOX,
          anchor: 'ctr',
          prompt: 'Click to edit Master title style',
        }),
        placeholder({
          id: 3,
          name: 'Content Placeholder',
          index: 1,
          box: BODY_BOX,
          prompt: 'Click to edit Master text styles',
        }),
      ].join(''),
    },
    {
      type: 'secHead',
      name: 'Section Header',
      shapes: [
        placeholder({
          id: 2,
          name: 'Title',
          type: 'title',
          box: {
            x: MARGIN,
            y: SLIDE_HEIGHT * 0.35,
            width: SLIDE_WIDTH - MARGIN * 2,
            height: EMU_PER_INCH * 1.4,
          },
          anchor: 'b',
          prompt: 'Click to edit Master title style',
        }),
        placeholder({
          id: 3,
          name: 'Text Placeholder',
          type: 'body',
          index: 1,
          box: {
            x: MARGIN,
            y: SLIDE_HEIGHT * 0.35 + EMU_PER_INCH * 1.5,
            width: SLIDE_WIDTH - MARGIN * 2,
            height: EMU_PER_INCH,
          },
          prompt: 'Click to edit Master text styles',
        }),
      ].join(''),
    },
    {
      type: 'twoObj',
      name: 'Two Content',
      shapes: [
        placeholder({
          id: 2,
          name: 'Title',
          type: 'title',
          box: TITLE_BOX,
          anchor: 'ctr',
          prompt: 'Click to edit Master title style',
        }),
        placeholder({
          id: 3,
          name: 'Content Placeholder',
          index: 1,
          box: { ...BODY_BOX, width: half },
          prompt: 'Click to edit Master text styles',
        }),
        placeholder({
          id: 4,
          name: 'Content Placeholder',
          index: 2,
          box: { ...BODY_BOX, x: MARGIN + half + EMU_PER_INCH * 0.25, width: half },
          prompt: 'Click to edit Master text styles',
        }),
      ].join(''),
    },
    {
      type: 'titleOnly',
      name: 'Title Only',
      shapes: placeholder({
        id: 2,
        name: 'Title',
        type: 'title',
        box: TITLE_BOX,
        anchor: 'ctr',
        prompt: 'Click to edit Master title style',
      }),
    },
    { type: 'blank', name: 'Blank', shapes: '' },
  ]
}

function slideLayout(spec: LayoutSpec): string {
  return xml(
    `<p:sldLayout ${P_NS} type="${spec.type}" preserve="1"><p:cSld name="${spec.name}"><p:spTree>${treeHead()}${spec.shapes}${footerPlaceholders(20)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  )
}

/**
 * The theme, as the gallery's first entry.
 *
 * Built by writing a bare theme and then applying a gallery entry to it, rather
 * than by spelling the colours out again here: the gallery is where a theme is
 * described, and a second description of the same theme is one that drifts.
 */
function baseTheme(): string {
  // `a:fmtScheme` is required and is the recipes for fills, lines and effects.
  // Kept deliberately plain — a solid fill, a solid line, no shadow — because a
  // new deck should look like what was drawn on it.
  const fillStyles =
    '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'

  const lineStyles =
    '<a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="28575" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>'

  const effectStyles =
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'

  const bgStyles =
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'

  const scheme = [
    'dk1',
    'lt1',
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ]
    .map((slot) =>
      slot === 'dk1' || slot === 'lt1'
        ? `<a:${slot}><a:sysClr val="${slot === 'dk1' ? 'windowText' : 'window'}" lastClr="${slot === 'dk1' ? '000000' : 'FFFFFF'}"/></a:${slot}>`
        : `<a:${slot}><a:srgbClr val="000000"/></a:${slot}>`,
    )
    .join('')

  return xml(
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office">${scheme}</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office">${fillStyles}${lineStyles}${effectStyles}${bgStyles}</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`,
  )
}

function presentation(): string {
  return xml(
    `<p:presentation ${P_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst/><p:sldSz cx="${String(SLIDE_WIDTH)}" cy="${String(SLIDE_HEIGHT)}"/><p:notesSz cx="${String(NOTES_WIDTH)}" cy="${String(NOTES_HEIGHT)}"/></p:presentation>`,
  )
}

const OVERRIDES = {
  presentation:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  master: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  layout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
}

function contentTypes(layoutCount: number): string {
  const layouts = Array.from(
    { length: layoutCount },
    (_, index) =>
      `<Override PartName="/ppt/slideLayouts/slideLayout${String(index + 1)}.xml" ContentType="${OVERRIDES.layout}"/>`,
  ).join('')

  return xml(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="${OVERRIDES.presentation}"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${OVERRIDES.master}"/>${layouts}<Override PartName="/ppt/theme/theme1.xml" ContentType="${OVERRIDES.theme}"/></Types>`,
  )
}

/** Every part of a blank deck except the one slide, which `addSlide` writes. */
function blankDeckParts(): Record<string, string> {
  const layouts = layoutSpecs()

  const parts: Record<string, string> = {
    '[Content_Types].xml': contentTypes(layouts.length),
    '_rels/.rels': relationships([
      { id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' },
    ]),
    'ppt/presentation.xml': presentation(),
    'ppt/_rels/presentation.xml.rels': relationships([
      { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
      { id: 'rId2', type: 'theme', target: 'theme/theme1.xml' },
    ]),
    'ppt/theme/theme1.xml': baseTheme(),
    'ppt/slideMasters/slideMaster1.xml': slideMaster(layouts.length),
    // The layouts come first so their relationship ids line up with the order
    // in `p:sldLayoutIdLst`; the theme takes the id after them, as PowerPoint
    // writes it.
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relationships([
      ...layouts.map((_, index) => ({
        id: `rId${String(index + 1)}`,
        type: 'slideLayout',
        target: `../slideLayouts/slideLayout${String(index + 1)}.xml`,
      })),
      {
        id: `rId${String(layouts.length + 1)}`,
        type: 'theme',
        target: '../theme/theme1.xml',
      },
    ]),
  }

  layouts.forEach((spec, index) => {
    const name = `slideLayout${String(index + 1)}.xml`
    parts[`ppt/slideLayouts/${name}`] = slideLayout(spec)
    parts[`ppt/slideLayouts/_rels/${name}.rels`] = relationships([
      { id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' },
    ])
  })

  return parts
}

/**
 * A new deck: a real package with one title slide on it.
 *
 * The slide is added through `addSlide` rather than written out beside the
 * layouts, so a new deck's first slide is made the same way as its second. A
 * slide built by hand here would be the one slide in the app nobody's tests
 * cover.
 */
export async function createDeck(themeName = THEME_GALLERY[0]?.name): Promise<Uint8Array> {
  const parts = blankDeckParts()

  const pkg: OoxmlPackage = { parts: new Map() }
  const encoder = new TextEncoder()
  for (const [path, text] of Object.entries(parts)) {
    pkg.parts.set(path, { path, text, bytes: encoder.encode(text), date: new Date() })
  }

  const theme = THEME_GALLERY.find((entry) => entry.name === themeName)
  if (theme !== undefined) {
    setThemeName(pkg, 'ppt/theme/theme1.xml', theme.name)
    setThemeColors(pkg, 'ppt/theme/theme1.xml', theme.colors)
    setThemeFonts(pkg, 'ppt/theme/theme1.xml', theme.fonts)
  }

  const deck = readDeck(pkg)
  const layout = [...deck.layouts.values()].find((part) => part.path.endsWith('slideLayout1.xml'))
  if (layout !== undefined) addSlide(pkg, deck, layout, -1)

  // Bytes rather than the package: what the caller does with a new deck is open
  // it, and opening is reading a `.pptx`. Handing over the package instead would
  // mean a new deck took a path into the editor that no other deck takes, and
  // the one path nothing else exercises is the one that breaks quietly.
  return writePackage(pkg)
}

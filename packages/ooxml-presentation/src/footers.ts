import { attribute, children, element, findChild, tagName, textNode } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { nextShapeId } from './arrange'
import { layoutOf, masterOf } from './deck'
import type { Deck, Slide, SlidePart } from './deck'
import { DEFAULT_DATE_FIELD, fieldValue, isDateField, slideNumberOf } from './fields'
import { flatten } from './shape-tree'
import type { Shape } from './shape-tree'

/**
 * The date, the footer and the slide number, as they sit on a slide.
 *
 * These three are placeholders like a title is, and that is the whole of it:
 * PowerPoint's "Header and Footer" dialog adds or removes three shapes on each
 * slide and writes what goes in them. The position, the size, the font and the
 * colour are never written — they come from the layout and the master, which is
 * why turning footers on across a deck built from six layouts puts each one
 * where its own layout says.
 *
 * Two of them hold a field rather than text, so the slide can answer a question
 * the file cannot: what number this slide is now, and what day it is today.
 */

export type FooterKind = 'dt' | 'ftr' | 'sldNum'

const NAMES: Readonly<Record<FooterKind, string>> = {
  dt: 'Date Placeholder',
  ftr: 'Footer Placeholder',
  sldNum: 'Slide Number Placeholder',
}

export interface FooterSettings {
  /** Whether the slide shows a date at all. */
  date: boolean
  /**
   * Null for the day it is shown on, a string for a date somebody typed.
   *
   * The difference is what is written: a field that updates, or a run of text
   * that stays what it says. A deck printed for a meeting on a fixed day wants
   * the second one, and there is no way to express it except as text.
   */
  fixedDate: string | null
  slideNumber: boolean
  footer: boolean
  footerText: string
}

export interface FooterOptions {
  /** What "today" is, given rather than read so a test is not a race. */
  now: Date
  locale?: string
  /**
   * Leave the title slides alone, which is the checkbox PowerPoint offers.
   *
   * A title slide is one built on a layout of type `title`, not the first slide
   * in the deck: a deck with a section break has several of them.
   */
  skipTitleSlide?: boolean
}

export const NO_FOOTERS: FooterSettings = {
  date: false,
  fixedDate: null,
  slideNumber: false,
  footer: false,
  footerText: '',
}

/** The placeholder of one of the three kinds on a part, or null. */
function placeholderOf(part: SlidePart, kind: FooterKind): Shape | null {
  return flatten(part.shapes).find((shape) => shape.placeholder?.type === kind) ?? null
}

/** The `a:fld` inside a shape's text, whichever paragraph it sits in. */
function fieldIn(shape: Shape): XmlNode | null {
  const body = shape.text
  if (body === null) return null

  for (const paragraph of children(body.node)) {
    for (const child of children(paragraph)) {
      if (tagName(child) === 'a:fld') return child
    }
  }
  return null
}

/** What a slide shows now, which is what the dialog opens on. */
export function readFooters(slide: Slide): FooterSettings {
  const date = placeholderOf(slide, 'dt')
  const footer = placeholderOf(slide, 'ftr')
  const dateField = date === null ? null : fieldIn(date)

  return {
    date: date !== null,
    // A date placeholder holding a field updates itself; one holding plain text
    // is a day somebody chose, and the text is that choice.
    fixedDate:
      date === null || (dateField !== null && isDateField(attribute(dateField, 'type') ?? null))
        ? null
        : date.text === null
          ? ''
          : textOfBody(date.text),
    slideNumber: placeholderOf(slide, 'sldNum') !== null,
    footer: footer !== null,
    footerText: footer?.text == null ? '' : textOfBody(footer.text),
  }
}

/** A field needs a GUID, and one already there is kept so re-applying is a no-op. */
function fieldIdFor(existing: XmlNode | null): string {
  const kept = existing === null ? null : attribute(existing, 'id')
  return kept ?? `{${crypto.randomUUID().toUpperCase()}}`
}

/** The shape the slide gets when it has none of this kind yet. */
function newPlaceholder(kind: FooterKind, index: number | null, id: number): XmlNode {
  return element('p:sp', {}, [
    element('p:nvSpPr', {}, [
      element('p:cNvPr', { id: String(id), name: `${NAMES[kind]} ${String(id)}` }),
      element('p:cNvSpPr', {}, [element('a:spLocks', { noGrp: '1' })]),
      element('p:nvPr', {}, [
        element('p:ph', {
          type: kind,
          sz: 'quarter',
          idx: index === null ? undefined : String(index),
        }),
      ]),
    ]),
    // Empty on purpose: where it sits and what it looks like belong to the
    // layout, and writing them here would cut the shape loose from it.
    element('p:spPr'),
    element('p:txBody', {}, [element('a:bodyPr'), element('a:lstStyle'), element('a:p')]),
  ])
}

/** Replaces the one paragraph these placeholders hold, keeping nothing else. */
function setParagraph(shape: XmlNode, runs: readonly XmlNode[]): void {
  const body = findChild(shape, 'p:txBody')
  if (body === undefined) return

  const kept = children(body).filter((child) => {
    const tag = tagName(child)
    return tag === 'a:bodyPr' || tag === 'a:lstStyle'
  })

  const nodes = children(body)
  nodes.length = 0
  nodes.push(...kept, element('a:p', {}, [...runs]))
}

const textRun = (text: string): XmlNode =>
  element('a:r', {}, [element('a:t', {}, [textNode(text)])])

const fieldRun = (id: string, type: string, cached: string): XmlNode =>
  element('a:fld', { id, type }, [element('a:t', {}, [textNode(cached)])])

/** Whether a slide is built on a title layout, which the dialog can exempt. */
function isTitleSlide(deck: Deck, slide: Slide): boolean {
  const layout = layoutOf(deck, slide)
  return layout !== null && attribute(layout.root, 'type') === 'title'
}

/**
 * Where the placeholder would go, as the layout or the master states it.
 *
 * Null means there is nowhere for it: a layout with no footer placeholder and a
 * master with none either gives the shape no geometry to inherit, and a shape
 * with no geometry is one nothing draws. Adding it anyway would write something
 * into the file that nobody could see and nobody could remove.
 */
function anchorFor(deck: Deck, slide: Slide, kind: FooterKind): { index: number | null } | null {
  const layout = layoutOf(deck, slide)
  const onLayout = layout === null ? null : placeholderOf(layout, kind)
  // The slide matches its layout on `idx`, so the layout's index is what the
  // slide has to state — and when the layout has nothing, stating an index
  // would be naming a placeholder that is not there.
  if (onLayout !== null) return { index: onLayout.placeholder?.index ?? null }

  const master = layout === null ? null : masterOf(deck, layout)
  return master === null || placeholderOf(master, kind) === null ? null : { index: null }
}

/** Takes a shape out of the tree it is in. */
function removeShape(part: SlidePart, shape: Shape): void {
  const nodes = children(part.tree)
  const at = nodes.indexOf(shape.node)
  if (at !== -1) nodes.splice(at, 1)
}

/** What goes inside one of the three, which is a field for two of them. */
function runsFor(
  kind: FooterKind,
  slide: Slide,
  deck: Deck,
  settings: FooterSettings,
  options: FooterOptions,
  existing: Shape | null,
): XmlNode[] {
  const context = {
    number: slideNumberOf(deck, slide),
    now: options.now,
    locale: options.locale,
  }

  switch (kind) {
    case 'ftr':
      return settings.footerText === '' ? [] : [textRun(settings.footerText)]
    case 'sldNum': {
      const id = fieldIdFor(existing === null ? null : fieldIn(existing))
      // The cached text is what another reader shows before it evaluates the
      // field; writing the number we would draw keeps the two in step.
      return [fieldRun(id, 'slidenum', fieldValue('slidenum', '', context))]
    }
    case 'dt': {
      if (settings.fixedDate !== null) {
        return settings.fixedDate === '' ? [] : [textRun(settings.fixedDate)]
      }

      const old = existing === null ? null : fieldIn(existing)
      const type =
        old === null ? DEFAULT_DATE_FIELD : (attribute(old, 'type') ?? DEFAULT_DATE_FIELD)
      // The format somebody already chose is kept: this dialog says whether the
      // date shows, not how it reads.
      const kept = isDateField(type) ? type : DEFAULT_DATE_FIELD
      return [fieldRun(fieldIdFor(old), kept, fieldValue(kept, '', context))]
    }
  }
}

/**
 * Puts the three placeholders on the given slides, or takes them off.
 *
 * Returns whether anything changed, which is what the store needs to decide
 * there is an undo step to record.
 */
export function applyFooters(
  deck: Deck,
  slides: readonly Slide[],
  settings: FooterSettings,
  options: FooterOptions,
): boolean {
  let changed = false

  for (const slide of slides) {
    const exempt = options.skipTitleSlide === true && isTitleSlide(deck, slide)
    // Counted here rather than asked for each time: the parsed shapes are what
    // `nextShapeId` reads, and they do not know about the one just pushed — so
    // three placeholders added at once would all be shape 7.
    let id = nextShapeId(slide)

    const wanted: Readonly<Record<FooterKind, boolean>> = {
      dt: settings.date && !exempt,
      ftr: settings.footer && !exempt,
      sldNum: settings.slideNumber && !exempt,
    }

    for (const kind of ['dt', 'ftr', 'sldNum'] as const) {
      const existing = placeholderOf(slide, kind)

      if (!wanted[kind]) {
        if (existing === null) continue
        removeShape(slide, existing)
        changed = true
        continue
      }

      const anchor = anchorFor(deck, slide, kind)
      if (anchor === null) continue

      let node = existing?.node ?? null
      if (node === null) {
        node = newPlaceholder(kind, anchor.index, id++)
        children(slide.tree).push(node)
      }

      const before = JSON.stringify(findChild(node, 'p:txBody'))
      setParagraph(node, runsFor(kind, slide, deck, settings, options, existing))
      if (existing === null || before !== JSON.stringify(findChild(node, 'p:txBody'))) {
        changed = true
      }
    }
  }

  return changed
}

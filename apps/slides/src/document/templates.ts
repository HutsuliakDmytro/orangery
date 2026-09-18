import {
  addSlide,
  createDeck,
  flatten,
  readDeck,
  readPptxPackage,
  saveDeck,
  setShapeText,
  setSlideLayout,
  slideName,
  writeSlidePart,
} from '@orangery/ooxml-presentation'
import type { Deck, Shape, SlidePart, TextLine } from '@orangery/ooxml-presentation'

/**
 * The decks a new presentation can start from.
 *
 * Content only. Every template is the same package underneath — the same
 * master, the same six layouts, one of the gallery's themes — so choosing one
 * never changes what the file is, only what is written on it. That is what
 * makes them cheap to add and impossible to get structurally wrong.
 *
 * Five besides the blank one, and each is a shape of argument rather than a
 * decoration: what a pitch has to answer, what a lecture runs through, what a
 * defence is asked. Someone who deletes every word still has the deck's bones.
 */

/** A layout by the name the master gives it. */
export type LayoutName =
  'Title Slide' | 'Title and Content' | 'Section Header' | 'Two Content' | 'Title Only' | 'Blank'

export interface TemplateSlide {
  layout: LayoutName
  title?: string
  /** What goes in the body placeholder; the second one on Two Content. */
  body?: readonly TextLine[]
  /** The right-hand body on Two Content. */
  second?: readonly TextLine[]
}

export interface DeckTemplate {
  id: string
  name: string
  /** One line, shown under the name where the template is offered. */
  description: string
  /** A theme from the gallery. */
  theme: string
  slides: readonly TemplateSlide[]
}

const lines = (...text: string[]): TextLine[] => text.map((one) => ({ text: one }))

export const DECK_TEMPLATES: readonly DeckTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'One title slide, and nothing else decided for you.',
    theme: 'Orangery',
    slides: [{ layout: 'Title Slide' }],
  },
  {
    id: 'pitch',
    name: 'Pitch',
    description: 'Problem, solution, market, ask.',
    theme: 'Orangery',
    slides: [
      { layout: 'Title Slide', title: 'Company', body: lines('One line on what you do') },
      {
        layout: 'Title and Content',
        title: 'The problem',
        body: lines('Who has it', 'How they deal with it today', 'What that costs them'),
      },
      {
        layout: 'Title and Content',
        title: 'The solution',
        body: lines('What you built', 'Why it is different', 'What it replaces'),
      },
      {
        layout: 'Two Content',
        title: 'Market',
        body: lines('Who buys', 'How many of them'),
        second: lines('What they pay now', 'What you would charge'),
      },
      {
        layout: 'Title and Content',
        title: 'Traction',
        body: lines('What has happened so far', 'Numbers, with dates on them'),
      },
      {
        layout: 'Title and Content',
        title: 'The ask',
        body: lines('How much', 'What it buys', 'What you will have proved by the end of it'),
      },
    ],
  },
  {
    id: 'lecture',
    name: 'Lecture',
    description: 'Outline, sections, summary — for teaching an hour.',
    theme: 'Paper',
    slides: [
      { layout: 'Title Slide', title: 'Subject', body: lines('Course, date') },
      {
        layout: 'Title and Content',
        title: 'Today',
        body: lines('First idea', 'Second idea', 'Third idea', 'What to read'),
      },
      { layout: 'Section Header', title: 'First idea', body: lines('Why it matters') },
      {
        layout: 'Title and Content',
        title: 'The idea',
        body: lines('Statement', 'Where it comes from', 'An example', 'A case it does not cover'),
      },
      { layout: 'Section Header', title: 'Second idea', body: lines('Why it matters') },
      {
        layout: 'Title and Content',
        title: 'The idea',
        body: lines('Statement', 'Where it comes from', 'An example'),
      },
      {
        layout: 'Title and Content',
        title: 'Summary',
        body: lines('What to remember', 'What to practise', 'What comes next week'),
      },
    ],
  },
  {
    id: 'report',
    name: 'Report',
    description: 'Findings first, method after — the order people read in.',
    theme: 'Paper',
    slides: [
      { layout: 'Title Slide', title: 'Report', body: lines('Period, author') },
      {
        layout: 'Title and Content',
        title: 'In short',
        body: lines('What happened', 'What it means', 'What we propose'),
      },
      {
        layout: 'Two Content',
        title: 'Numbers',
        body: lines('This period', 'Against plan'),
        second: lines('Against last period', 'What moved them'),
      },
      {
        layout: 'Title and Content',
        title: 'What we found',
        body: [
          { text: 'Finding' },
          { text: 'What it rests on', level: 1 },
          { text: 'Finding' },
          { text: 'What it rests on', level: 1 },
        ],
      },
      {
        layout: 'Title and Content',
        title: 'What we did',
        body: lines('Method', 'What it covers', 'What it does not'),
      },
      {
        layout: 'Title and Content',
        title: 'Next',
        body: lines('Decision needed', 'By when', 'By whom'),
      },
    ],
  },
  {
    id: 'defence',
    name: 'Thesis defence',
    description: 'Question, method, results, contribution.',
    theme: 'Paper',
    slides: [
      { layout: 'Title Slide', title: 'Thesis title', body: lines('Name, supervisor, date') },
      {
        layout: 'Title and Content',
        title: 'The question',
        body: lines('What is not known', 'Why it matters', 'What this work claims'),
      },
      {
        layout: 'Title and Content',
        title: 'What is already known',
        body: lines('The established account', 'Where it stops'),
      },
      {
        layout: 'Title and Content',
        title: 'Method',
        body: lines('What was done', 'On what data', 'How it was checked'),
      },
      {
        layout: 'Title and Content',
        title: 'Results',
        body: lines('What came out', 'How certain it is'),
      },
      {
        layout: 'Title and Content',
        title: 'Contribution',
        body: lines('What is new', 'What it does not settle', 'What to do next'),
      },
      { layout: 'Title Only', title: 'Questions' },
    ],
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'One piece of work per slide, context then result.',
    theme: 'Orangery',
    slides: [
      { layout: 'Title Slide', title: 'Name', body: lines('What you make') },
      {
        layout: 'Title and Content',
        title: 'Selected work',
        body: lines('Piece', 'Piece', 'Piece'),
      },
      {
        layout: 'Two Content',
        title: 'Piece',
        body: lines('What it was for', 'What was hard'),
        second: lines('What it became', 'What it changed'),
      },
      {
        layout: 'Two Content',
        title: 'Piece',
        body: lines('What it was for', 'What was hard'),
        second: lines('What it became', 'What it changed'),
      },
      { layout: 'Title Only', title: 'Thank you' },
    ],
  },
]

export function templateById(id: string): DeckTemplate {
  const template = DECK_TEMPLATES.find((entry) => entry.id === id)
  if (template === undefined) throw new Error(`unknown template: ${id}`)
  return template
}

/** The layout of that name, or the one every deck has if it is missing. */
function layoutNamed(deck: Deck, name: LayoutName): SlidePart | null {
  const layouts = [...deck.layouts.values()]
  return layouts.find((layout) => slideName(layout) === name) ?? layouts[0] ?? null
}

/** The placeholders a template writes into, in the order it names them. */
function bodies(shapes: readonly Shape[]): Shape[] {
  return flatten(shapes).filter((shape) => {
    const type = shape.placeholder?.type
    return type === 'body' || type === 'subTitle' || type === 'obj'
  })
}

function titleOf(shapes: readonly Shape[]): Shape | undefined {
  return flatten(shapes).find((shape) => {
    const type = shape.placeholder?.type
    return type === 'title' || type === 'ctrTitle'
  })
}

/**
 * Builds a template into a deck, as bytes.
 *
 * Every slide goes on through `addSlide`, the same call the Add Slide command
 * makes, so a template cannot produce a slide the app could not have produced
 * itself. The deck starts with the one slide `createDeck` puts there, which is
 * the template's first: a blank template is therefore no template at all, which
 * is exactly what it should be.
 */
export async function buildTemplate(template: DeckTemplate): Promise<Uint8Array> {
  const pkg = await readPptxPackage(await createDeck(template.theme))

  for (const [index, wanted] of template.slides.entries()) {
    const deck = readDeck(pkg)
    const layout = layoutNamed(deck, wanted.layout)
    if (layout === null) continue

    // The first slide is already there, from `createDeck`, on the title layout.
    // Every other one is added. The first is only pointed at a different layout
    // when it asks for one — which no template does today, and which costs a
    // line rather than a rule about what a template may start with.
    if (index > 0) {
      addSlide(pkg, deck, layout, index - 1)
      continue
    }

    const first = deck.slides[0]
    if (first !== undefined && first.layout !== layout.path) {
      setSlideLayout(pkg, first, layout)
    }
  }

  // Filled in a second pass, over the deck as it finally stands: adding a slide
  // re-reads the package, and shapes held from before that are shapes of a
  // parse nobody is looking at any more.
  const deck = readDeck(pkg)
  for (const [index, wanted] of template.slides.entries()) {
    const slide = deck.slides[index]
    if (slide === undefined) continue

    const title = titleOf(slide.shapes)
    if (wanted.title !== undefined && title !== undefined) {
      setShapeText(title, [{ text: wanted.title }])
    }

    const [first, second] = bodies(slide.shapes)
    if (wanted.body !== undefined && first !== undefined) setShapeText(first, wanted.body)
    if (wanted.second !== undefined && second !== undefined) setShapeText(second, wanted.second)

    writeSlidePart(pkg, slide)
  }

  return saveDeck(pkg)
}

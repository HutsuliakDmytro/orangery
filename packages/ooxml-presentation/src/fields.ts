import type { Deck, SlidePart } from './deck'

/**
 * The values a slide works out for itself.
 *
 * A field is an `a:fld` with a type and a cached result: the number on slide 4
 * is the string "4", put there by whatever last saved the file. Drawing the
 * cached string is what makes a deck show "7" on the third slide after someone
 * has reordered it — so the type decides the value, and the cache is only what
 * is left when the type is one nobody here understands.
 *
 * "Now" is given rather than read, because a function that reads the clock is a
 * function whose test is a race with midnight.
 */

export interface FieldContext {
  /** The number this slide shows, or null where there is no number to show. */
  number: number | null
  now: Date
  /** How the date is written; the system's own way when not given. */
  locale?: string
}

/**
 * What each `datetime` format asks for.
 *
 * PowerPoint names thirteen patterns, and the pattern is written out — `d MMMM
 * yyyy`. Asking `Intl` for the parts instead means a Ukrainian system writes
 * "18 вересня 2026 р." where an American one writes "September 18, 2026",
 * which is what someone reading it expects. The cost is that formats differing
 * only in the order of the same parts (3 and 4, say) come out the same: the
 * order is the locale's business, and there is no way to ask for one it does
 * not use.
 */
const DATE_FORMATS: Readonly<Record<string, Intl.DateTimeFormatOptions>> = {
  datetime: { year: 'numeric', month: 'numeric', day: 'numeric' },
  datetime1: { year: 'numeric', month: 'numeric', day: 'numeric' },
  datetime2: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
  datetime3: { year: 'numeric', month: 'long', day: 'numeric' },
  datetime4: { year: 'numeric', month: 'long', day: 'numeric' },
  datetime5: { year: '2-digit', month: 'short', day: 'numeric' },
  datetime6: { year: '2-digit', month: 'long' },
  datetime7: { year: '2-digit', month: 'short' },
  datetime8: {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  datetime9: {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  },
  datetime10: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  datetime11: { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
  datetime12: { hour: 'numeric', minute: '2-digit', hour12: true },
  datetime13: { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true },
}

/** The type of field to write for an automatic date, which is PowerPoint's own default. */
export const DEFAULT_DATE_FIELD = 'datetime1'

export function isDateField(type: string | null): boolean {
  return type !== null && type in DATE_FORMATS
}

/** What a field shows, falling back to the text the file cached for it. */
export function fieldValue(type: string | null, cached: string, context: FieldContext): string {
  if (type === null) return cached
  if (type === 'slidenum') {
    return context.number === null ? cached : String(context.number)
  }

  const options = DATE_FORMATS[type]
  if (options === undefined) return cached
  return new Intl.DateTimeFormat(context.locale, options).format(context.now)
}

/**
 * The number a slide shows.
 *
 * Its place in `p:sldIdLst` plus whatever the deck counts from — a deck that
 * continues another one starts at 12, and the third slide in it is slide 14.
 * Null for a layout or a master, which are shown here as slides and are not
 * slides: they have no place in that list, and `‹#›` is what they say instead.
 */
export function slideNumberOf(deck: Deck, part: SlidePart): number | null {
  const index = deck.slides.findIndex((slide) => slide.path === part.path)
  return index === -1 ? null : index + deck.firstSlideNum
}

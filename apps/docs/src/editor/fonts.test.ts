import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { BUNDLED_FONTS, SYSTEM_FONTS } from './fonts'

/**
 * What a font falls back to decides whether the document keeps its line breaks.
 *
 * Calibri fell back to Liberation Sans for a while, which is metric-compatible
 * with Arial — so a Calibri document opened on a machine without Office
 * reflowed. The substitute has to be the one with the same advance widths, and
 * it has to be a family that actually ships.
 */

const require = createRequire(import.meta.url)
const css = readFileSync(require.resolve('@orangery/fonts/fonts.css'), 'utf8')
const shipped = new Set([...css.matchAll(/font-family: '([^']+)'/gu)].map((match) => match[1]))

/** Families the browser can be relied on to have, so a stack may end there. */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive'])

const familiesIn = (stack: string) =>
  stack.split(',').map((part) => part.trim().replace(/^'|'$/gu, ''))

describe('the fonts that ship', () => {
  it('covers every bundled option in the picker', () => {
    for (const font of BUNDLED_FONTS) {
      expect(shipped, font.family).toContain(font.family)
    }
  })
})

describe('what a system font falls back to', () => {
  it('names its metric substitute in the stack, after itself', () => {
    for (const font of SYSTEM_FONTS) {
      if (font.substitute === null) continue

      // The first entry is the name in the document; what matters is what comes
      // after it on a machine that does not have it.
      const [, ...fallbacks] = familiesIn(font.stack)
      expect(fallbacks, font.family).toContain(font.substitute)
    }
  })

  it('only names a substitute the app actually ships', () => {
    for (const font of [...BUNDLED_FONTS, ...SYSTEM_FONTS]) {
      if (font.substitute === null) continue
      expect(shipped, `${font.family} → ${font.substitute}`).toContain(font.substitute)
    }
  })

  it('admits the families with no substitute rather than guessing one', () => {
    // Adding a system font without a metric twin should have to be a decision,
    // not something that slips in behind a similar-looking fallback.
    const without = SYSTEM_FONTS.filter((font) => font.substitute === null).map(
      (font) => font.family,
    )

    expect(without).toEqual(['Georgia', 'Verdana'])
  })

  it('ends in a generic family, so there is always something to render with', () => {
    for (const font of [...BUNDLED_FONTS, ...SYSTEM_FONTS]) {
      const families = familiesIn(font.stack)
      expect(GENERIC.has(families[families.length - 1] ?? ''), font.family).toBe(true)
    }
  })

  it('substitutes Calibri and Cambria with their metric twins', () => {
    const stackOf = (family: string) =>
      SYSTEM_FONTS.find((font) => font.family === family)?.stack ?? ''

    expect(familiesIn(stackOf('Calibri'))).toContain('Carlito')
    expect(familiesIn(stackOf('Cambria'))).toContain('Caladea')
  })
})

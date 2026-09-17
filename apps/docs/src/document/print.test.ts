import { describe, expect, it } from 'vitest'
import { DEFAULT_SECTION, withOrientation } from '../ooxml/section'
import { applyPageRule, PAGE_STYLE_ID, pageRule } from './print'

const LETTER = { ...DEFAULT_SECTION, margins: { ...DEFAULT_SECTION.margins } }

describe('pageRule', () => {
  it('writes the page size in points', () => {
    expect(pageRule(LETTER)).toContain('size: 612pt 792pt')
  })

  it('writes the margins in CSS order', () => {
    expect(pageRule(LETTER)).toContain('margin: 72pt 72pt 72pt 72pt')
  })

  it('folds the gutter into the left margin, as Word lays it out', () => {
    const gutter = { ...LETTER, margins: { ...LETTER.margins, gutter: 36 } }
    expect(pageRule(gutter)).toContain('margin: 72pt 72pt 72pt 108pt')
  })

  it('follows a landscape section', () => {
    expect(pageRule(withOrientation(LETTER, 'landscape'))).toContain('size: 792pt 612pt')
  })

  it('follows a custom page size', () => {
    const a4 = { ...LETTER, width: 595.28, height: 841.89 }
    expect(pageRule(a4)).toContain('size: 595.28pt 841.89pt')
  })
})

describe('applyPageRule', () => {
  it('installs a stylesheet the app owns', () => {
    applyPageRule(LETTER)
    const style = document.getElementById(PAGE_STYLE_ID)

    expect(style).toBeInstanceOf(HTMLStyleElement)
    expect(style?.textContent).toContain('size: 612pt 792pt')
  })

  it('replaces the rule rather than adding a second one', () => {
    applyPageRule(LETTER)
    applyPageRule(withOrientation(LETTER, 'landscape'))

    expect(document.querySelectorAll(`#${PAGE_STYLE_ID}`)).toHaveLength(1)
    expect(document.getElementById(PAGE_STYLE_ID)?.textContent).toContain('792pt 612pt')
  })
})

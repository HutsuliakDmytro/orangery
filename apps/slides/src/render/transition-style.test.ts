import { describe, expect, it } from 'vitest'
import type { CSSProperties } from 'react'
import type { Transition } from '@orangery/ooxml-presentation'
import { transitionStyles } from './transition-style'

/** A transition as CSS: which way it travels and which edge it starts from. */

const transition = (values: Partial<Transition>): Transition => ({
  kind: 'fade',
  duration: 500,
  direction: null,
  stated: 'fade',
  ...values,
})

/** A custom property is not part of React's style type, so it is read as one. */
const custom = (style: CSSProperties | null, name: string) =>
  (style as Record<string, unknown> | null)?.[name]

describe('a fade', () => {
  it('fades the arriving slide in over the one it replaces', () => {
    const styles = transitionStyles(transition({ kind: 'fade' }))

    expect(styles.arriving.animation).toContain('orangery-fade-in')
    expect(styles.leaving).toBeNull()
  })

  it('takes its length from the transition, in seconds', () => {
    expect(transitionStyles(transition({ duration: 1500 })).arriving.animation).toContain('1.5s')
  })
})

describe('a push', () => {
  it('brings the new slide from the edge the content travels away from', () => {
    // `dir="u"` moves the content up, so the next slide comes up from below.
    const styles = transitionStyles(transition({ kind: 'push', direction: 'u' }))

    expect(custom(styles.arriving, '--orangery-from-y')).toBe('100%')
    expect(custom(styles.arriving, '--orangery-from-x')).toBe('0')
  })

  it('sends the old slide the way the content travels', () => {
    const styles = transitionStyles(transition({ kind: 'push', direction: 'u' }))

    expect(styles.leaving).not.toBeNull()
    expect(custom(styles.leaving, '--orangery-to-y')).toBe('-100%')
  })

  it('goes sideways for a sideways push', () => {
    const styles = transitionStyles(transition({ kind: 'push', direction: 'r' }))

    expect(custom(styles.arriving, '--orangery-from-x')).toBe('-100%')
    expect(custom(styles.leaving, '--orangery-to-x')).toBe('100%')
  })

  it('moves both slides, which is what makes it a push', () => {
    const styles = transitionStyles(transition({ kind: 'push', direction: 'l' }))

    expect(styles.arriving.animation).toContain('orangery-slide-in')
    expect(styles.leaving?.animation).toContain('orangery-slide-out')
  })
})

describe('a wipe', () => {
  it('uncovers the new slide from the edge the wipe travels away from', () => {
    // A wipe to the right uncovers from the left, so the right starts hidden.
    const styles = transitionStyles(transition({ kind: 'wipe', direction: 'r' }))

    expect(custom(styles.arriving, '--orangery-clip')).toBe('inset(0 100% 0 0)')
  })

  it('goes the other way for the other direction', () => {
    expect(
      custom(
        transitionStyles(transition({ kind: 'wipe', direction: 'l' })).arriving,
        '--orangery-clip',
      ),
    ).toBe('inset(0 0 0 100%)')
  })

  it('leaves the old slide where it is, since it is uncovered from over it', () => {
    expect(transitionStyles(transition({ kind: 'wipe', direction: 'd' })).leaving).toBeNull()
  })
})

describe('a direction the file did not give', () => {
  it('picks one rather than standing still', () => {
    const styles = transitionStyles(transition({ kind: 'push', direction: null }))

    expect(custom(styles.arriving, '--orangery-from-x')).toBe('100%')
  })
})

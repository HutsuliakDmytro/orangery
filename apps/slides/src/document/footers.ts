import { applyFooters } from '@orangery/ooxml-presentation'
import type { FooterSettings } from '@orangery/ooxml-presentation'
import { useDeckStore } from '../store/deck-store'

/**
 * Turning the date, the footer and the slide number on across a deck.
 *
 * One place, because there are two ways in — the dialog's two buttons — and the
 * difference between them is which slides are handed over, not what is done to
 * them.
 */

export interface FooterScope {
  /** Every slide, or only the one showing. */
  scope: 'all' | 'current'
  /** PowerPoint's "Don't show on title slide", which only makes sense for all. */
  skipTitleSlide: boolean
}

export function applyFootersToDeck(settings: FooterSettings, options: FooterScope): void {
  const { current, editDeck } = useDeckStore.getState()

  editDeck((deck) => {
    const slides = options.scope === 'all' ? deck.slides : deck.slides.slice(current, current + 1)

    return applyFooters(deck, slides, settings, {
      // The system's own way of writing a date: the person reading it is the
      // person sitting in front of this machine.
      now: new Date(),
      skipTitleSlide: options.scope === 'all' && options.skipTitleSlide,
    })
  })
}

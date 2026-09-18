import { useEffect, useRef, useState } from 'react'
import { morphOrigins, readAnimations, readTransition } from '@orangery/ooxml-presentation'
import type { Hyperlink, Transition } from '@orangery/ooxml-presentation'
import { leaveFullScreen } from '../commands/definitions'
import { animationAt } from '../render/animation'
import { InkLayer } from './ink-layer'
import { transitionStyles } from '../render/transition-style'
import { SlideView } from '../render/slide-view'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'

/**
 * The slide show, over everything else.
 *
 * Nothing about a slide changes here: the same renderer draws it, at the size
 * of the screen instead of the size of the canvas. One way to draw a slide
 * means what the room sees cannot disagree with what was edited.
 *
 * The keys are handled here rather than through the command registry. A show is
 * a mode with its own keyboard — space advances, `B` blanks, a digit starts a
 * number — and those are not commands the rest of the app has any business
 * offering. Registry shortcuts would also collide: `b` is bold.
 */

/** Advancing is a click anywhere; going back needs a key or the right button. */
export function Show() {
  const open = useDeckStore((state) => state.open)
  const at = useShowStore((state) => state.at)
  const blank = useShowStore((state) => state.blank)
  const typed = useShowStore((state) => state.typed)
  const shown = useShowStore((state) => state.shown)
  const tool = useShowStore((state) => state.tool)

  // The window is given back when the show ends, wherever it ended from: a
  // presentation that leaves the screen filled is one nobody can get out of.
  useEffect(() => {
    if (at !== null) return
    void leaveFullScreen()
  }, [at])

  /**
   * The slide being left behind while the new one arrives.
   *
   * PowerPoint puts the transition on the slide being moved *to*: a deck where
   * slide 4 fades in fades whichever slide you came from, including the one
   * after it when you go back. The old index is kept rather than the old slide,
   * so a deck edited mid-show cannot leave a stale object on screen.
   *
   * Driven by a subscription rather than by watching `at` across renders: the
   * thing that starts a transition is the moment the slide changed, and a
   * subscription is handed exactly that.
   */
  const [leaving, setLeaving] = useState<{ index: number; transition: Transition } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const stop = useShowStore.subscribe((state, before) => {
      if (state.at === before.at) return
      if (timer.current !== null) clearTimeout(timer.current)

      const deck = useDeckStore.getState().open?.deck
      const slide = state.at === null ? undefined : deck?.slides[state.at]
      const transition = slide === undefined ? null : readTransition(slide)

      // A cut is not an animation, and neither is a transition of no length.
      if (
        before.at === null ||
        state.at === null ||
        transition === null ||
        transition.kind === 'none' ||
        transition.duration === 0
      ) {
        setLeaving(null)
        return
      }

      setLeaving({ index: before.at, transition })
      timer.current = setTimeout(() => {
        setLeaving(null)
      }, transition.duration)
    })

    return () => {
      stop()
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  useEffect(() => {
    if (at === null) return

    function onKeyDown(event: KeyboardEvent) {
      const show = useShowStore.getState()

      // A number is typed one digit at a time and taken on Enter, which is how
      // PowerPoint does it and the only way to reach slide 12 with ten keys.
      if (/^\d$/u.test(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        show.type(event.key)
        return
      }

      const handled = (): boolean => {
        switch (event.key) {
          case 'Enter':
            // Enter after digits goes to that slide; a number naming no slide
            // does nothing at all rather than quietly advancing, which would be
            // the worst answer to a mistyped jump. Enter on its own advances.
            if (show.typed === '') show.next()
            else show.jump()
            return true
          case ' ':
          case 'ArrowRight':
          case 'ArrowDown':
          case 'PageDown':
            show.next()
            return true
          case 'ArrowLeft':
          case 'ArrowUp':
          case 'PageUp':
          case 'Backspace':
            show.previous()
            return true
          case 'Home':
            show.go(0)
            return true
          case 'End':
            show.go(show.count - 1)
            return true
          case 'b':
          case 'B':
            show.setBlank(show.blank === 'black' ? null : 'black')
            return true
          case 'w':
          case 'W':
            show.setBlank(show.blank === 'white' ? null : 'white')
            return true
          case 'p':
          case 'P':
            // The letters PowerPoint uses, so a presenter's fingers already
            // know them. Pressing the same one again puts the pointer back.
            show.setTool(show.tool === 'pen' ? 'none' : 'pen')
            return true
          case 'i':
          case 'I':
            show.setTool(show.tool === 'highlighter' ? 'none' : 'highlighter')
            return true
          case 'l':
          case 'L':
            show.setTool(show.tool === 'laser' ? 'none' : 'laser')
            return true
          case 'e':
          case 'E':
            show.setTool(show.tool === 'eraser' ? 'none' : 'eraser')
            return true
          case 'a':
          case 'A':
            show.setTool('none')
            return true
          case 'Escape':
            // A tool first, the show second: Escape out of the pen is what a
            // presenter means far more often than Escape out of the talk.
            if (show.tool !== 'none') show.setTool('none')
            else show.end()
            return true
          default:
            return false
        }
      }

      if (!handled()) return

      // A show is a mode with its own keyboard, so a key it used does not go on
      // to mean whatever it means in the editor underneath.
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [at])

  if (open === null || at === null) return null

  const slide = open.deck.slides[at]
  if (slide === undefined) return null

  /**
   * Following a link, which is the one click in a show that is not "next".
   *
   * A URL goes to the browser rather than into this window: a presentation that
   * navigated away from itself would be a presentation that ended.
   */
  const follow = (link: Hyperlink) => {
    const show = useShowStore.getState()

    if (link.kind === 'slide') show.go(link.index)
    else if (link.kind === 'url') window.open(link.url, '_blank', 'noopener,noreferrer')
    else if (link.jump === 'next') show.next()
    else if (link.jump === 'previous') show.previous()
    else if (link.jump === 'first') show.go(0)
    else if (link.jump === 'last') show.go(show.count - 1)
    else show.end()
  }

  const previous = leaving === null ? undefined : open.deck.slides[leaving.index]
  const styles = leaving === null ? null : transitionStyles(leaving.transition)

  // Read here rather than held in the store: the store counts the presses, and
  // what a press means is a question about the slide.
  const animation = animationAt(readAnimations(slide), shown)

  /**
   * A morph, which is the one transition that is not about the slide.
   *
   * It is about the shapes on it, each going from where it was to where it is
   * while the rest of the slide stands still — so the slide being left is not
   * drawn underneath at all. Drawing both would be the shapes moving over a
   * copy of themselves.
   */
  const morph =
    leaving?.transition.kind === 'morph' && previous !== undefined
      ? { origins: morphOrigins(previous, slide), duration: leaving.transition.duration }
      : undefined

  return (
    <div
      role="presentation"
      aria-label="Slide show"
      data-testid="show"
      onPointerDown={(event) => {
        // A tool has the click; the ink layer takes it before this runs, and
        // this is the case where the press landed beside the slide.
        if (tool !== 'none') return

        // The right button goes back, which is what a presenter remote sends.
        if (event.button === 2) useShowStore.getState().previous()
        else useShowStore.getState().next()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
    >
      {blank === null ? (
        <>
          {/* The slide being left, underneath, for as long as it takes to go. */}
          {previous !== undefined && styles !== null && morph === undefined && (
            <div
              key={`leaving-${String(leaving?.index ?? 0)}`}
              data-testid="leaving"
              style={styles.leaving ?? undefined}
              className="absolute inset-0 flex items-center justify-center"
            >
              <SlideView
                deck={open.deck}
                slide={previous}
                themes={open.themes}
                package={open.package}
                className="max-h-full max-w-full"
                style={{ width: '100vw', maxHeight: '100vh' }}
              />
            </div>
          )}

          <div
            key={`arriving-${String(at)}`}
            data-testid="arriving"
            // A morph moves the shapes, not the slide: fading the whole thing
            // in over itself would undo the one thing it is for.
            style={morph === undefined ? styles?.arriving : undefined}
            className="absolute inset-0 flex items-center justify-center"
          >
            {/* The ink has to sit exactly over the slide and not over the
                letterboxing, so both are in one box of the slide's shape. */}
            <div
              className="relative max-h-full max-w-full"
              style={{
                width: '100vw',
                maxHeight: '100vh',
                aspectRatio: `${String(open.deck.slideSize.width)} / ${String(open.deck.slideSize.height)}`,
              }}
            >
              <SlideView
                deck={open.deck}
                slide={slide}
                themes={open.themes}
                package={open.package}
                playing
                animation={animation}
                morph={morph}
                onFollowLink={follow}
                // The slide keeps its shape, so one axis is filled and the
                // other is letterboxed; stretching it would show a different
                // slide from the one that was made.
                style={{ width: '100%' }}
              />
              <InkLayer size={open.deck.slideSize} />
            </div>
          </div>
        </>
      ) : (
        <div
          data-testid="blank"
          className={`h-full w-full ${blank === 'white' ? 'bg-white' : 'bg-black'}`}
        />
      )}

      {typed !== '' && (
        <p
          data-testid="typed"
          className="absolute bottom-6 right-6 rounded bg-white/10 px-3 py-1 text-2xl text-white"
        >
          {typed}
        </p>
      )}
    </div>
  )
}

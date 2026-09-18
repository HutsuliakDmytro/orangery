import { useState } from 'react'
import { PickerPopover } from '@orangery/ui-kit'
import { NO_FOOTERS, readFooters } from '@orangery/ooxml-presentation'
import { applyFootersToDeck } from '../document/footers'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * PowerPoint's Header and Footer, which is three switches and two buttons.
 *
 * It opens on what the slide showing already has, so the dialog is a picture of
 * the deck rather than a form that starts empty and quietly turns things off.
 *
 * Two buttons and not one: applying to every slide is what people almost always
 * want, and applying to this one is what makes a section divider without a page
 * number possible at all.
 */

export function HeaderFooterDialog() {
  const showing = useViewStore((state) => state.editingFooters)
  const setShowing = useViewStore((state) => state.setEditingFooters)
  const slide = useDeckStore(currentSlide)

  if (!showing) return null
  return (
    <Dialog
      // Remounted per opening, so the fields start from what the slide says
      // now rather than from what it said the first time this was opened.
      key={slide?.path ?? 'none'}
      settings={slide === null ? NO_FOOTERS : readFooters(slide)}
      onClose={() => {
        setShowing(false)
      }}
    />
  )
}

function Dialog({
  settings: initial,
  onClose,
}: {
  settings: ReturnType<typeof readFooters>
  onClose: () => void
}) {
  const [settings, setSettings] = useState(initial)
  const [skipTitleSlide, setSkipTitleSlide] = useState(false)

  const change = (patch: Partial<typeof settings>) => {
    setSettings({ ...settings, ...patch })
  }

  const apply = (scope: 'all' | 'current') => {
    applyFootersToDeck(settings, { scope, skipTitleSlide })
    onClose()
  }

  return (
    <PickerPopover title="Header and Footer" onClose={onClose}>
      <div className="w-72 space-y-3 text-xs text-text">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.date}
            onChange={(event) => {
              change({ date: event.target.checked })
            }}
          />
          Date and time
        </label>

        {settings.date && (
          <div className="ml-6 space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="date-kind"
                checked={settings.fixedDate === null}
                onChange={() => {
                  change({ fixedDate: null })
                }}
              />
              Update automatically
            </label>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="date-kind"
                checked={settings.fixedDate !== null}
                onChange={() => {
                  // Today's date as the starting point, because an empty box
                  // under a switch called "Fixed" is a question with no hint.
                  change({ fixedDate: new Date().toLocaleDateString() })
                }}
              />
              Fixed
            </label>

            {settings.fixedDate !== null && (
              <input
                type="text"
                aria-label="Fixed date"
                value={settings.fixedDate}
                onChange={(event) => {
                  change({ fixedDate: event.target.value })
                }}
                className="w-full rounded border border-border bg-transparent px-2 py-1 outline-none focus:border-accent"
              />
            )}
          </div>
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.slideNumber}
            onChange={(event) => {
              change({ slideNumber: event.target.checked })
            }}
          />
          Slide number
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.footer}
            onChange={(event) => {
              change({ footer: event.target.checked })
            }}
          />
          Footer
        </label>

        {settings.footer && (
          <input
            type="text"
            aria-label="Footer text"
            value={settings.footerText}
            onChange={(event) => {
              change({ footerText: event.target.value })
            }}
            className="ml-6 w-[calc(100%-1.5rem)] rounded border border-border bg-transparent px-2 py-1 outline-none focus:border-accent"
          />
        )}

        <label className="flex items-center gap-2 border-t border-border pt-3">
          <input
            type="checkbox"
            checked={skipTitleSlide}
            onChange={(event) => {
              setSkipTitleSlide(event.target.checked)
            }}
          />
          Don’t show on title slide
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              apply('current')
            }}
            className="rounded border border-border px-3 py-1 hover:border-accent"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              apply('all')
            }}
            className="rounded bg-accent px-3 py-1 text-black hover:bg-accent-hover"
          >
            Apply to All
          </button>
        </div>
      </div>
    </PickerPopover>
  )
}

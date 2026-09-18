import { PickerPopover } from '@orangery/ui-kit'
import { DECK_TEMPLATES } from '../document/templates'
import { newFromTemplate } from '../document/file-operations'
import { whenSafe } from '../document/unsaved'
import { useViewStore } from '../store/view-store'

/**
 * Choosing what a new deck starts as.
 *
 * Offered as a list of what each one is for rather than as thumbnails: the
 * templates differ in the shape of the argument, not in how they look, and a
 * picture of six slides with the same theme on them would say nothing at all.
 */
export function TemplatePicker() {
  const choosing = useViewStore((state) => state.choosingTemplate)
  const setChoosing = useViewStore((state) => state.setChoosingTemplate)

  if (!choosing) return null

  const close = () => {
    setChoosing(false)
  }

  return (
    <PickerPopover title="New Presentation" onClose={close}>
      <ul className="flex w-[min(420px,80vw)] flex-col gap-1">
        {DECK_TEMPLATES.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              onClick={() => {
                close()
                whenSafe(() => newFromTemplate(template.id))
              }}
              className="w-full rounded px-2 py-1.5 text-left"
            >
              <span className="block text-sm text-text">{template.name}</span>
              <span className="block text-xs text-muted">{template.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </PickerPopover>
  )
}

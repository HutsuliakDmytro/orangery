import { useEffect } from 'react'
import { allCommands, isCommandEnabled, runCommand } from '@orangery/ui-kit'
import { isMac } from '@orangery/platform'

/**
 * Keyboard shortcuts, read from the registry.
 *
 * Docs binds its shortcuts through a ProseMirror keymap, because a key pressed
 * inside an editor has to go through the editor. Slides has no editor yet, so
 * this listens on the window — and steps aside when something is being typed
 * into, so that Mod+A in a text field still selects the text rather than every
 * shape on the slide.
 */

/** Turns `Mod+Shift+z` into the pieces to compare an event against. */
function parse(shortcut: string): { key: string; mod: boolean; shift: boolean; alt: boolean } {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1] ?? ''

  return {
    key: key.toLowerCase(),
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  )
}

export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Escape is the way out of a text box, so it is heard even while typing.
      if (event.key !== 'Escape' && isTyping(event.target)) return

      const pressed = event.key.toLowerCase()
      const mod = isMac ? event.metaKey : event.ctrlKey

      for (const command of allCommands()) {
        if (command.shortcut === undefined) continue
        const wanted = parse(command.shortcut)

        if (wanted.key !== pressed) continue
        if (wanted.mod !== mod) continue
        if (wanted.shift !== event.shiftKey) continue
        if (wanted.alt !== event.altKey) continue

        // A disabled command swallows nothing — but it does not speak for the
        // others either. Two commands can share a key and mean different things
        // in different places: Escape leaves a text box when one is open and
        // steps out of a group when one is not, and whichever is disabled must
        // stand aside rather than answer for both.
        if (!isCommandEnabled(command, {})) continue

        event.preventDefault()
        runCommand(command.id, {})
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

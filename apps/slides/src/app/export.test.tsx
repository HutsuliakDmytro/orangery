import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCommand, runCommand } from '@orangery/ui-kit'
import { readPackage } from '@orangery/ooxml-core'
import { registerBuiltinCommands } from '../commands/definitions'
import { useDeckStore } from '../store/deck-store'

/**
 * Exporting slides as pictures.
 *
 * The dialogs and the write belong to the shell and are stood in for; so is the
 * rasteriser, which is the browser's and does not exist here. What is checked
 * is what reaches the disk: how many files, under what names, and what happens
 * when the drawing cannot be turned into pixels.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const written: { path: string; bytes: Uint8Array }[] = []
let chosenFile: string | null = '/out/Slide.svg'
let chosenDirectory: string | null = '/out'
let rasterFails = false

vi.mock('@orangery/platform', async (importActual) => ({
  ...(await importActual<object>()),
  isTauri: () => true,
}))

vi.mock('../document/file', async (importActual) => ({
  ...(await importActual<object>()),
  pickExportPath: () => Promise.resolve(chosenFile),
  pickDirectory: () => Promise.resolve(chosenDirectory),
  writeFileBytes: (path: string, bytes: Uint8Array) => {
    written.push({ path, bytes })
    return Promise.resolve()
  },
}))

vi.mock('../document/export-image', async (importActual) => ({
  ...(await importActual<object>()),
  // jsdom has no rasteriser, and whether a real one copes with the HTML inside
  // a `foreignObject` is a question about the engine, not about this code.
  rasterise: () => {
    if (rasterFails)
      return Promise.reject(new Error('this slide could not be turned into a picture'))
    return Promise.resolve(new Uint8Array([137, 80, 78, 71]))
  },
}))

async function openDeck(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

/** Runs an export and waits for the files to land. */
async function exporting(id: string, expected: number) {
  act(() => {
    runCommand(id, {})
  })

  for (let tries = 0; tries < 60 && written.length < expected; tries += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

beforeEach(() => {
  // Nothing renders the app here, and the app is what registers the commands.
  registerBuiltinCommands()

  written.length = 0
  chosenFile = '/out/Slide.svg'
  chosenDirectory = '/out'
  rasterFails = false
  useDeckStore.setState({
    open: null,
    current: -1,
    master: null,
    selection: [],
    slideSelection: [],
    editing: null,
    undoStack: [],
    redoStack: [],
    error: null,
    saved: true,
  })
})

describe('one slide', () => {
  it('is not offered without a deck', () => {
    for (const id of ['export.svg', 'export.png', 'export.png-all']) {
      expect(getCommand(id)?.isEnabled?.({})).toBe(false)
    }
  })

  it('writes the SVG of the slide being shown', async () => {
    await openDeck('many-slides')
    act(() => {
      useDeckStore.getState().select(3)
    })
    await exporting('export.svg', 1)

    const file = written[0]
    expect(file?.path).toBe('/out/Slide.svg')
    expect(new TextDecoder().decode(file?.bytes)).toContain('Slide 4')
  })

  it('writes a raster through the browser rather than the markup', async () => {
    await openDeck('shapes')
    await exporting('export.png', 1)

    // The stub gives back a PNG signature; the SVG text is not in it.
    expect([...(written[0]?.bytes ?? [])]).toEqual([137, 80, 78, 71])
  })

  it('writes nothing when the question is answered with nothing', async () => {
    chosenFile = null
    await openDeck('shapes')
    await exporting('export.svg', 1)

    expect(written).toEqual([])
  })

  it('says so rather than writing a blank picture', async () => {
    // A PNG that saved without complaint and shows nothing is worse than none.
    rasterFails = true
    await openDeck('shapes')
    await exporting('export.png', 1)

    expect(written).toEqual([])
    expect(useDeckStore.getState().error).toContain('could not be turned into a picture')
  })
})

describe('every slide', () => {
  it('writes one file per slide, numbered and padded', async () => {
    await openDeck('many-slides')
    await exporting('export.png-all', 8)

    expect(written.map((one) => one.path)).toEqual([
      '/out/many-slides-1.png',
      '/out/many-slides-2.png',
      '/out/many-slides-3.png',
      '/out/many-slides-4.png',
      '/out/many-slides-5.png',
      '/out/many-slides-6.png',
      '/out/many-slides-7.png',
      '/out/many-slides-8.png',
    ])
  })

  it('writes nothing when no directory is chosen', async () => {
    chosenDirectory = null
    await openDeck('many-slides')
    await exporting('export.png-all', 1)

    expect(written).toEqual([])
  })

  it('stops at the first slide it cannot draw, and says which', async () => {
    rasterFails = true
    await openDeck('many-slides')
    await exporting('export.jpeg-all', 1)

    expect(written).toEqual([])
    expect(useDeckStore.getState().error).not.toBeNull()
  })
})

describe('the deck’s own theme', () => {
  it('is not offered without a deck', () => {
    expect(getCommand('export.thmx')?.isEnabled?.({})).toBe(false)
  })

  it('writes a theme file under the name that was chosen', async () => {
    chosenFile = '/out/Ours.thmx'
    await openDeck('placeholders')
    await exporting('export.thmx', 1)

    expect(written).toHaveLength(1)
    expect(written[0]?.path).toBe('/out/Ours.thmx')
  })

  it('writes a package something else can open', async () => {
    chosenFile = '/out/Ours.thmx'
    await openDeck('placeholders')
    await exporting('export.thmx', 1)

    const bytes = written[0]?.bytes
    if (bytes === undefined) throw new Error('nothing was written')

    // A zip, with the theme and the master that gives it its shape.
    const theme = await readPackage(bytes)
    expect([...theme.parts.keys()]).toContain('theme/theme1.xml')
    expect([...theme.parts.keys()]).toContain('theme/slideMasters/slideMaster1.xml')
  })

  it('writes nothing when the dialog is cancelled', async () => {
    chosenFile = null
    await openDeck('placeholders')
    await exporting('export.thmx', 1)

    expect(written).toHaveLength(0)
  })
})

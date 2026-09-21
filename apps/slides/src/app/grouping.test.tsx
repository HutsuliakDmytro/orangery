import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { flatten } from '@orangery/ooxml-presentation'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * A group is one thing until you go into it.
 *
 * Before this, clicking any member of a group selected that member and moving
 * it took it out of the picture the group made. These are the cases a person
 * meets in the first minute of grouping anything.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

async function open(name: string) {
  const bytes = await readFile(join(FIXTURES, `${name}.pptx`))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), `/decks/${name}.pptx`)
  })
}

/** The deck's first group, and a shape inside it. */
function aGroup() {
  const slide = useDeckStore.getState().open?.deck.slides[0]
  const group = flatten(slide?.shapes ?? []).find((shape) => shape.kind === 'grpSp')
  const member = group?.shapes[0]
  if (group === undefined || member === undefined) throw new Error('fixture has no group')
  return { group, member }
}

/** Clicks a shape on the canvas by the name its hit target carries. */
function clickShape(name: string, detail = 1) {
  const canvas = within(screen.getByTestId('canvas'))
  const target = canvas.getAllByRole('button', { name })[0]
  if (target === undefined) throw new Error(`no shape called ${name}`)

  fireEvent.pointerDown(target, { detail })
  if (detail === 2) fireEvent.dblClick(target)
}

beforeEach(async () => {
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })
  await open('groups-and-connectors')
})

describe('clicking something in a group', () => {
  it('selects the group, not the thing clicked', () => {
    const { group, member } = aGroup()
    render(<App />)

    clickShape(member.name === '' ? 'Shape' : member.name)

    expect(useDeckStore.getState().selection).toEqual([group.id])
  })

  it('draws one frame, around the group', () => {
    const { group } = aGroup()
    render(<App />)
    act(() => {
      useDeckStore.getState().selectShapes([group.id])
    })

    // The group is not drawn, so a frame around it can only come from knowing
    // where the group is rather than from any shape.
    expect(screen.getAllByTestId('selection-frame')).toHaveLength(1)
  })
})

describe('going into a group', () => {
  it('takes a double click, and then picks out the member', () => {
    const { member } = aGroup()
    render(<App />)

    clickShape(member.name === '' ? 'Shape' : member.name, 2)

    expect(useDeckStore.getState().openGroup).not.toBeNull()
    expect(useDeckStore.getState().selection).toEqual([member.id])
  })

  it('lets the next click pick a member rather than the group', () => {
    const { member } = aGroup()
    render(<App />)
    const name = member.name === '' ? 'Shape' : member.name

    clickShape(name, 2)
    clickShape(name)

    expect(useDeckStore.getState().selection).toEqual([member.id])
  })
})

describe('coming back out', () => {
  it('steps out on Escape and leaves the group selected', () => {
    const { group, member } = aGroup()
    render(<App />)
    clickShape(member.name === '' ? 'Shape' : member.name, 2)

    act(() => {
      runCommand('edit.leave-group', {})
    })

    expect(useDeckStore.getState().openGroup).toBeNull()
    expect(useDeckStore.getState().selection).toEqual([group.id])
  })

  it('is offered only while inside one', () => {
    render(<App />)
    expect(useDeckStore.getState().openGroup).toBeNull()

    const { member } = aGroup()
    clickShape(member.name === '' ? 'Shape' : member.name, 2)
    act(() => {
      runCommand('edit.leave-group', {})
    })
    act(() => {
      runCommand('edit.leave-group', {})
    })

    // The second one has nothing to do rather than stepping somewhere odd.
    expect(useDeckStore.getState().openGroup).toBeNull()
  })

  it('leaves the group when a click lands outside it', () => {
    const { member } = aGroup()
    render(<App />)
    clickShape(member.name === '' ? 'Shape' : member.name, 2)

    const canvas = within(screen.getByTestId('canvas'))
    fireEvent.pointerDown(canvas.getByTestId('slide-background'))

    expect(useDeckStore.getState().openGroup).toBeNull()
    expect(useDeckStore.getState().selection).toEqual([])
  })
})

describe('leaving the slide', () => {
  it('forgets the group, whose id means something else elsewhere', () => {
    const { member } = aGroup()
    render(<App />)
    clickShape(member.name === '' ? 'Shape' : member.name, 2)
    expect(useDeckStore.getState().openGroup).not.toBeNull()

    act(() => {
      useDeckStore.getState().select(1)
    })

    expect(useDeckStore.getState().openGroup).toBeNull()
  })
})

describe('Escape, which two commands answer to', () => {
  it('leaves the text box while one is open, and the group only after', () => {
    const { group, member } = aGroup()
    render(<App />)

    // Into the group, then into the member's words.
    clickShape(member.name === '' ? 'Shape' : member.name, 2)
    act(() => {
      useDeckStore.getState().setEditing(member.id)
    })

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useDeckStore.getState().editing).toBeNull()
    // Still inside the group: one keystroke, one step.
    expect(useDeckStore.getState().openGroup).not.toBeNull()

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useDeckStore.getState().openGroup).toBeNull()
    expect(useDeckStore.getState().selection).toEqual([group.id])
  })
})

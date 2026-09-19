import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '@orangery/ui-kit'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { flatten, saveDeck } from '@orangery/ooxml-presentation'
import { allSeries, readChart } from '@orangery/charts'
import { openSheet, readCell } from '@orangery/ooxml-spreadsheet'
import { App } from './app'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Putting a new chart on a slide.
 *
 * A chart is four things at once — a part, a workbook, two relationships and a
 * frame — so every test here asks about more than one of them. Three out of
 * four is a deck PowerPoint offers to repair, and nothing on screen would say
 * so.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const packageNow = (): OoxmlPackage => useDeckStore.getState().open?.package ?? { parts: new Map() }

const chartPart = () => getPartText(packageNow(), 'ppt/charts/chart1.xml') ?? ''

/** The graphic frames on the first slide, chart or otherwise. */
const frames = () =>
  flatten(useDeckStore.getState().open?.deck.slides[0]?.shapes ?? []).filter(
    (shape) => shape.kind === 'graphicFrame',
  )

const insert = async (kind: string) => {
  await act(async () => {
    runCommand(`insert.chart.${kind}`, {})
    // The workbook beside the chart is a zip, so the insertion is asynchronous.
    await Promise.resolve()
  })
}

beforeEach(async () => {
  useDeckStore.getState().close()
  useViewStore.setState({ panels: { filmstrip: true, properties: true, notes: true } })

  const bytes = await readFile(join(FIXTURES, 'shapes.pptx'))
  await act(async () => {
    await useDeckStore.getState().load(new Uint8Array(bytes), '/decks/shapes.pptx')
  })
})

describe('inserting a chart', () => {
  it('puts a chart of the kind that was asked for on the slide', async () => {
    render(<App />)
    await insert('pie')

    await waitFor(() => {
      expect(readChart(chartPart())?.plots[0]?.kind).toBe('pie')
    })
  })

  it('gives it numbers, so a new chart shows something', async () => {
    render(<App />)
    await insert('bar')

    await waitFor(() => {
      expect(allSeries(readChart(chartPart()) ?? ({ plots: [] } as never))[0]?.values).toEqual([
        4.3, 2.5, 3.5, 4.5,
      ])
    })
  })

  it('writes the workbook Edit Data opens, with the same numbers in it', async () => {
    render(<App />)
    await insert('bar')

    await waitFor(() => {
      expect(packageNow().parts.has('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')).toBe(true)
    })

    const bytes = packageNow().parts.get('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes
    const workbook = await readPackage(bytes ?? new Uint8Array())
    const sheet = openSheet(workbook, 'xl/worksheets/sheet1.xml')
    if (sheet === null) throw new Error('the embedded workbook has no sheet')

    expect(readCell(sheet, 'B2', [])).toBe(4.3)
    expect(readCell(sheet, 'A2', [])).toBe('Category 1')
  })

  it('relates the slide to the chart and the chart to its workbook', async () => {
    render(<App />)
    await insert('line')

    await waitFor(() => {
      expect(getPartText(packageNow(), 'ppt/charts/_rels/chart1.xml.rels')).toContain(
        '../embeddings/Microsoft_Excel_Sheet1.xlsx',
      )
    })

    const slideRels = getPartText(packageNow(), 'ppt/slides/_rels/slide1.xml.rels') ?? ''
    expect(slideRels).toContain('../charts/chart1.xml')
  })

  it('declares the new parts, or PowerPoint repairs the file', async () => {
    render(<App />)
    await insert('area')

    await waitFor(() => {
      const types = getPartText(packageNow(), '[Content_Types].xml') ?? ''
      expect(types).toContain('/ppt/charts/chart1.xml')
      expect(types).toContain('Extension="xlsx"')
    })
  })

  it('puts a frame on the slide and selects it', async () => {
    render(<App />)
    const before = frames().length

    await insert('bar')

    await waitFor(() => {
      expect(frames()).toHaveLength(before + 1)
    })
    expect(useDeckStore.getState().selection).toHaveLength(1)
  })

  it('shows the chart, rather than a labelled box', async () => {
    render(<App />)
    await insert('bar')

    await waitFor(() => {
      expect(screen.getAllByRole('img', { name: 'Chart' }).length).toBeGreaterThan(0)
    })
  })

  it('is one step to undo, parts and all', async () => {
    render(<App />)
    await insert('bar')
    await waitFor(() => {
      expect(frames()).toHaveLength(1)
    })

    act(() => {
      useDeckStore.getState().undo()
    })

    expect(frames()).toHaveLength(0)
  })

  it('numbers a second chart apart from the first', async () => {
    render(<App />)
    await insert('bar')
    await waitFor(() => {
      expect(packageNow().parts.has('ppt/charts/chart1.xml')).toBe(true)
    })

    await insert('pie')

    await waitFor(() => {
      expect(packageNow().parts.has('ppt/charts/chart2.xml')).toBe(true)
    })
    expect(packageNow().parts.has('ppt/embeddings/Microsoft_Excel_Sheet2.xlsx')).toBe(true)
  })

  it('survives a save and a reopen', async () => {
    render(<App />)
    await insert('bar')
    await waitFor(() => {
      expect(packageNow().parts.has('ppt/charts/chart1.xml')).toBe(true)
    })

    const saved = await saveDeck(packageNow())
    const reopened = await readPackage(saved)

    expect(readChart(getPartText(reopened, 'ppt/charts/chart1.xml') ?? '')?.plots[0]?.kind).toBe(
      'bar',
    )
    expect(reopened.parts.has('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')).toBe(true)
  })
})

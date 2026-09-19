import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareXml, getPartText, isTextPart, readPackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { readPptxPackage, saveDeck } from '@orangery/ooxml-presentation'
import { patchedWorkbook, writeChartCache } from '@orangery/charts'

/**
 * A deck with charts in it, saved.
 *
 * The guarantee is the one the round-trip ADRs state: open a file, save it
 * without editing, and PowerPoint is given back what it gave us. A chart makes
 * that harder than a shape does — it is a part, a workbook and two
 * relationships — so it is worth asking about the whole package rather than
 * about the chart alone.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')
const CHART = 'ppt/charts/chart1.xml'
const WORKBOOK = 'ppt/embeddings/Microsoft_Excel_Sheet1.xlsx'

const load = async () => readPptxPackage(await readFile(join(FIXTURES, 'charts.pptx')))

/** The parts that are not the same in both packages, by path. */
function changedParts(before: OoxmlPackage, after: OoxmlPackage): string[] {
  const paths = new Set([...before.parts.keys(), ...after.parts.keys()])

  return [...paths].filter((path) => {
    const left = before.parts.get(path)
    const right = after.parts.get(path)
    if (left === undefined || right === undefined) return true

    // XML is compared as a tree: attribute order and self-closing tags are a
    // writer's business, not a difference anybody sees.
    if (isTextPart(path)) {
      return compareXml(getPartText(before, path) ?? '', getPartText(after, path) ?? '').length > 0
    }

    return (
      left.bytes.length !== right.bytes.length ||
      left.bytes.some((byte, index) => byte !== right.bytes[index])
    )
  })
}

describe('a deck saved without edits', () => {
  it('gives back every part it was given', async () => {
    const before = await load()
    const after = await readPackage(await saveDeck(before))

    expect(changedParts(before, after)).toEqual([])
  })

  it('keeps the chart part byte for byte, unmodelled markup and all', async () => {
    const before = await load()
    const after = await readPackage(await saveDeck(before))

    expect(getPartText(after, CHART)).toBe(getPartText(before, CHART))
  })

  it('keeps the workbook the chart embeds', async () => {
    const before = await load()
    const after = await readPackage(await saveDeck(before))

    expect(after.parts.get(WORKBOOK)?.bytes).toEqual(before.parts.get(WORKBOOK)?.bytes)
  })
})

describe('a deck saved after one number changed', () => {
  /** Changes one point, in both places a chart keeps its numbers. */
  const changeOne = async (pkg: OoxmlPackage) => {
    const change = { series: 0, values: [10.5, 99, 9.8, 18.1] }
    const workbook = await patchedWorkbook(pkg, CHART, change)

    expect(writeChartCache(pkg, CHART, change)).toBe(true)
    if (workbook !== null) {
      pkg.parts.set(workbook.path, {
        path: workbook.path,
        bytes: workbook.bytes,
        date: new Date(),
      })
    }
  }

  it('changes the chart and its workbook, and nothing else in the deck', async () => {
    const before = await load()
    const edited = await load()
    await changeOne(edited)

    const after = await readPackage(await saveDeck(edited))

    expect(changedParts(before, after).sort()).toEqual([CHART, WORKBOOK])
  })

  it('changes one cached value inside the chart part', async () => {
    const before = await load()
    const edited = await load()
    await changeOne(edited)

    const changed = compareXml(getPartText(before, CHART) ?? '', getPartText(edited, CHART) ?? '')

    expect(changed).toHaveLength(1)
    expect(changed[0]?.path).toContain('c:numCache')
  })

  it('changes the same cell in the workbook, which is the other half', async () => {
    // PowerPoint rebuilds the cache from the workbook the moment anybody opens
    // the data, so a chart edited in only one of them loses the edit.
    const edited = await load()
    await changeOne(edited)

    const workbook = await readPackage(edited.parts.get(WORKBOOK)?.bytes ?? new Uint8Array())
    expect(getPartText(workbook, 'xl/worksheets/sheet1.xml')).toContain('99')
  })
})

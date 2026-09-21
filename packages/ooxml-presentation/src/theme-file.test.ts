import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseRelationships, readPackage, writePackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { buildThemeFile } from './theme-file'

/**
 * A deck's look, written out as a theme file.
 *
 * Checked through a save and a reopen, because the point of the file is that
 * something else reads it: a package that only holds together in memory is not
 * a file anybody can use.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

/** Builds the theme file of a fixture's first master and reads it back. */
async function themeOf(name: string): Promise<OoxmlPackage> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const master = [...deck.masters.values()][0]
  if (master === undefined) throw new Error('fixture has no master')

  const built = buildThemeFile(pkg, deck, master)
  if (built === null) throw new Error('nothing was built')

  return readPackage(await writePackage(built))
}

const relsOf = (pkg: OoxmlPackage, path: string) => [
  ...parseRelationships(getPartText(pkg, path) ?? '').values(),
]

describe('what a theme file holds', () => {
  it('carries the theme, the master and its layouts', async () => {
    const theme = await themeOf('placeholders')
    const paths = [...theme.parts.keys()]

    // The master is the reason a theme is more than a palette: where the title
    // sits and what a bullet looks like are not in `a:theme` at all.
    expect(paths).toContain('theme/theme1.xml')
    expect(paths).toContain('theme/slideMasters/slideMaster1.xml')
    expect(paths.filter((path) => /^theme\/slideLayouts\/[^/]+\.xml$/u.test(path))).toHaveLength(11)
  })

  it('copies the parts rather than rebuilding them', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'placeholders.pptx')))
    const deck = readDeck(pkg)
    const master = [...deck.masters.values()][0]
    if (master?.theme == null) throw new Error('fixture has no theme')

    const built = buildThemeFile(pkg, deck, master)

    // Byte for byte: a theme rebuilt from a reading of itself is a theme
    // missing whatever the reading does not model.
    expect(getPartText(built ?? { parts: new Map() }, 'theme/theme1.xml')).toBe(
      getPartText(pkg, master.theme),
    )
  })

  it('is rooted at the theme manager, as a deck is at its presentation', async () => {
    const theme = await themeOf('placeholders')
    const root = relsOf(theme, '_rels/.rels')

    expect(root).toHaveLength(1)
    expect(root[0]?.target).toBe('theme/themeManager.xml')
    expect(getPartText(theme, 'theme/themeManager.xml')).toContain('p:themeManager')
  })

  it('names every part it carries in the content types', async () => {
    const theme = await themeOf('placeholders')
    const types = getPartText(theme, '[Content_Types].xml') ?? ''

    expect(types).toContain('/theme/theme1.xml')
    expect(types).toContain('/theme/slideMasters/slideMaster1.xml')
    expect(types).toContain('presentationml.slideLayout+xml')
    expect(types).toContain('Extension="rels"')
  })
})

describe('the relationships between its parts', () => {
  it('keeps the ids the master names its layouts by', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'placeholders.pptx')))
    const deck = readDeck(pkg)
    const master = [...deck.masters.values()][0]
    if (master === undefined) throw new Error('fixture has no master')

    const built = buildThemeFile(pkg, deck, master)
    if (built === null) throw new Error('nothing was built')

    // `p:sldLayoutIdLst` names them by `r:id`, so keeping the ids is what lets
    // every part be copied without being edited.
    const before = new Set([
      ...parseRelationships(
        getPartText(pkg, 'ppt/slideMasters/_rels/slideMaster1.xml.rels') ?? '',
      ).keys(),
    ])
    const after = new Set([
      ...parseRelationships(
        getPartText(built, 'theme/slideMasters/_rels/slideMaster1.xml.rels') ?? '',
      ).keys(),
    ])

    for (const id of after) expect(before.has(id)).toBe(true)
    expect(after.size).toBe(before.size)
  })

  it('points the master at the theme beside it, not at the one it came from', async () => {
    const theme = await themeOf('placeholders')
    const targets = relsOf(theme, 'theme/slideMasters/_rels/slideMaster1.xml.rels').map(
      (one) => one.target,
    )

    expect(targets).toContain('../theme1.xml')
    expect(targets).toContain('../slideLayouts/slideLayout1.xml')
  })

  it('points each layout back at the master', async () => {
    const theme = await themeOf('placeholders')
    const targets = relsOf(theme, 'theme/slideLayouts/_rels/slideLayout1.xml.rels').map(
      (one) => one.target,
    )

    expect(targets).toContain('../slideMasters/slideMaster1.xml')
  })
})

describe('a master with nothing to give', () => {
  it('is not a theme file', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'empty.pptx')))
    const deck = readDeck(pkg)
    const master = [...deck.masters.values()][0]
    if (master === undefined) throw new Error('fixture has no master')

    // A theme file with no theme in it is not a smaller theme.
    expect(buildThemeFile(pkg, deck, { ...master, theme: null })).toBeNull()
  })
})

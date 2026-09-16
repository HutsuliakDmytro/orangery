import { describe, expect, it } from 'vitest'
import { addRecent, MAX_RECENT_FILES, parseRecentFiles, removeRecent } from './recent-files'
import type { RecentFile } from './recent-files'

function file(path: string): RecentFile {
  return { path, name: path.split('/').pop() ?? path, openedAt: '2026-01-01T00:00:00.000Z' }
}

describe('addRecent', () => {
  it('puts the newest file first', () => {
    const list = addRecent([file('/a.docx')], '/b.docx')
    expect(list.map((entry) => entry.path)).toEqual(['/b.docx', '/a.docx'])
  })

  it('moves a re-opened file to the top instead of duplicating it', () => {
    const list = addRecent([file('/a.docx'), file('/b.docx')], '/b.docx')
    expect(list.map((entry) => entry.path)).toEqual(['/b.docx', '/a.docx'])
  })

  it('derives the display name from the path', () => {
    expect(addRecent([], '/x/report.docx')[0]?.name).toBe('report.docx')
  })

  it('caps the list', () => {
    let list: RecentFile[] = []
    for (let index = 0; index < MAX_RECENT_FILES + 5; index += 1) {
      list = addRecent(list, `/file-${String(index)}.docx`)
    }
    expect(list).toHaveLength(MAX_RECENT_FILES)
  })

  it('drops the oldest entry when the cap is reached', () => {
    let list: RecentFile[] = []
    for (let index = 0; index < MAX_RECENT_FILES; index += 1) {
      list = addRecent(list, `/file-${String(index)}.docx`)
    }
    list = addRecent(list, '/newest.docx')
    expect(list.map((entry) => entry.path)).not.toContain('/file-0.docx')
  })
})

describe('removeRecent', () => {
  it('removes a file that no longer exists', () => {
    const list = removeRecent([file('/a.docx'), file('/b.docx')], '/a.docx')
    expect(list.map((entry) => entry.path)).toEqual(['/b.docx'])
  })

  it('leaves the list alone when the path is not in it', () => {
    expect(removeRecent([file('/a.docx')], '/z.docx')).toHaveLength(1)
  })
})

describe('parseRecentFiles', () => {
  it('reads a list it wrote', () => {
    const list = addRecent([], '/a.docx')
    expect(parseRecentFiles(JSON.stringify(list))).toEqual(list)
  })

  it('returns an empty list for malformed JSON', () => {
    expect(parseRecentFiles('nonsense')).toEqual([])
  })

  it('returns an empty list when the file is not an array', () => {
    expect(parseRecentFiles('{"a":1}')).toEqual([])
  })

  it('skips entries with no usable path', () => {
    const contents = JSON.stringify([{ name: 'x' }, { path: '' }, { path: '/ok.docx' }])
    expect(parseRecentFiles(contents).map((entry) => entry.path)).toEqual(['/ok.docx'])
  })

  it('fills in a missing name from the path', () => {
    expect(parseRecentFiles(JSON.stringify([{ path: '/x/report.docx' }]))[0]?.name).toBe(
      'report.docx',
    )
  })

  it('caps a list that grew too long on disk', () => {
    const contents = JSON.stringify(
      Array.from({ length: 50 }, (_, index) => ({ path: `/f${String(index)}.docx` })),
    )
    expect(parseRecentFiles(contents)).toHaveLength(MAX_RECENT_FILES)
  })
})

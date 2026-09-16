import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The directory a snapshot lives in.
 *
 * Every one of these guards the same defect: a snapshot written under one key
 * and looked for under another is never deleted, so the recovery banner grows
 * by one entry at every launch and no amount of discarding empties it.
 */

vi.mock('../platform/os', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/path', () => ({ join: (...parts: string[]) => parts.join('/') }))
vi.mock('../platform/paths', () => ({ autosaveDir: () => Promise.resolve('/data/autosave') }))

const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}))

const { buildSnapshot, clearSnapshot, listRecoverable, snapshotKey, writeSnapshot } = await import(
  './autosave'
)

const doc = { type: 'doc', content: [{ type: 'paragraph' }] }

beforeEach(() => {
  invoke.mockReset()
  // `document_key` hashes whatever it is given; the identity stands in for it.
  invoke.mockImplementation((command, args) => {
    if (command === 'document_key') return Promise.resolve(`key(${String(args?.['path'])})`)
    return Promise.resolve(null)
  })
})

describe('snapshotKey', () => {
  it('is the session, so the same document keeps one directory', async () => {
    expect(await snapshotKey('session-1')).toBe('key(session-1)')
  })

  it('does not change when the document is saved under a name', async () => {
    // Keying by path would write under the session and clear under the path,
    // leaving the snapshot on disk for ever.
    const before = await snapshotKey('session-1')
    const after = await snapshotKey('session-1')
    expect(after).toBe(before)
  })
})

describe('writing and clearing', () => {
  it('clears the directory it wrote to', async () => {
    const key = await snapshotKey('session-1')
    await writeSnapshot(key, buildSnapshot(null, doc))
    const written = invoke.mock.calls.find(([command]) => command === 'write_autosave')?.[1] as {
      directory: string
    }

    await clearSnapshot(key)
    const cleared = invoke.mock.calls.find(([command]) => command === 'clear_autosave')?.[1] as {
      directory: string
    }

    expect(cleared.directory).toBe(written.directory)
  })
})

describe('listRecoverable', () => {
  it('hands back the key each snapshot was found under', async () => {
    invoke.mockImplementation((command, args) => {
      if (command === 'list_autosaves') return Promise.resolve(['key-a', 'key-b'])
      if (command === 'read_autosave') {
        const directory = String(args?.['directory'])
        return Promise.resolve(
          directory.includes('key-') ? JSON.stringify(buildSnapshot(null, doc)) : null,
        )
      }
      return Promise.resolve(null)
    })

    const found = await listRecoverable()

    // Without the key there is nothing to delete: it is the id of a session
    // that has ended, and the snapshot does not record it.
    expect(found.map((entry) => entry.key)).toEqual(['key-a', 'key-b'])
    expect(found[0]?.snapshot.path).toBeNull()
  })

  it('skips a directory whose snapshot cannot be read', async () => {
    invoke.mockImplementation((command) => {
      if (command === 'list_autosaves') return Promise.resolve(['good', 'broken'])
      if (command === 'read_autosave') {
        return Promise.resolve(
          invoke.mock.calls.filter(([name]) => name === 'read_autosave').length === 1
            ? JSON.stringify(buildSnapshot(null, doc))
            : 'not json',
        )
      }
      return Promise.resolve(null)
    })

    expect(await listRecoverable()).toHaveLength(1)
  })
})

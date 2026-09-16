import { describe, expect, it } from 'vitest'
import { imageFilesFrom } from './image-drop'

/** A minimal stand-in: `FileList` cannot be constructed directly. */
function fileList(files: File[]): FileList {
  const list: Record<number, File> = {}
  files.forEach((file, index) => {
    list[index] = file
  })

  return {
    ...list,
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: () => files[Symbol.iterator](),
  }
}

const file = (name: string, type: string) => new File([new Uint8Array([1])], name, { type })

describe('imageFilesFrom', () => {
  it('keeps image files', () => {
    const list = fileList([file('a.png', 'image/png'), file('b.jpg', 'image/jpeg')])
    expect(imageFilesFrom(list).map((entry) => entry.name)).toEqual(['a.png', 'b.jpg'])
  })

  it('drops files that are not images', () => {
    const list = fileList([file('notes.txt', 'text/plain'), file('a.png', 'image/png')])
    expect(imageFilesFrom(list).map((entry) => entry.name)).toEqual(['a.png'])
  })

  it('returns nothing for an empty or absent list', () => {
    expect(imageFilesFrom(null)).toEqual([])
    expect(imageFilesFrom(undefined)).toEqual([])
    expect(imageFilesFrom(fileList([]))).toEqual([])
  })
})

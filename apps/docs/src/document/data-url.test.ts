import { describe, expect, it } from 'vitest'
import { dataUrlFrom, decodeDataUrl, extensionFor } from './data-url'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('decodeDataUrl', () => {
  it('reads the bytes and the extension', () => {
    const decoded = decodeDataUrl(PNG)
    expect(decoded?.extension).toBe('png')
    // The PNG signature, so the bytes really were decoded.
    expect([...(decoded?.bytes.slice(0, 4) ?? [])]).toEqual([137, 80, 78, 71])
  })

  it('names a JPEG the way Word does', () => {
    expect(decodeDataUrl('data:image/jpeg;base64,/9j/')?.extension).toBe('jpg')
    expect(decodeDataUrl('data:image/svg+xml;base64,PHN2Zy8+')?.extension).toBe('svg')
  })

  it('returns nothing for an address that is not a data URL', () => {
    expect(decodeDataUrl('https://example.com/a.png')).toBeNull()
    expect(decodeDataUrl('Pictures/a.png')).toBeNull()
  })

  it('returns nothing for a data URL whose payload is damaged', () => {
    expect(decodeDataUrl('data:image/png;base64,!!!!')).toBeNull()
  })
})

describe('dataUrlFrom', () => {
  it('builds a URL the webview can display', () => {
    expect(dataUrlFrom(new Uint8Array([137, 80, 78, 71]), 'a.png')).toBe(
      'data:image/png;base64,iVBORw==',
    )
  })

  it('returns nothing for a file type no document format can hold', () => {
    expect(dataUrlFrom(new Uint8Array([1]), 'a.psd')).toBeNull()
    expect(dataUrlFrom(new Uint8Array([1]), 'noextension')).toBeNull()
  })

  it('round-trips bytes through a data URL', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
    const url = dataUrlFrom(bytes, 'a.png') ?? ''

    expect([...(decodeDataUrl(url)?.bytes ?? [])]).toEqual([...bytes])
  })
})

describe('extensionFor', () => {
  it('uses the name the document formats store', () => {
    expect(extensionFor('jpeg')).toBe('jpg')
    expect(extensionFor('svg+xml')).toBe('svg')
    expect(extensionFor('png')).toBe('png')
  })
})

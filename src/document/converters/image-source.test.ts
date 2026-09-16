import { describe, expect, it } from 'vitest'
import { pixelsToPoints, pointsToPixels, safeImageSource } from './image-source'

describe('safeImageSource', () => {
  it('keeps a data URL that carries a picture', () => {
    expect(safeImageSource('data:image/png;base64,iVBORw==')).toBe('data:image/png;base64,iVBORw==')
    expect(safeImageSource('data:image/svg+xml,<svg/>')).toBe('data:image/svg+xml,<svg/>')
  })

  it('rejects a data URL that is not a picture', () => {
    expect(safeImageSource('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(safeImageSource('data:image')).toBeNull()
  })

  it('keeps web addresses', () => {
    expect(safeImageSource('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(safeImageSource('http://example.com/a.png')).toBe('http://example.com/a.png')
  })

  it('keeps a path relative to the document', () => {
    expect(safeImageSource('images/a.png')).toBe('images/a.png')
    expect(safeImageSource('/a.png')).toBe('/a.png')
  })

  it('rejects a scheme that runs something', () => {
    expect(safeImageSource('javascript:alert(1)')).toBeNull()
    expect(safeImageSource('  JavaScript:alert(1)')).toBeNull()
    expect(safeImageSource('vbscript:msgbox')).toBeNull()
    expect(safeImageSource('file:///etc/passwd')).toBeNull()
  })

  it('rejects an empty address', () => {
    expect(safeImageSource('   ')).toBeNull()
  })

  it('converts between pixels and points', () => {
    expect(pixelsToPoints('96')).toBe(72)
    expect(pixelsToPoints('0')).toBeNull()
    expect(pixelsToPoints('wide')).toBeNull()
    expect(pixelsToPoints(null)).toBeNull()
    expect(pointsToPixels(72)).toBe(96)
  })
})

import { describe, expect, it } from 'vitest'
import { contentTypeFor } from './media'

describe('contentTypeFor', () => {
  it('maps the formats Word and PowerPoint embed', () => {
    expect(contentTypeFor('a.png')).toBe('image/png')
    expect(contentTypeFor('a.JPG')).toBe('image/jpeg')
    expect(contentTypeFor('a.jpeg')).toBe('image/jpeg')
    expect(contentTypeFor('a.gif')).toBe('image/gif')
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml')
  })

  it('returns null for a type it does not know', () => {
    expect(contentTypeFor('a.heic')).toBeNull()
    expect(contentTypeFor('noextension')).toBeNull()
  })
})

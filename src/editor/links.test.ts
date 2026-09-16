import { describe, expect, it } from 'vitest'
import { displayUrl, isSafeUrl, normalizeUrl } from './links'

describe('normalizeUrl', () => {
  it('keeps an absolute http(s) URL', () => {
    expect(normalizeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
  })

  it('adds https to a bare domain', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
    expect(normalizeUrl('sub.example.co.uk/path')).toBe('https://sub.example.co.uk/path')
  })

  it('accepts mailto and tel', () => {
    expect(normalizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(normalizeUrl('tel:+123')).toBe('tel:+123')
  })

  it('rescues a bare email address', () => {
    expect(normalizeUrl('someone@example.com')).toBe('mailto:someone@example.com')
  })

  it('rejects script and data URLs', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('JavaScript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,<script>')).toBeNull()
    expect(normalizeUrl('vbscript:msgbox')).toBeNull()
  })

  it('rejects file and other local schemes', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(normalizeUrl('   ')).toBeNull()
  })

  it('exposes a boolean helper', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('javascript:void 0')).toBe(false)
  })
})

describe('displayUrl', () => {
  it('drops the scheme', () => {
    expect(displayUrl('https://example.com/a')).toBe('example.com/a')
  })

  it('truncates long URLs', () => {
    const long = `https://example.com/${'x'.repeat(80)}`
    expect(displayUrl(long)).toHaveLength(48)
    expect(displayUrl(long).endsWith('…')).toBe(true)
  })
})

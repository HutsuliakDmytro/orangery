/**
 * URL handling for the link command.
 *
 * Documents come from untrusted sources — a pasted DOCX can carry any href — so
 * only schemes that are safe to hand to the OS opener are allowed. `javascript:`
 * and `data:` are rejected outright rather than sanitised, because a partially
 * sanitised script URL is still a script URL.
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/** Bare domains typed by hand get `https://`, which is what Docs assumes too. */
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(\/|$|\?|#)/

export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  const candidate = BARE_DOMAIN.test(trimmed) ? `https://${trimmed}` : trimmed

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    // A bare `mailto` target is the one case worth rescuing: users type the
    // address, not the scheme.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`
    return null
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) return null
  return url.toString()
}

export function isSafeUrl(input: string): boolean {
  return normalizeUrl(input) !== null
}

/** Shortened form for link tooltips, where the full URL rarely fits. */
export function displayUrl(url: string, maxLength = 48): string {
  const withoutScheme = url.replace(/^https?:\/\//, '')
  if (withoutScheme.length <= maxLength) return withoutScheme
  return `${withoutScheme.slice(0, maxLength - 1)}…`
}

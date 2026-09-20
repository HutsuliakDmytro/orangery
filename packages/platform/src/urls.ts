/**
 * URLs on their way to the operating system.
 *
 * Every app here opens links out of documents it did not write: a pasted
 * `.docx` carries whatever href somebody put in it, and a `.xlsx` carries
 * whatever a relationship points at. So the question — is this safe to hand
 * to the thing that opens links — is the same question in all of them, which
 * is why it is answered once, here.
 *
 * `javascript:` and `data:` are refused rather than cleaned up: a partly
 * cleaned script URL is still a script URL.
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/** Bare domains typed by hand get `https://`, which is what people mean. */
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(\/|$|\?|#)/u

export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  const candidate = BARE_DOMAIN.test(trimmed) ? `https://${trimmed}` : trimmed

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    // A bare `mailto` target is the one case worth rescuing: people type the
    // address, not the scheme.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)) return `mailto:${trimmed}`
    return null
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) return null
  return url.toString()
}

export function isSafeUrl(input: string): boolean {
  return normalizeUrl(input) !== null
}

/** Shortened form for a tooltip, where the whole URL rarely fits. */
export function displayUrl(url: string, maxLength = 48): string {
  const withoutScheme = url.replace(/^https?:\/\//u, '')
  if (withoutScheme.length <= maxLength) return withoutScheme
  return `${withoutScheme.slice(0, maxLength - 1)}…`
}

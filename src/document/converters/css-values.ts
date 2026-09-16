/**
 * The CSS values an HTML document states formatting in.
 *
 * Only the properties the editor models are read, and each is turned into the
 * app's own representation rather than carried through as text — a document
 * never holds CSS it did not write, which is the same rule the element
 * allowlist follows.
 */

const POINTS_PER_UNIT: Record<string, number> = {
  pt: 1,
  px: 0.75,
  pc: 12,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
}

/** Splits a `style` attribute into the properties it declares. */
export function cssProperties(style: string | null): Map<string, string> {
  const properties = new Map<string, string>()
  if (style === null) return properties

  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator === -1) continue

    const name = declaration.slice(0, separator).trim().toLowerCase()
    const value = declaration.slice(separator + 1).trim()
    if (name !== '' && value !== '') properties.set(name, value)
  }

  return properties
}

/**
 * A colour as `#RRGGBB`, or null when it is not one we can state.
 *
 * Named colours and the wider colour functions are left out: the editor holds a
 * colour as six hex digits, and anything that cannot be written that way would
 * have to be approximated.
 */
export function cssColor(value: string | undefined): string | null {
  if (value === undefined) return null

  const text = value.trim().toLowerCase()
  if (text === '' || text === 'transparent' || text === 'inherit' || text === 'initial') return null

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(text)
  if (short?.[1] && short[2] && short[3]) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase()
  }

  if (/^#[0-9a-f]{6}$/u.test(text)) return text.toUpperCase()

  const channels = /^rgba?\(([^)]*)\)$/u.exec(text)
  if (channels?.[1] === undefined) return null

  const parts = channels[1].split(/[\s,/]+/u).filter((part) => part !== '')
  const [red, green, blue, alpha] = parts

  // A fully transparent colour is the absence of one, not black.
  if (alpha !== undefined && Number.parseFloat(alpha) === 0) return null
  if (red === undefined || green === undefined || blue === undefined) return null

  const hex = [red, green, blue].map((part) => {
    const amount = part.endsWith('%')
      ? (Number.parseFloat(part) / 100) * 255
      : Number.parseFloat(part)
    if (!Number.isFinite(amount)) return null
    return Math.max(0, Math.min(255, Math.round(amount)))
      .toString(16)
      .padStart(2, '0')
  })

  return hex.some((part) => part === null) ? null : `#${hex.join('')}`.toUpperCase()
}

/**
 * A length in points, or null when it is relative.
 *
 * `em`, `%` and `rem` are measured against a font size this converter does not
 * resolve, so they are left alone rather than turned into a wrong number.
 */
export function cssLengthToPoints(value: string | undefined): number | null {
  if (value === undefined) return null

  const match = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/iu.exec(value.trim())
  if (!match?.[1]) return null

  const amount = Number.parseFloat(match[1])
  const factor = POINTS_PER_UNIT[(match[2] ?? '').toLowerCase()]
  if (!Number.isFinite(amount) || factor === undefined) return null

  return Math.round(amount * factor * 100) / 100
}

/** The first family named, which is the one the editor stores. */
export function cssFontFamily(value: string | undefined): string | null {
  if (value === undefined) return null

  const first = value.split(',')[0]?.trim().replace(/^["']|["']$/gu, '')
  return first === undefined || first === '' ? null : first
}

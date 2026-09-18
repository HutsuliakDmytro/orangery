import type { OoxmlPackage } from '@orangery/ooxml-core'
import type { Deck } from './deck'
import type { ColorSlot } from './write-theme'
import { setThemeColors, setThemeFonts, setThemeName } from './write-theme'

/**
 * The themes a deck can be given.
 *
 * Each is a colour scheme and two fonts — the whole of what a theme decides for
 * a deck that uses it, since everything else in `a:themeElements` is the fill
 * and line recipes, and replacing those would change the shape of shapes rather
 * than their colour.
 *
 * Applying one rewrites the theme part. Nothing on a slide is touched: a shape
 * that says `schemeClr accent1` already means "whatever the theme calls accent
 * 1". Shapes painted a literal colour keep it, which is the honest consequence
 * of having painted them a colour rather than a slot.
 */

export interface GalleryTheme {
  name: string
  colors: Record<ColorSlot, string>
  fonts: { major: string; minor: string }
}

/** Dark, light, and the two link colours every scheme needs. */
const LINKS = { hlink: '#2F6FED', folHlink: '#7A5AF8' }

export const THEME_GALLERY: readonly GalleryTheme[] = [
  {
    name: 'Orangery',
    colors: {
      dk1: '#121212',
      lt1: '#FFFFFF',
      dk2: '#1E1E1E',
      lt2: '#F4F4F5',
      accent1: '#FF7A00',
      accent2: '#FF9E3D',
      accent3: '#C25100',
      accent4: '#4D4D4D',
      accent5: '#8A8A8A',
      accent6: '#D4D4D8',
      ...LINKS,
    },
    fonts: { major: 'Inter', minor: 'Inter' },
  },
  {
    name: 'Paper',
    colors: {
      dk1: '#1A1A1A',
      lt1: '#FFFFFF',
      dk2: '#3F3F46',
      lt2: '#FAFAF9',
      accent1: '#525252',
      accent2: '#737373',
      accent3: '#A3A3A3',
      accent4: '#404040',
      accent5: '#D4D4D4',
      accent6: '#171717',
      ...LINKS,
    },
    fonts: { major: 'Liberation Serif', minor: 'Liberation Serif' },
  },
  {
    name: 'Slate',
    colors: {
      dk1: '#0F172A',
      lt1: '#FFFFFF',
      dk2: '#1E293B',
      lt2: '#F1F5F9',
      accent1: '#334155',
      accent2: '#475569',
      accent3: '#64748B',
      accent4: '#94A3B8',
      accent5: '#CBD5E1',
      accent6: '#0F172A',
      ...LINKS,
    },
    fonts: { major: 'Inter', minor: 'Inter' },
  },
  {
    name: 'Sand',
    colors: {
      dk1: '#292524',
      lt1: '#FFFFFF',
      dk2: '#44403C',
      lt2: '#FAF9F7',
      accent1: '#A8A29E',
      accent2: '#78716C',
      accent3: '#57534E',
      accent4: '#D6D3D1',
      accent5: '#E7E5E4',
      accent6: '#1C1917',
      ...LINKS,
    },
    fonts: { major: 'Carlito', minor: 'Carlito' },
  },
  {
    name: 'Ink',
    colors: {
      dk1: '#000000',
      lt1: '#FFFFFF',
      dk2: '#262626',
      lt2: '#F5F5F5',
      accent1: '#171717',
      accent2: '#404040',
      accent3: '#737373',
      accent4: '#A3A3A3',
      accent5: '#D4D4D4',
      accent6: '#E5E5E5',
      ...LINKS,
    },
    fonts: { major: 'Liberation Sans', minor: 'Liberation Sans' },
  },
  {
    name: 'Sea',
    colors: {
      dk1: '#0C2231',
      lt1: '#FFFFFF',
      dk2: '#14364B',
      lt2: '#EEF6FA',
      accent1: '#1F6E8C',
      accent2: '#2E8BA8',
      accent3: '#84B7C9',
      accent4: '#0C2231',
      accent5: '#B9D6E2',
      accent6: '#527A8A',
      ...LINKS,
    },
    fonts: { major: 'Inter', minor: 'Inter' },
  },
  {
    name: 'Moss',
    colors: {
      dk1: '#1B2415',
      lt1: '#FFFFFF',
      dk2: '#2F3B25',
      lt2: '#F3F6EF',
      accent1: '#5C7A3F',
      accent2: '#7E9C5E',
      accent3: '#A7BD8B',
      accent4: '#3D4F2C',
      accent5: '#C9D8B6',
      accent6: '#1B2415',
      ...LINKS,
    },
    fonts: { major: 'Carlito', minor: 'Carlito' },
  },
]

/** The theme parts a deck draws from: one per master, and usually one in all. */
export function themePathsOf(deck: Deck): string[] {
  const paths = [...deck.masters.values()].flatMap((master) =>
    master.theme === null ? [] : [master.theme],
  )
  return [...new Set(paths)]
}

/**
 * Gives every master of a deck the same theme.
 *
 * Every master, because a deck whose masters disagree about accent 1 is a deck
 * where the same slot means two colours — which is the one thing a theme exists
 * to prevent.
 */
export function applyTheme(pkg: OoxmlPackage, deck: Deck, theme: GalleryTheme): boolean {
  let changed = false

  for (const path of themePathsOf(deck)) {
    if (setThemeColors(pkg, path, theme.colors)) changed = true
    if (setThemeFonts(pkg, path, theme.fonts)) changed = true
    if (setThemeName(pkg, path, theme.name)) changed = true
  }

  return changed
}

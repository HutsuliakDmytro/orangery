/**
 * Special characters.
 *
 * Grouped the way a writer looks for them, not by Unicode block: the reason
 * someone opens this dialog is "I need a proper dash", not "I need U+2014".
 */

export interface CharacterGroup {
  id: string
  label: string
  characters: { char: string; name: string }[]
}

export const CHARACTER_GROUPS: readonly CharacterGroup[] = [
  {
    id: 'punctuation',
    label: 'Punctuation',
    characters: [
      { char: '—', name: 'Em dash' },
      { char: '–', name: 'En dash' },
      { char: '…', name: 'Ellipsis' },
      { char: '·', name: 'Middle dot' },
      { char: '•', name: 'Bullet' },
      { char: '§', name: 'Section sign' },
      { char: '¶', name: 'Pilcrow' },
      { char: '†', name: 'Dagger' },
      { char: '‡', name: 'Double dagger' },
      { char: '‰', name: 'Per mille' },
    ],
  },
  {
    id: 'quotes',
    label: 'Quotation marks',
    characters: [
      { char: '“', name: 'Left double quote' },
      { char: '”', name: 'Right double quote' },
      { char: '‘', name: 'Left single quote' },
      { char: '’', name: 'Right single quote / apostrophe' },
      // Ukrainian and other European typography uses guillemets.
      { char: '«', name: 'Left guillemet' },
      { char: '»', name: 'Right guillemet' },
      { char: '„', name: 'Low double quote' },
    ],
  },
  {
    id: 'currency',
    label: 'Currency',
    characters: [
      { char: '₴', name: 'Hryvnia' },
      { char: '€', name: 'Euro' },
      { char: '£', name: 'Pound' },
      { char: '$', name: 'Dollar' },
      { char: '¥', name: 'Yen' },
      { char: '₽', name: 'Rouble' },
      { char: '¢', name: 'Cent' },
    ],
  },
  {
    id: 'math',
    label: 'Mathematics',
    characters: [
      { char: '×', name: 'Multiplication' },
      { char: '÷', name: 'Division' },
      { char: '±', name: 'Plus-minus' },
      { char: '≈', name: 'Approximately equal' },
      { char: '≠', name: 'Not equal' },
      { char: '≤', name: 'Less than or equal' },
      { char: '≥', name: 'Greater than or equal' },
      { char: '∞', name: 'Infinity' },
      { char: '√', name: 'Square root' },
      { char: '°', name: 'Degree' },
      { char: '½', name: 'One half' },
      { char: '¼', name: 'One quarter' },
    ],
  },
  {
    id: 'arrows',
    label: 'Arrows and marks',
    characters: [
      { char: '→', name: 'Right arrow' },
      { char: '←', name: 'Left arrow' },
      { char: '↑', name: 'Up arrow' },
      { char: '↓', name: 'Down arrow' },
      { char: '✓', name: 'Check mark' },
      { char: '✗', name: 'Cross mark' },
      { char: '★', name: 'Star' },
      { char: '☆', name: 'Open star' },
    ],
  },
  {
    id: 'spaces',
    label: 'Spaces',
    characters: [
      { char: ' ', name: 'Non-breaking space' },
      { char: ' ', name: 'Thin space' },
      { char: '‑', name: 'Non-breaking hyphen' },
      { char: '​', name: 'Zero-width space' },
    ],
  },
]

/** Searches by name so "dash" finds the em dash without knowing its symbol. */
export function searchCharacters(query: string): { char: string; name: string }[] {
  const needle = query.trim().toLowerCase()
  const all = CHARACTER_GROUPS.flatMap((group) => group.characters)

  if (needle === '') return all
  return all.filter(
    (entry) => entry.name.toLowerCase().includes(needle) || entry.char === query.trim(),
  )
}

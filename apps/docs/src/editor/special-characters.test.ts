import { describe, expect, it } from 'vitest'
import { CHARACTER_GROUPS, searchCharacters } from './special-characters'

describe('character groups', () => {
  it('groups by what a writer is looking for', () => {
    expect(CHARACTER_GROUPS.map((group) => group.id)).toEqual([
      'punctuation',
      'quotes',
      'currency',
      'math',
      'arrows',
      'spaces',
    ])
  })

  it('gives every character a name', () => {
    for (const group of CHARACTER_GROUPS) {
      for (const entry of group.characters) {
        expect(entry.name.trim(), `${group.id}: ${entry.char}`).not.toBe('')
      }
    }
  })

  it('includes the guillemets Ukrainian typography uses', () => {
    const quotes = CHARACTER_GROUPS.find((group) => group.id === 'quotes')
    expect(quotes?.characters.map((entry) => entry.char)).toEqual(
      expect.arrayContaining(['«', '»']),
    )
  })

  it('includes the hryvnia sign', () => {
    const currency = CHARACTER_GROUPS.find((group) => group.id === 'currency')
    expect(currency?.characters[0]?.char).toBe('₴')
  })

  it('has no duplicate characters across groups', () => {
    const all = CHARACTER_GROUPS.flatMap((group) => group.characters.map((entry) => entry.char))
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('searchCharacters', () => {
  it('returns everything for an empty query', () => {
    const total = CHARACTER_GROUPS.reduce((sum, group) => sum + group.characters.length, 0)
    expect(searchCharacters('  ')).toHaveLength(total)
  })

  it('finds a character by its name', () => {
    expect(searchCharacters('em dash')[0]?.char).toBe('—')
  })

  it('matches part of a name', () => {
    expect(searchCharacters('dash').map((entry) => entry.char)).toEqual(
      expect.arrayContaining(['—', '–']),
    )
  })

  it('ignores case', () => {
    expect(searchCharacters('HRYVNIA')[0]?.char).toBe('₴')
  })

  it('finds a character by pasting it', () => {
    expect(searchCharacters('→')[0]?.name).toBe('Right arrow')
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(searchCharacters('zzzz')).toEqual([])
  })
})

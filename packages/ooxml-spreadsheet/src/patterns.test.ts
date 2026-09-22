import { describe, expect, it } from 'vitest'
import { elementPattern, openingPattern, selfClosedPattern } from './patterns'

/**
 * The patterns, against the input that broke the one they replaced.
 *
 * Every case here is a real shape out of the corpus: an empty styled cell, a
 * shared formula stated once and referred to after, a row that exists only for
 * its height.
 */

describe('elementPattern', () => {
  it('stops at the element it started, when that element closes itself', () => {
    const pattern = elementPattern('c', 'gu')
    const found = [
      ...'<c r="A1" s="1"/><c r="B1" s="2"/><c r="C1" s="3" t="s"><v>0</v></c>'.matchAll(pattern),
    ]

    expect(found.map((match) => match[1]?.trim())).toEqual([
      'r="A1" s="1"',
      'r="B1" s="2"',
      'r="C1" s="3" t="s"',
    ])
    expect(found.map((match) => match[2])).toEqual([undefined, undefined, '<v>0</v>'])
  })

  it('takes an element with no attributes at all', () => {
    expect(elementPattern('c').exec('<c/>')?.[0]).toBe('<c/>')
    expect(elementPattern('c').exec('<c><v>1</v></c>')?.[2]).toBe('<v>1</v>')
  })

  it('allows the space some writers leave before the slash', () => {
    const match = elementPattern('c').exec('<c r="A1" />')
    expect(match?.[0]).toBe('<c r="A1" />')
    expect(match?.[1]?.trim()).toBe('r="A1"')
  })

  it('does not match an element whose name merely starts the same way', () => {
    expect(elementPattern('c').exec('<cols><col min="1"/></cols>')).toBeNull()
  })

  it('matches each of a run of self-closed elements separately', () => {
    const pattern = elementPattern('row', 'gu')
    const text = '<row r="1" ht="20"/><row r="2"><c r="A2"/></row><row r="3"/>'

    expect([...text.matchAll(pattern)].map((match) => match[1]?.trim())).toEqual([
      'r="1" ht="20"',
      'r="2"',
      'r="3"',
    ])
  })
})

describe('openingPattern', () => {
  it('finds where an element starts, however it ends', () => {
    expect(openingPattern('sheetData').exec('<a/><sheetData><row/></sheetData>')?.[0]).toBe(
      '<sheetData>',
    )
    expect(openingPattern('sheetData').exec('<a/><sheetData/>')?.[0]).toBe('<sheetData/>')
  })
})

describe('selfClosedPattern', () => {
  it('matches only the empty form', () => {
    expect(selfClosedPattern('sheetData').exec('<sheetData/>')?.[0]).toBe('<sheetData/>')
    expect(selfClosedPattern('sheetData').exec('<sheetData><row/></sheetData>')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  addRelationship,
  findByTarget,
  IMAGE_RELATIONSHIP,
  nextRelationshipId,
  parseRelationships,
  resolveTarget,
  serializeRelationships,
} from './relationships'

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${IMAGE_RELATIONSHIP}" Target="media/image1.png"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`

describe('parseRelationships', () => {
  it('reads id, type and target', () => {
    const relationships = parseRelationships(RELS)
    expect(relationships.get('rId1')?.target).toBe('media/image1.png')
  })

  it('flags external targets', () => {
    const relationships = parseRelationships(RELS)
    expect(relationships.get('rId3')?.external).toBe(true)
    expect(relationships.get('rId1')?.external).toBe(false)
  })

  it('skips entries missing a required attribute', () => {
    const partial = '<Relationships><Relationship Id="rId9"/></Relationships>'
    expect(parseRelationships(partial).size).toBe(0)
  })

  it('returns an empty map for malformed input', () => {
    expect(parseRelationships('<nonsense/>').size).toBe(0)
  })
})

describe('serializeRelationships', () => {
  it('round-trips what it read', () => {
    const first = parseRelationships(RELS)
    const second = parseRelationships(serializeRelationships(first))

    expect([...second.keys()]).toEqual([...first.keys()])
    expect(second.get('rId3')?.external).toBe(true)
  })

  it('writes the package namespace Word expects', () => {
    expect(serializeRelationships(parseRelationships(RELS))).toContain(
      'schemas.openxmlformats.org/package/2006/relationships',
    )
  })
})

describe('nextRelationshipId', () => {
  it('continues past the highest existing id', () => {
    expect(nextRelationshipId(parseRelationships(RELS))).toBe('rId4')
  })

  it('starts at one for an empty part', () => {
    expect(nextRelationshipId(new Map())).toBe('rId1')
  })

  it('ignores ids that are not in the rIdN form', () => {
    const odd = parseRelationships(
      `<Relationships><Relationship Id="custom" Type="t" Target="x"/></Relationships>`,
    )
    expect(nextRelationshipId(odd)).toBe('rId1')
  })
})

describe('addRelationship', () => {
  it('assigns a free id and stores the entry', () => {
    const relationships = parseRelationships(RELS)
    const added = addRelationship(relationships, IMAGE_RELATIONSHIP, 'media/image2.png')

    expect(added.id).toBe('rId4')
    expect(relationships.get('rId4')?.target).toBe('media/image2.png')
  })

  it('does not reuse an id after two additions', () => {
    const relationships = parseRelationships(RELS)
    const first = addRelationship(relationships, IMAGE_RELATIONSHIP, 'media/a.png')
    const second = addRelationship(relationships, IMAGE_RELATIONSHIP, 'media/b.png')

    expect(second.id).not.toBe(first.id)
  })
})

describe('resolveTarget', () => {
  it('resolves a relative target against the word part', () => {
    expect(resolveTarget('media/image1.png')).toBe('word/media/image1.png')
  })

  it('resolves an absolute target from the package root', () => {
    expect(resolveTarget('/word/media/image1.png')).toBe('word/media/image1.png')
  })

  it('strips a leading ./', () => {
    expect(resolveTarget('./media/image1.png')).toBe('word/media/image1.png')
  })
})

describe('findByTarget', () => {
  it('finds a relationship by what it points at', () => {
    expect(findByTarget(parseRelationships(RELS), 'media/image1.png')?.id).toBe('rId1')
  })

  it('returns undefined when nothing points there', () => {
    expect(findByTarget(parseRelationships(RELS), 'media/nope.png')).toBeUndefined()
  })
})

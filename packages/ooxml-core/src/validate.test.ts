import { describe, expect, it } from 'vitest'
import { CONTENT_TYPES_PART, setPartText } from './package'
import type { OoxmlPackage } from './package'
import { describeProblems, problemsIn } from './validate'
import { XML_DECLARATION, withDeclaration } from './xml'

/**
 * The checks a lenient reader does not do.
 *
 * Everything here reads back perfectly through this codebase and is a file
 * Word or PowerPoint offers to repair, which is the whole reason the check
 * exists — so each rule is tested against a package that breaks it and against
 * one that does not.
 */

const TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/ppt/presentation.xml" ContentType="application/x.presentation"/>' +
  '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/x.slide"/>' +
  '</Types>'

const RELS = (target: string) =>
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rId1" Type="http://x/slide" Target="${target}"/>` +
  '</Relationships>'

/** A package with two parts, one naming the other, and nothing wrong with it. */
function sound(): OoxmlPackage {
  const pkg: OoxmlPackage = { parts: new Map() }

  setPartText(pkg, CONTENT_TYPES_PART, withDeclaration(TYPES))
  setPartText(pkg, 'ppt/presentation.xml', withDeclaration('<p:presentation r:id="rId1"/>'))
  setPartText(pkg, 'ppt/_rels/presentation.xml.rels', withDeclaration(RELS('slides/slide1.xml')))
  setPartText(pkg, 'ppt/slides/slide1.xml', withDeclaration('<p:sld/>'))

  return pkg
}

describe('a package with nothing wrong with it', () => {
  it('is reported as such', () => {
    expect(problemsIn(sound())).toEqual([])
  })

  it('does not mind a part that names no relationship', () => {
    const pkg = sound()
    setPartText(pkg, 'ppt/slides/slide1.xml', withDeclaration('<p:sld><p:cSld/></p:sld>'))

    expect(problemsIn(pkg)).toEqual([])
  })
})

describe('what it catches', () => {
  it('a part written with two declarations', () => {
    const pkg = sound()
    // What `withDeclaration(buildXml(parseXml(text)))` used to produce, in two
    // dozen writers, for as long as nobody wrote the same part twice. Spelled
    // out rather than called: `withDeclaration` does not do it any more, and a
    // check written through the fixed function would test nothing.
    setPartText(pkg, 'ppt/slides/slide1.xml', `${XML_DECLARATION}${XML_DECLARATION}<p:sld/>`)

    expect(describeProblems(problemsIn(pkg))).toContain('XML declarations')
  })

  it('a relationship pointing at a part nobody copied', () => {
    const pkg = sound()
    setPartText(pkg, 'ppt/_rels/presentation.xml.rels', withDeclaration(RELS('slides/slide9.xml')))

    expect(describeProblems(problemsIn(pkg))).toContain('ppt/slides/slide9.xml')
  })

  it('an r:id naming a relationship that is not there', () => {
    const pkg = sound()
    setPartText(
      pkg,
      'ppt/slides/slide1.xml',
      withDeclaration('<p:sld><p:pic r:embed="rId7"/></p:sld>'),
    )

    expect(describeProblems(problemsIn(pkg))).toContain('rId7')
  })

  it('an empty r:id, which the format does allow', () => {
    // PowerPoint writes one for a click action with no target; a reader that
    // called it dangling would report every deck with a "next slide" jump.
    const pkg = sound()
    setPartText(
      pkg,
      'ppt/slides/slide1.xml',
      withDeclaration('<p:sld><a:hlinkClick r:id="" action="ppaction://hlinkshowjump"/></p:sld>'),
    )

    expect(problemsIn(pkg)).toEqual([])
  })

  it('a part nothing declares the type of', () => {
    const pkg = sound()
    setPartText(pkg, 'ppt/slides/slide2.xml', withDeclaration('<p:sld/>'))

    expect(describeProblems(problemsIn(pkg))).toContain('nothing declares what this part is')
  })

  it('a picture whose extension nothing declares', () => {
    const pkg = sound()
    pkg.parts.set('ppt/media/image1.gif', {
      path: 'ppt/media/image1.gif',
      bytes: new Uint8Array([1]),
      date: new Date(),
    })

    expect(describeProblems(problemsIn(pkg))).toContain('image1.gif')
  })

  it('a part holding two root elements', () => {
    const pkg = sound()
    setPartText(pkg, 'ppt/slides/slide1.xml', withDeclaration('<p:sld/><p:sld/>'))

    expect(describeProblems(problemsIn(pkg))).toContain('2 root elements')
  })

  it('a package with no content types part at all', () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    setPartText(pkg, 'ppt/presentation.xml', '<p:presentation/>')

    expect(problemsIn(pkg)).toHaveLength(1)
  })
})

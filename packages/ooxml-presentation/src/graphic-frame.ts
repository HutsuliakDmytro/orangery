import { attribute, findChild } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readTable } from '@orangery/ooxml-drawingml'
import type { Table } from '@orangery/ooxml-drawingml'

/**
 * What is inside a `p:graphicFrame`.
 *
 * A graphic frame is a box with something else in it, and what that something
 * is comes from the `uri` on `a:graphicData` rather than the element inside.
 * Reading the uri is the only reliable way: a chart and a diagram both hold a
 * single element that is only a relationship id, and they are told apart by
 * nothing else.
 *
 * Only the table is modelled. A chart is rendered from its own part in a later
 * phase and never written; a diagram or an embedded object is a labelled box.
 * All of them keep their subtree, so nothing is lost by our not understanding
 * them (ADR 0002).
 */

const NAMESPACE = 'http://schemas.openxmlformats.org/'

const KINDS: Readonly<Record<string, GraphicKind>> = {
  [`${NAMESPACE}drawingml/2006/table`]: 'table',
  [`${NAMESPACE}drawingml/2006/chart`]: 'chart',
  [`${NAMESPACE}drawingml/2006/diagram`]: 'diagram',
  [`${NAMESPACE}presentationml/2006/ole`]: 'ole',
}

export type GraphicKind = 'table' | 'chart' | 'diagram' | 'ole' | 'unknown'

export interface GraphicContent {
  kind: GraphicKind
  /** The uri as written, so an unknown kind can still be named to the user. */
  uri: string | null
  /** Parsed only for a table; everything else keeps its XML and nothing more. */
  table: Table | null
  /** The relationship a chart, diagram or object points at. */
  relationshipId: string | null
}

/** The relationship id a graphic carries, whatever the element is called. */
function relationshipIn(data: XmlNode): string | null {
  const holder = findChild(data, 'c:chart') ?? findChild(data, 'dgm:relIds')
  if (holder !== undefined) {
    return (
      attribute(holder, 'r:id') ?? attribute(holder, 'r:dm') ?? attribute(holder, 'r:embed') ?? null
    )
  }

  const object = findChild(data, 'p:oleObj')
  return object === undefined ? null : (attribute(object, 'r:id') ?? null)
}

/** Reads the contents of a `p:graphicFrame`. */
export function readGraphicContent(frame: XmlNode): GraphicContent | null {
  const graphic = findChild(frame, 'a:graphic')
  const data = graphic === undefined ? undefined : findChild(graphic, 'a:graphicData')
  if (data === undefined) return null

  const uri = attribute(data, 'uri') ?? null
  const kind = uri === null ? 'unknown' : (KINDS[uri] ?? 'unknown')
  const table = kind === 'table' ? findChild(data, 'a:tbl') : undefined

  return {
    kind,
    uri,
    table: table === undefined ? null : readTable(table),
    relationshipId: relationshipIn(data),
  }
}

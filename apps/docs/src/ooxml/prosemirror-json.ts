/**
 * The ProseMirror document shape, as JSON.
 *
 * In its own module because both the parser and the OOXML feature modules
 * (tables, images) need it, and importing it from the parser would make those
 * modules and the parser import each other.
 */

export interface ProseMirrorMarkJson {
  type: string
  attrs?: Record<string, unknown>
}

export interface ProseMirrorNodeJson {
  type: string
  attrs?: Record<string, unknown>
  content?: ProseMirrorNodeJson[]
  marks?: ProseMirrorMarkJson[]
  text?: string
}

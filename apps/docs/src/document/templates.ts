import type { ProseMirrorNodeJson } from '../ooxml/parse-document'

/**
 * Starter documents.
 *
 * Content only: every template is the same DOCX package underneath, so a
 * template choice never changes what the file is — only what is in it.
 */

export type TemplateId = 'blank' | 'letter' | 'report'

export interface Template {
  id: TemplateId
  /** Paragraphs the new document starts with. */
  build: () => ProseMirrorNodeJson
}

function heading(level: number, text: string): ProseMirrorNodeJson {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
}

function paragraph(text = ''): ProseMirrorNodeJson {
  return text === ''
    ? { type: 'paragraph' }
    : { type: 'paragraph', content: [{ type: 'text', text }] }
}

function titled(styleId: string, text: string): ProseMirrorNodeJson {
  return { type: 'paragraph', attrs: { styleId }, content: [{ type: 'text', text }] }
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'blank',
    build: () => ({ type: 'doc', content: [paragraph()] }),
  },
  {
    id: 'letter',
    build: () => ({
      type: 'doc',
      content: [
        // Right-aligned sender block, the usual business-letter opening.
        { ...paragraph('Your Name'), attrs: { textAlign: 'right' } },
        { ...paragraph('Street Address'), attrs: { textAlign: 'right' } },
        { ...paragraph('City, Postcode'), attrs: { textAlign: 'right' } },
        paragraph(),
        paragraph('Recipient Name'),
        paragraph('Company'),
        paragraph(),
        paragraph('Dear …,'),
        paragraph(),
        paragraph(),
        paragraph('Yours sincerely,'),
        paragraph(),
        paragraph('Your Name'),
      ],
    }),
  },
  {
    id: 'report',
    build: () => ({
      type: 'doc',
      content: [
        titled('Title', 'Report Title'),
        titled('Subtitle', 'Subtitle or date'),
        heading(1, 'Summary'),
        paragraph(),
        heading(1, 'Background'),
        paragraph(),
        heading(1, 'Findings'),
        heading(2, 'First finding'),
        paragraph(),
        heading(1, 'Conclusion'),
        paragraph(),
      ],
    }),
  },
]

export function templateById(id: TemplateId): Template {
  const template = TEMPLATES.find((entry) => entry.id === id)
  if (!template) throw new Error(`unknown template: ${id}`)
  return template
}

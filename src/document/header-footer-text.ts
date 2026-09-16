import { dateField, pageNumberField } from '../ooxml/header-footer'
import { element, textValue, children } from '../ooxml/xml'
import type { XmlNode } from '../ooxml/xml'

/**
 * Converting between a header's text and its OOXML paragraphs.
 *
 * The editor works with one line of text plus two tokens; the file stores runs
 * and field sequences. `{page}` and `{date}` are the tokens because they read
 * as placeholders to anyone who sees them, which matters when a header comes
 * from a file and is shown as text for the first time.
 */

export const PAGE_NUMBER_TOKEN = '{page}'
export const DATE_TOKEN = '{date}'

/** Text of a header or footer part, with fields shown as tokens. */
export function textFromParagraphs(paragraphs: readonly XmlNode[]): string {
  return paragraphs
    .map((paragraph) => textOfParagraph(paragraph))
    .join('\n')
    .trim()
}

function textOfParagraph(paragraph: XmlNode): string {
  let result = ''
  let inField: string | null = null

  const walk = (node: XmlNode): void => {
    if ('#text' in node) {
      if (inField === null) result += textValue(node)
      return
    }

    const [tag] = Object.keys(node).filter((key) => key !== ':@')

    if (tag === 'w:instrText') {
      // Field codes are read, not displayed: the token stands in for them.
      const code = children(node)
        .map((child) => ('#text' in child ? textValue(child) : ''))
        .join('')
      if (/\bPAGE\b/u.test(code)) inField = PAGE_NUMBER_TOKEN
      else if (/\bDATE\b/u.test(code)) inField = DATE_TOKEN
      else inField = ''
      return
    }

    if (tag === 'w:fldChar') {
      const attrs = node[':@']
      const type =
        typeof attrs === 'object' && attrs !== null
          ? (attrs as Record<string, unknown>)['@_w:fldCharType']
          : undefined

      if (type === 'end') {
        result += inField ?? ''
        inField = null
      }
      return
    }

    for (const child of children(node)) walk(child)
  }

  walk(paragraph)
  return result
}

/** Builds the paragraphs for a header, expanding the tokens into fields. */
export function paragraphsFromText(text: string): XmlNode[] {
  return text.split('\n').map((line) => {
    const nodes: XmlNode[] = []
    const pattern = /\{page\}|\{date\}/gu
    let cursor = 0
    let match: RegExpExecArray | null

    const pushText = (value: string) => {
      if (value === '') return
      nodes.push(
        element('w:r', {}, [element('w:t', { 'xml:space': 'preserve' }, [{ '#text': value }])]),
      )
    }

    while ((match = pattern.exec(line)) !== null) {
      pushText(line.slice(cursor, match.index))
      nodes.push(...(match[0] === PAGE_NUMBER_TOKEN ? pageNumberField() : dateField()))
      cursor = match.index + match[0].length
    }

    pushText(line.slice(cursor))
    return element('w:p', {}, nodes)
  })
}

import type { Command } from './types'

/**
 * Ranking for the command palette. Deliberately simple: a subsequence match on
 * the label, boosted for prefix and word-start hits, with keywords as a fallback.
 * Anything fancier (fuzzy libraries, scoring matrices) is not worth the weight
 * for a list this size.
 */

export interface SearchHit {
  command: Command
  score: number
  /** Indices into the label that matched, for highlighting. */
  matches: number[]
}

function subsequenceMatch(haystack: string, needle: string): number[] | null {
  const matches: number[] = []
  let cursor = 0

  for (const char of needle) {
    const found = haystack.indexOf(char, cursor)
    if (found === -1) return null
    matches.push(found)
    cursor = found + 1
  }

  return matches
}

function scoreLabel(label: string, query: string): SearchHit['matches'] | null {
  return subsequenceMatch(label.toLowerCase(), query)
}

function bonus(label: string, matches: number[]): number {
  const lower = label.toLowerCase()
  let score = 0

  for (const index of matches) {
    if (index === 0) score += 10
    else if (lower[index - 1] === ' ') score += 5
  }

  // Tighter matches rank higher: reward a small span between first and last hit.
  const first = matches[0] ?? 0
  const last = matches[matches.length - 1] ?? 0
  score -= last - first

  return score
}

export function searchCommands(commands: readonly Command[], rawQuery: string): SearchHit[] {
  const query = rawQuery.trim().toLowerCase()
  if (query === '') {
    return commands.map((command) => ({ command, score: 0, matches: [] }))
  }

  const hits: SearchHit[] = []

  for (const command of commands) {
    const matches = scoreLabel(command.label, query)
    if (matches) {
      hits.push({ command, score: 100 + bonus(command.label, matches), matches })
      continue
    }

    const keywordHit = command.keywords?.some((keyword) => keyword.toLowerCase().includes(query))
    if (keywordHit) {
      hits.push({ command, score: 50, matches: [] })
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
}

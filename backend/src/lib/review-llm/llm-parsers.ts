import type { AiFinding, AiOverview } from './types.js'

/** Strip markdown fences and parse JSON (local models often ignore "no markdown"). */
export function parseLlmJsonPayload(raw: string): unknown {
  let s = raw.trim()
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(s)
  if (fenced) {
    s = fenced[1].trim()
  } else if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```[\s\S]*$/, '').trim()
  }
  try {
    return JSON.parse(s)
  } catch {
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(s.slice(start, end + 1))
    }
    throw new Error('Invalid LLM JSON')
  }
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max)
}

export function parseOverview(obj: Record<string, unknown>): AiOverview {
  return {
    whatChanged: typeof obj.whatChanged === 'string' ? obj.whatChanged.trim() : '',
    affectedAreas: stringArray(obj.affectedAreas, 8),
    focusForReviewer: typeof obj.focusForReviewer === 'string' ? obj.focusForReviewer.trim() : '',
    priorityReview: stringArray(obj.priorityReview, 8),
    checklist: stringArray(obj.checklist, 12),
  }
}

export function parseFindings(obj: Record<string, unknown>): AiFinding[] {
  const findingsRaw = Array.isArray(obj.findings) ? obj.findings : []
  return findingsRaw
    .map((f) => {
      if (!f || typeof f !== 'object') return null
      const fr = f as Record<string, unknown>
      return {
        severity: typeof fr.severity === 'string' ? fr.severity : 'info',
        path: typeof fr.path === 'string' ? fr.path : '',
        comment: typeof fr.comment === 'string' ? fr.comment : '',
      }
    })
    .filter((x): x is AiFinding => x !== null && x.path.length > 0 && x.comment.length > 0)
}

export function parseOverviewFromRaw(raw: string): AiOverview {
  const parsed = parseLlmJsonPayload(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid LLM JSON')
  return parseOverview(parsed as Record<string, unknown>)
}

export function parseFindingsFromRaw(raw: string): AiFinding[] {
  const parsed = parseLlmJsonPayload(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid LLM JSON')
  return parseFindings(parsed as Record<string, unknown>)
}

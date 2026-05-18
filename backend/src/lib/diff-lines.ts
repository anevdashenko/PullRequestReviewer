import type { AiFinding, AiReviewResult } from './llm.js'

/** Lines in the NEW file (RIGHT side) that appear in the unified diff and accept inline comments. */
export function parseUnifiedPatchRightLines(patch: string): Set<number> {
  const valid = new Set<number>()
  if (!patch) return valid

  let newLine = 0
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (m) newLine = parseInt(m[2], 10) - 1
      continue
    }
    if (raw.startsWith('+')) {
      newLine += 1
      valid.add(newLine)
    } else if (raw.startsWith('-')) {
      continue
    } else if (raw.startsWith(' ') || raw.startsWith('\t')) {
      newLine += 1
      valid.add(newLine)
    }
  }
  return valid
}

export function resolveDiffPath(requested: string, paths: string[]): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '')
  const r = norm(requested)
  const entries = paths.map((raw) => ({ raw, n: norm(raw) }))

  const exact = entries.find((x) => x.n === r)
  if (exact) return exact.raw

  const suffixMatches = entries.filter((x) => x.n.endsWith('/' + r) || r.endsWith('/' + x.n))
  if (suffixMatches.length === 1) return suffixMatches[0].raw

  const base = r.split('/').pop()
  if (!base) return null
  const baseMatches = entries.filter((x) => x.n.split('/').pop() === base)
  if (baseMatches.length === 1) return baseMatches[0].raw

  return null
}

export function snapToValidDiffLine(
  line: number,
  valid: ReadonlySet<number>,
  maxDistance = 5,
): number | null {
  if (valid.size === 0) return null
  if (valid.has(line)) return line

  let best = -1
  let bestDist = Infinity
  for (const v of valid) {
    const d = Math.abs(v - line)
    if (d < bestDist) {
      bestDist = d
      best = v
    }
  }
  return bestDist <= maxDistance ? best : null
}

export type NormalizeFindingsStats = {
  kept: number
  snapped: number
  droppedLine: number
  pathUnresolved: number
}

export function normalizeAiFindings(
  ai: AiReviewResult,
  validLinesByPath: Map<string, Set<number>>,
): { result: AiReviewResult; stats: NormalizeFindingsStats } {
  const paths = [...validLinesByPath.keys()]
  const stats: NormalizeFindingsStats = {
    kept: 0,
    snapped: 0,
    droppedLine: 0,
    pathUnresolved: 0,
  }

  const findings: AiFinding[] = ai.findings.map((f) => {
    if (f.line == null) return f

    const resolved = resolveDiffPath(f.path, paths)
    if (!resolved) {
      stats.pathUnresolved += 1
      return { ...f, line: null }
    }

    const valid = validLinesByPath.get(resolved)
    if (!valid || valid.size === 0) {
      stats.droppedLine += 1
      return { ...f, path: resolved, line: null }
    }

    const snapped = snapToValidDiffLine(f.line, valid)
    if (snapped == null) {
      stats.droppedLine += 1
      return { ...f, path: resolved, line: null }
    }

    if (snapped === f.line && resolved === f.path) {
      stats.kept += 1
      return f
    }
    if (snapped !== f.line) stats.snapped += 1
    else stats.kept += 1
    return { ...f, path: resolved, line: snapped }
  })

  return { result: { summary: ai.summary, findings }, stats }
}

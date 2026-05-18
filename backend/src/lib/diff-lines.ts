import type { AiFinding, AiReviewResult } from './llm.js'

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

export function normalizeFindingPaths(ai: AiReviewResult, changedPaths: string[]): AiReviewResult {
  const findings: AiFinding[] = []
  for (const f of ai.findings) {
    const resolved = resolveDiffPath(f.path, changedPaths)
    if (!resolved) continue
    findings.push({ ...f, path: resolved })
  }
  return { overview: ai.overview, findings }
}

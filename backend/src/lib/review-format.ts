import type { AiFinding, AiReviewResult, LlmRequestSizes } from './llm.js'

function fmtChars(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatLlmRequestSizeNote(sizes: LlmRequestSizes): string {
  return (
    `_LLM request size (characters, approximate; not tokens): ` +
    `user message ${fmtChars(sizes.userContentChars)}; ` +
    `overview call ${fmtChars(sizes.overviewRequestChars)}; ` +
    `code review call ${fmtChars(sizes.codeReviewRequestChars)}; ` +
    `total input ${fmtChars(sizes.totalInputChars)} (two API calls)._`
  )
}

export function formatOverviewBlock(overview: AiReviewResult['overview']): string {
  const parts: string[] = []

  if (overview.whatChanged) {
    parts.push('## What changed', overview.whatChanged)
  }
  if (overview.affectedAreas.length > 0) {
    parts.push('## Affected areas', ...overview.affectedAreas.map((a) => `- ${a}`))
  }
  if (overview.focusForReviewer) {
    parts.push('## Focus for reviewer', overview.focusForReviewer)
  }
  if (overview.priorityReview.length > 0) {
    parts.push('## Priority review', ...overview.priorityReview.map((p) => `- ${p}`))
  }
  if (overview.checklist.length > 0) {
    parts.push('## Reviewer checklist', ...overview.checklist.map((c) => `- [ ] ${c}`))
  }

  return parts.join('\n\n') || 'No overview generated.'
}

export function formatCodeReviewBlock(findings: AiFinding[]): string {
  if (findings.length === 0) return 'No issues reported.'

  const parts: string[] = []
  const byPath = new Map<string, AiFinding[]>()
  for (const f of findings) {
    const list = byPath.get(f.path) ?? []
    list.push(f)
    byPath.set(f.path, list)
  }

  for (const path of [...byPath.keys()].sort()) {
    const items = byPath.get(path)!
    parts.push(`### \`${path}\``)
    for (const f of items) {
      parts.push(`- **${f.severity}**: ${f.comment}`)
    }
  }

  return parts.join('\n\n')
}

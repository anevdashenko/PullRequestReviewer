import { Octokit } from '@octokit/rest'
import type { AiFinding, AiReviewResult } from './llm.js'

/** Shown in collapsed summary lines on GitHub (also used for search/filter). */
export const AI_REVIEW_TAG = '#AI review'

export const AI_REVIEW_OVERVIEW_SUMMARY = `${AI_REVIEW_TAG} — Overview for reviewer`
export const AI_REVIEW_CODE_SUMMARY = `${AI_REVIEW_TAG} — Code review`

function collapseBlock(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n</details>`
}

function formatOverviewBlock(overview: AiReviewResult['overview']): string {
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

function formatCodeReviewBlock(findings: AiFinding[]): string {
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

export function formatReviewBody(ai: AiReviewResult): string {
  const overviewBody = formatOverviewBlock(ai.overview)
  const codeBody = formatCodeReviewBlock(ai.findings)
  return [collapseBlock(AI_REVIEW_OVERVIEW_SUMMARY, overviewBody), collapseBlock(AI_REVIEW_CODE_SUMMARY, codeBody)].join(
    '\n\n',
  )
}

export async function submitGithubReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitId: string,
  ai: AiReviewResult,
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitId,
    body: formatReviewBody(ai),
    event: 'COMMENT',
  })
}

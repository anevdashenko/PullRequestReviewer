import { Octokit } from '@octokit/rest'
import type { AiReviewResult } from './llm.js'

type InlineComment = {
  path: string
  line: number
  body: string
}

export async function submitGithubReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitId: string,
  ai: AiReviewResult,
): Promise<void> {
  const inlineCandidates: InlineComment[] = []
  for (const f of ai.findings) {
    if (f.line != null && Number.isInteger(f.line) && f.line > 0) {
      inlineCandidates.push({
        path: f.path,
        line: f.line,
        body: `**${f.severity}**: ${f.comment}`,
      })
    }
  }
  const bodyParts = [ai.summary]
  for (const f of ai.findings) {
    if (f.line == null) {
      bodyParts.push(`- **${f.path}** (${f.severity}): ${f.comment}`)
    }
  }
  const body = bodyParts.filter(Boolean).join('\n\n') || 'No issues reported.'

  const maxInline = 20
  const inline = inlineCandidates.slice(0, maxInline)

  const base = {
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitId,
    body,
    event: 'COMMENT' as const,
  }

  if (inline.length === 0) {
    await octokit.pulls.createReview(base)
    return
  }

  try {
    await octokit.pulls.createReview({
      ...base,
      comments: inline.map((c) => ({
        path: c.path,
        line: c.line,
        side: 'RIGHT' as const,
        body: c.body,
      })),
    })
  } catch (e) {
    console.warn('Inline review failed; falling back to summary-only', e)
    await octokit.pulls.createReview(base)
  }
}

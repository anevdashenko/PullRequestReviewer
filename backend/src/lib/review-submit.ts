import { Octokit } from '@octokit/rest'
import type { AiReviewResult, LlmRequestSizes } from './llm.js'
import type { PipelineStepResult } from './review-llm/review-pipeline.js'
import {
  formatCodeReviewBlock,
  formatLlmRequestSizeNote,
  formatOverviewBlock,
  formatPipelineRequestSizeNote,
} from './review-format.js'

/** Shown in collapsed summary lines on GitHub (also used for search/filter). */
export const AI_REVIEW_TAG = '#AI review'

export const AI_REVIEW_OVERVIEW_SUMMARY = `${AI_REVIEW_TAG} — Overview for reviewer`
export const AI_REVIEW_CODE_SUMMARY = `${AI_REVIEW_TAG} — Code review`

function collapseBlock(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n</details>`
}

export function formatReviewBody(ai: AiReviewResult, sizes?: LlmRequestSizes): string {
  const overviewBody = formatOverviewBlock(ai.overview)
  const codeBody = formatCodeReviewBlock(ai.findings)
  const parts = [collapseBlock(AI_REVIEW_OVERVIEW_SUMMARY, overviewBody), collapseBlock(AI_REVIEW_CODE_SUMMARY, codeBody)]
  if (sizes) parts.push(formatLlmRequestSizeNote(sizes))
  return parts.join('\n\n')
}

export function formatPipelineReviewBody(steps: PipelineStepResult[], sizes?: LlmRequestSizes): string {
  const parts = steps.map((s) => collapseBlock(`${AI_REVIEW_TAG} — ${s.name}`, s.output))
  if (sizes) parts.push(formatPipelineRequestSizeNote(steps.length, sizes))
  return parts.join('\n\n')
}

export async function submitGithubReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitId: string,
  body: string,
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitId,
    body,
    event: 'COMMENT',
  })
}

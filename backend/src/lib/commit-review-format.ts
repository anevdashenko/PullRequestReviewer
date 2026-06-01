import type { AiReviewResult, LlmRequestSizes } from './llm.js'
import type { PipelineStepResult } from './review-llm/review-pipeline.js'
import {
  formatCodeReviewBlock,
  formatLlmRequestSizeNote,
  formatOverviewBlock,
  formatPipelineRequestSizeNote,
} from './review-format.js'

export type CommitMeta = {
  sha: string
  message: string
  url: string
}

export function formatCommitReviewMarkdown(
  owner: string,
  repo: string,
  branchName: string,
  authorLogin: string,
  periodStart: Date,
  periodEnd: Date,
  commits: CommitMeta[],
  ai: AiReviewResult,
  sizes?: LlmRequestSizes,
): string {
  const repoLabel = `${owner}/${repo}`
  const periodLabel = `${periodStart.toISOString()} — ${periodEnd.toISOString()}`
  const commitLines = commits.map((c) => {
    const short = c.sha.slice(0, 7)
    const subject = c.message.split('\n')[0] ?? c.message
    return `- [\`${short}\`](${c.url}) ${subject}`
  })

  const header = [
    `# Commit batch review`,
    ``,
    `**Repository:** ${repoLabel}`,
    `**Branch:** ${branchName}`,
    `**Author:** ${authorLogin}`,
    `**Period:** ${periodLabel}`,
    `**Commits (${commits.length}):**`,
    ...commitLines,
  ].join('\n')

  const overviewSection = ['## Что сделано', '', formatOverviewBlock(ai.overview)].join('\n')
  const codeSection = ['## Разбор кода', '', formatCodeReviewBlock(ai.findings)].join('\n')
  const parts = [header, overviewSection, codeSection]
  if (sizes) parts.push(formatLlmRequestSizeNote(sizes))

  return parts.join('\n\n')
}

export function formatCommitPipelineMarkdown(
  owner: string,
  repo: string,
  branchName: string,
  authorLogin: string,
  periodStart: Date,
  periodEnd: Date,
  commits: CommitMeta[],
  steps: PipelineStepResult[],
  sizes?: LlmRequestSizes,
): string {
  const repoLabel = `${owner}/${repo}`
  const periodLabel = `${periodStart.toISOString()} — ${periodEnd.toISOString()}`
  const commitLines = commits.map((c) => {
    const short = c.sha.slice(0, 7)
    const subject = c.message.split('\n')[0] ?? c.message
    return `- [\`${short}\`](${c.url}) ${subject}`
  })

  const header = [
    `# Commit batch review`,
    ``,
    `**Repository:** ${repoLabel}`,
    `**Branch:** ${branchName}`,
    `**Author:** ${authorLogin}`,
    `**Period:** ${periodLabel}`,
    `**Commits (${commits.length}):**`,
    ...commitLines,
  ].join('\n')

  const stepSections = steps.map((s) => [`## ${s.name}`, '', s.output].join('\n'))
  const parts = [header, ...stepSections]
  if (sizes) parts.push(formatPipelineRequestSizeNote(steps.length, sizes))

  return parts.join('\n\n')
}

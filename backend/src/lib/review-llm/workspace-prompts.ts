import { DEFAULT_WORKSPACE_INTRO } from './prompt-defaults.js'
import { resolveReviewPrompts, type ReviewRulePrompts } from './prompts.js'
import type { ReviewWorkspaceContext } from './types.js'

export function changedPathsBlock(paths: string[]): string {
  if (paths.length === 0) return 'Changed .cs files: (none detected in diff range)'
  const list = paths.slice(0, 50).join(', ')
  const more = paths.length > 50 ? ` (+${paths.length - 50} more)` : ''
  return `Changed .cs files in scope: ${list}${more}`
}

export function reviewTargetBlock(ws: ReviewWorkspaceContext): string {
  if (ws.prNumber != null) {
    return `Review pull request #${ws.prNumber} on branch \`${ws.branch}\` at commit \`${ws.sha}\`.`
  }
  if (ws.commitShas && ws.commitShas.length > 0) {
    const list = ws.commitShas.map((s) => s.slice(0, 7)).join(', ')
    return `Review commit batch on branch \`${ws.branch}\` (commits: ${list}), HEAD at \`${ws.sha}\`. This is not a pull request.`
  }
  return `Review branch \`${ws.branch}\` at commit \`${ws.sha}\`.`
}

function workspaceKind(ws: ReviewWorkspaceContext): 'pr' | 'batch' {
  return ws.prNumber != null ? 'pr' : 'batch'
}

export function buildWorkspaceOverviewPrompt(prompts: ReviewRulePrompts, ws: ReviewWorkspaceContext): string {
  const kind = workspaceKind(ws)
  const resolved = resolveReviewPrompts(prompts, kind)
  return [
    DEFAULT_WORKSPACE_INTRO,
    `Repository: ${ws.provider}/${ws.owner}/${ws.name}`,
    reviewTargetBlock(ws),
    changedPathsBlock(ws.changedPaths),
    '',
    resolved.overviewSystem,
    '',
    resolved.overviewJsonInstruction,
    kind === 'batch'
      ? 'Base everything on actual changes in this commit batch. Do not invent files.'
      : 'Base everything on actual changes in this revision. Do not invent files.',
  ].join('\n')
}

export function buildWorkspaceCodeReviewPrompt(prompts: ReviewRulePrompts, ws: ReviewWorkspaceContext): string {
  const kind = workspaceKind(ws)
  const resolved = resolveReviewPrompts(prompts, kind)
  return [
    DEFAULT_WORKSPACE_INTRO,
    `Repository: ${ws.provider}/${ws.owner}/${ws.name}`,
    reviewTargetBlock(ws),
    changedPathsBlock(ws.changedPaths),
    '',
    resolved.codeReviewSystem,
    '',
    resolved.codeReviewJsonInstruction,
    'Only comment on .cs files present in the change set.',
  ].join('\n')
}

export function buildWorkspaceStepPrompt(
  stepPrompt: string,
  systemPrompt: string,
  ws: ReviewWorkspaceContext,
): string {
  const parts = [
    DEFAULT_WORKSPACE_INTRO,
    `Repository: ${ws.provider}/${ws.owner}/${ws.name}`,
    reviewTargetBlock(ws),
    changedPathsBlock(ws.changedPaths),
    '',
  ]
  const rules = systemPrompt.trim()
  if (rules) {
    parts.push(`Repository rules:\n${rules}`, '')
  }
  parts.push(stepPrompt.trim())
  return parts.join('\n')
}

export function estimateWorkspacePromptChars(
  prompts: ReviewRulePrompts,
  ws: ReviewWorkspaceContext,
): {
  overviewRequestChars: number
  codeReviewRequestChars: number
} {
  return {
    overviewRequestChars: buildWorkspaceOverviewPrompt(prompts, ws).length,
    codeReviewRequestChars: buildWorkspaceCodeReviewPrompt(prompts, ws).length,
  }
}

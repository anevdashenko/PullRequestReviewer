import type { ProviderId } from '../../providers/types.js'
import type { ReviewKind, ReviewRulePrompts } from './prompts.js'

export type AiFinding = {
  severity: string
  path: string
  comment: string
}

export type AiOverview = {
  whatChanged: string
  affectedAreas: string[]
  focusForReviewer: string
  priorityReview: string[]
  checklist: string[]
}

export type AiReviewResult = {
  overview: AiOverview
  findings: AiFinding[]
}

/** Character counts of LLM chat request payloads (system + user per API call). */
export type LlmRequestSizes = {
  userContentChars: number
  overviewRequestChars: number
  codeReviewRequestChars: number
  totalInputChars: number
}

export type LlmProviderId = 'openai' | 'qwen-cli'

export type ReviewWorkspaceContext = {
  workspacePath: string
  provider: ProviderId
  owner: string
  name: string
  branch: string
  sha: string
  prNumber?: number
  commitShas?: string[]
  changedPaths: string[]
}

export type QwenCliLogAccumulator = {
  text: string
}

export type ReviewLlmInput = {
  model: string
  reviewKind: ReviewKind
  prompts: ReviewRulePrompts
  /** OpenAI provider: full diff text in prompt */
  userContent?: string
  /** Qwen CLI provider: local git workspace */
  workspace?: ReviewWorkspaceContext
  /** Qwen CLI: accumulates stdout/stderr across phases */
  qwenCliLog?: QwenCliLogAccumulator
  reviewLogId?: string
  commitBatchReviewId?: string
  /** Called after each Qwen CLI phase with full log so far */
  onQwenCliLogUpdate?: (log: string) => void | Promise<void>
}

export interface ReviewLlmProvider {
  readonly id: LlmProviderId
  assertReady(): void
  computeRequestSizes(input: ReviewLlmInput): LlmRequestSizes
  runOverview(input: ReviewLlmInput): Promise<AiOverview>
  runCodeReview(input: ReviewLlmInput): Promise<AiFinding[]>
}

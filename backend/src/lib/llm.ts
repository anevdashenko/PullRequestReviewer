/**
 * Backward-compatible re-exports. Prefer `review-llm` facade in worker.
 */
export type {
  AiFinding,
  AiOverview,
  AiReviewResult,
  LlmRequestSizes,
} from './review-llm/types.js'

export { parseLlmJsonPayload } from './review-llm/llm-parsers.js'
export { getReviewLlmProvider, resolveLlmProviderId } from './review-llm/index.js'
import { openaiReviewLlmProvider } from './review-llm/openai-provider.js'
import type { AiFinding, AiOverview, AiReviewResult } from './review-llm/types.js'

export function computeLlmRequestSizes(repoSystemPrompt: string, userContent: string) {
  return openaiReviewLlmProvider.computeRequestSizes({
    model: '',
    reviewKind: 'pr',
    prompts: { systemPrompt: repoSystemPrompt },
    userContent,
  })
}

export async function runLlmOverview(
  apiKey: string,
  model: string,
  repoSystemPrompt: string,
  userContent: string,
): Promise<AiOverview> {
  void apiKey
  return openaiReviewLlmProvider.runOverview({
    model,
    reviewKind: 'pr',
    prompts: { systemPrompt: repoSystemPrompt },
    userContent,
  })
}

export async function runLlmCodeReview(
  apiKey: string,
  model: string,
  repoSystemPrompt: string,
  userContent: string,
): Promise<AiFinding[]> {
  void apiKey
  return openaiReviewLlmProvider.runCodeReview({
    model,
    reviewKind: 'pr',
    prompts: { systemPrompt: repoSystemPrompt },
    userContent,
  })
}

export async function runFullPrReview(
  apiKey: string,
  model: string,
  repoSystemPrompt: string,
  userContent: string,
): Promise<AiReviewResult> {
  void apiKey
  const prompts = { systemPrompt: repoSystemPrompt }
  const overview = await openaiReviewLlmProvider.runOverview({ model, reviewKind: 'pr', prompts, userContent })
  const findings = await openaiReviewLlmProvider.runCodeReview({ model, reviewKind: 'pr', prompts, userContent })
  return { overview, findings }
}

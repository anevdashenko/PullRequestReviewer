import { openaiReviewLlmProvider } from './openai-provider.js'
import { assertQwenCliReady, getQwenCliStartupInfo, qwenCliReviewLlmProvider } from './qwen-cli-provider.js'
import { getRepoCacheRoot } from '../repo-cache/index.js'
import type {
  AiFinding,
  AiOverview,
  AiReviewResult,
  LlmProviderId,
  LlmRequestSizes,
  ReviewLlmInput,
  ReviewLlmProvider,
  ReviewWorkspaceContext,
} from './types.js'

export type {
  AiFinding,
  AiOverview,
  AiReviewResult,
  LlmProviderId,
  LlmRequestSizes,
  ReviewLlmInput,
  ReviewLlmProvider,
  ReviewWorkspaceContext,
}

export { parseLlmJsonPayload } from './llm-parsers.js'
export type { ReviewKind, ReviewRulePrompts } from './prompts.js'
export { JSON_SCHEMA_PLACEHOLDER } from './prompt-defaults.js'

let cachedProvider: ReviewLlmProvider | null = null

export function resolveLlmProviderId(): LlmProviderId {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase() || 'openai'
  if (raw === 'openai' || raw === 'qwen-cli') return raw
  throw new Error(`Unknown LLM_PROVIDER "${raw}" (use "openai" or "qwen-cli")`)
}

export function getReviewLlmProvider(): ReviewLlmProvider {
  if (cachedProvider) return cachedProvider
  const id = resolveLlmProviderId()
  cachedProvider = id === 'qwen-cli' ? qwenCliReviewLlmProvider : openaiReviewLlmProvider
  return cachedProvider
}

/** Call at worker startup; validates provider config for the active LLM_PROVIDER. */
export async function assertReviewLlmReady(): Promise<void> {
  const provider = getReviewLlmProvider()
  if (provider.id === 'qwen-cli') {
    await assertQwenCliReady()
  } else {
    provider.assertReady()
  }
}

export function getReviewLlmStartupInfo(): Record<string, unknown> {
  const id = resolveLlmProviderId()
  return {
    llmProvider: id,
    repoCacheRoot: getRepoCacheRoot(),
    ...(id === 'qwen-cli' ? getQwenCliStartupInfo() : {}),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasOpenAiBaseUrl: Boolean(process.env.OPENAI_BASE_URL?.trim()),
  }
}

export async function runFullReview(input: ReviewLlmInput): Promise<AiReviewResult> {
  const llm = getReviewLlmProvider()
  llm.assertReady()
  const overview = await llm.runOverview(input)
  const findings = await llm.runCodeReview(input)
  return { overview, findings }
}

import OpenAI from 'openai'
import { parseFindings, parseLlmJsonPayload, parseOverview } from './llm-parsers.js'
import { computePhaseRequestSizes, resolveReviewPrompts } from './prompts.js'
import type { AiFinding, AiOverview, LlmRequestSizes, ReviewLlmInput, ReviewLlmProvider } from './types.js'

function useJsonObjectResponseFormat(): boolean {
  const v = process.env.OPENAI_JSON_OBJECT_MODE?.trim().toLowerCase()
  if (v) return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
  if (process.env.OPENAI_BASE_URL?.trim()) return false
  return true
}

function resolveApiKey(): string {
  const baseUrl = process.env.OPENAI_BASE_URL?.trim()
  const apiKey = process.env.OPENAI_API_KEY?.trim() || (baseUrl ? 'local' : '')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set (for a local OpenAI-compatible server set OPENAI_BASE_URL)')
  }
  return apiKey
}

async function runLlmJsonPhase(
  apiKey: string,
  model: string,
  systemPrompt: string,
  jsonInstruction: string,
  userContent: string,
): Promise<Record<string, unknown>> {
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined
  const client = new OpenAI({ apiKey, baseURL })
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${jsonInstruction}` },
      { role: 'user', content: userContent },
    ],
    ...(useJsonObjectResponseFormat() ? { response_format: { type: 'json_object' as const } } : {}),
    temperature: 0.3,
  })
  const raw = completion.choices[0]?.message?.content
  if (!raw) throw new Error('Empty LLM response')
  const parsed = parseLlmJsonPayload(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid LLM JSON')
  return parsed as Record<string, unknown>
}

export const openaiReviewLlmProvider: ReviewLlmProvider = {
  id: 'openai',

  assertReady(): void {
    resolveApiKey()
  },

  computeRequestSizes(input: ReviewLlmInput): LlmRequestSizes {
    const userContent = input.userContent ?? ''
    const phases = computePhaseRequestSizes(input.prompts, input.reviewKind, userContent)
    return {
      userContentChars: userContent.length,
      ...phases,
      totalInputChars: phases.overviewRequestChars + phases.codeReviewRequestChars,
    }
  },

  async runOverview(input: ReviewLlmInput): Promise<AiOverview> {
    if (!input.userContent) throw new Error('OpenAI provider requires userContent with diff text')
    const apiKey = resolveApiKey()
    const resolved = resolveReviewPrompts(input.prompts, input.reviewKind)
    const obj = await runLlmJsonPhase(
      apiKey,
      input.model,
      resolved.overviewSystem,
      resolved.overviewJsonInstruction,
      input.userContent,
    )
    return parseOverview(obj)
  },

  async runCodeReview(input: ReviewLlmInput): Promise<AiFinding[]> {
    if (!input.userContent) throw new Error('OpenAI provider requires userContent with diff text')
    const apiKey = resolveApiKey()
    const resolved = resolveReviewPrompts(input.prompts, input.reviewKind)
    const obj = await runLlmJsonPhase(
      apiKey,
      input.model,
      resolved.codeReviewSystem,
      resolved.codeReviewJsonInstruction,
      input.userContent,
    )
    return parseFindings(obj)
  },
}

import { parseFindingsFromRaw, parseOverviewFromRaw } from './llm-parsers.js'
import { runReviewPipelineSteps } from './pipeline-runner.js'
import {
  computePipelineRequestSizes,
  resolveReviewPipeline,
  type ReviewPipelineConfig,
} from './review-pipeline.js'
import type { PipelineStepResult } from './review-pipeline.js'
import {
  assertQwenCliEnvironment,
  assertQwenCliReady,
  getQwenCliStartupInfo,
  persistQwenCliPhaseLog,
  runQwenCli,
} from './qwen-cli-runner.js'
import {
  buildWorkspaceCodeReviewPrompt,
  buildWorkspaceOverviewPrompt,
  estimateWorkspacePromptChars,
} from './workspace-prompts.js'
import type { QwenCliLogContext } from './qwen-cli-log.js'
import type { AiFinding, AiOverview, LlmRequestSizes, ReviewLlmInput, ReviewLlmProvider } from './types.js'

export { assertQwenCliReady, getQwenCliStartupInfo, runReviewPipelineSteps }

function requireWorkspace(input: ReviewLlmInput) {
  if (!input.workspace) {
    throw new Error('Qwen CLI provider requires workspace context (sync repo cache first)')
  }
  return input.workspace
}

function logContext(input: ReviewLlmInput, phase: string): QwenCliLogContext {
  return {
    phase,
    reviewLogId: input.reviewLogId,
    commitBatchReviewId: input.commitBatchReviewId,
    workspacePath: input.workspace?.workspacePath,
  }
}

export const qwenCliReviewLlmProvider: ReviewLlmProvider = {
  id: 'qwen-cli',

  assertReady(): void {
    assertQwenCliEnvironment()
  },

  computeRequestSizes(input: ReviewLlmInput): LlmRequestSizes {
    const ws = requireWorkspace(input)
    const phases = estimateWorkspacePromptChars(input.prompts, ws)
    return {
      userContentChars: 0,
      ...phases,
      totalInputChars: phases.overviewRequestChars + phases.codeReviewRequestChars,
    }
  },

  async runOverview(input: ReviewLlmInput): Promise<AiOverview> {
    const ws = requireWorkspace(input)
    const ctx = logContext(input, 'overview')
    const prompt = buildWorkspaceOverviewPrompt(input.prompts, ws)
    const { stdout, logSection } = await runQwenCli(prompt, ws.workspacePath, ctx)
    await persistQwenCliPhaseLog(input, 'overview', logSection)
    return parseOverviewFromRaw(stdout)
  },

  async runCodeReview(input: ReviewLlmInput): Promise<AiFinding[]> {
    const ws = requireWorkspace(input)
    const ctx = logContext(input, 'code_review')
    const prompt = buildWorkspaceCodeReviewPrompt(input.prompts, ws)
    const { stdout, logSection } = await runQwenCli(prompt, ws.workspacePath, ctx)
    await persistQwenCliPhaseLog(input, 'code_review', logSection)
    return parseFindingsFromRaw(stdout)
  },
}

export function computeQwenPipelineRequestSizes(
  pipeline: ReviewPipelineConfig,
  systemPrompt: string,
  input: ReviewLlmInput,
): LlmRequestSizes {
  const ws = requireWorkspace(input)
  return computePipelineRequestSizes(pipeline, systemPrompt, ws)
}

export function resolveQwenReviewPipeline(stored: unknown | null | undefined): ReviewPipelineConfig {
  return resolveReviewPipeline(stored)
}

export type { PipelineStepResult }

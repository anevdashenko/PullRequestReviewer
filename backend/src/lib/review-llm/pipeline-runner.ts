import {
  appendQwenCliLogSection,
  type QwenCliLogContext,
  writeQwenCliLogFile,
} from './qwen-cli-log.js'
import {
  buildStepFullPrompt,
  enabledPipelineSteps,
  type PipelineStepResult,
  type ReviewPipelineConfig,
} from './review-pipeline.js'
import { runQwenCli } from './qwen-cli-runner.js'
import type { ReviewLlmInput } from './types.js'

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

function jobKey(input: ReviewLlmInput): string {
  return input.reviewLogId ?? input.commitBatchReviewId ?? 'unknown'
}

export async function runReviewPipelineSteps(
  pipeline: ReviewPipelineConfig,
  systemPrompt: string,
  input: ReviewLlmInput,
  onStep?: (stepId: string, extra?: Record<string, unknown>) => void,
): Promise<PipelineStepResult[]> {
  const ws = requireWorkspace(input)
  const steps = enabledPipelineSteps(pipeline)
  if (steps.length === 0) {
    throw new Error('Review pipeline has no enabled steps')
  }

  if (!input.qwenCliLog) {
    input.qwenCliLog = { text: '' }
  }

  const results: PipelineStepResult[] = []

  for (const step of steps) {
    onStep?.(`llm_pipeline_${step.id}`, { stepId: step.id, stepName: step.name })
    const prompt = buildStepFullPrompt(step, systemPrompt, ws)
    const ctx = logContext(input, step.id)
    const { stdout, logSection } = await runQwenCli(prompt, ws.workspacePath, ctx)
    input.qwenCliLog.text = appendQwenCliLogSection(input.qwenCliLog.text, logSection)
    writeQwenCliLogFile(jobKey(input), step.id, logSection)
    if (input.onQwenCliLogUpdate) {
      await input.onQwenCliLogUpdate(input.qwenCliLog.text)
    }
    results.push({ id: step.id, name: step.name, output: stdout })
  }

  return results
}

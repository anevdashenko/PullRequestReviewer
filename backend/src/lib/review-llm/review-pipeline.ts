import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PR_CODE_REVIEW_PROMPT,
  DEFAULT_PR_OVERVIEW_PROMPT,
} from './prompt-defaults.js'
import { resolveReviewPrompts } from './prompts.js'
import { buildWorkspaceStepPrompt } from './workspace-prompts.js'
import type { ReviewWorkspaceContext } from './types.js'
import type { LlmRequestSizes } from './types.js'

export type ReviewPipelineStep = {
  id: string
  name: string
  enabled: boolean
  prompt: string
}

export type ReviewPipelineConfig = {
  version: 1
  steps: ReviewPipelineStep[]
}

export type PipelineStepResult = {
  id: string
  name: string
  output: string
}

function repoRootFromModule(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../../..')
}

function defaultPipelinePath(): string {
  return join(repoRootFromModule(), 'config', 'review-pipeline.default.json')
}

function buildDefaultStepPrompts(): { overview: string; codeReview: string } {
  const resolved = resolveReviewPrompts({ systemPrompt: '' }, 'pr')
  return {
    overview: [
      DEFAULT_PR_OVERVIEW_PROMPT,
      '',
      resolved.overviewJsonInstruction,
      'Base everything on actual changes in this revision. Do not invent files.',
    ].join('\n'),
    codeReview: [
      DEFAULT_PR_CODE_REVIEW_PROMPT,
      '',
      resolved.codeReviewJsonInstruction,
      'Only comment on .cs files present in the change set.',
    ].join('\n'),
  }
}

export function buildDefaultReviewPipeline(): ReviewPipelineConfig {
  const { overview, codeReview } = buildDefaultStepPrompts()
  return {
    version: 1,
    steps: [
      {
        id: 'overview',
        name: 'Overview for reviewer',
        enabled: true,
        prompt: overview,
      },
      {
        id: 'code-review',
        name: 'Code review',
        enabled: true,
        prompt: codeReview,
      },
    ],
  }
}

export function parseReviewPipeline(value: unknown): ReviewPipelineConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('reviewPipeline must be a JSON object')
  }
  const obj = value as Record<string, unknown>
  if (obj.version !== 1) {
    throw new Error('reviewPipeline.version must be 1')
  }
  if (!Array.isArray(obj.steps)) {
    throw new Error('reviewPipeline.steps must be an array')
  }
  const steps: ReviewPipelineStep[] = []
  for (let i = 0; i < obj.steps.length; i++) {
    const raw = obj.steps[i]
    if (!raw || typeof raw !== 'object') {
      throw new Error(`reviewPipeline.steps[${i}] must be an object`)
    }
    const step = raw as Record<string, unknown>
    if (typeof step.id !== 'string' || !step.id.trim()) {
      throw new Error(`reviewPipeline.steps[${i}].id must be a non-empty string`)
    }
    if (typeof step.name !== 'string' || !step.name.trim()) {
      throw new Error(`reviewPipeline.steps[${i}].name must be a non-empty string`)
    }
    if (typeof step.enabled !== 'boolean') {
      throw new Error(`reviewPipeline.steps[${i}].enabled must be a boolean`)
    }
    if (typeof step.prompt !== 'string') {
      throw new Error(`reviewPipeline.steps[${i}].prompt must be a string`)
    }
    steps.push({
      id: step.id.trim(),
      name: step.name.trim(),
      enabled: step.enabled,
      prompt: step.prompt,
    })
  }
  return { version: 1, steps }
}

export function loadDefaultReviewPipeline(): ReviewPipelineConfig {
  const path = defaultPipelinePath()
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
      return parseReviewPipeline(raw)
    } catch {
      return buildDefaultReviewPipeline()
    }
  }
  return buildDefaultReviewPipeline()
}

export function resolveReviewPipeline(stored: unknown | null | undefined): ReviewPipelineConfig {
  if (stored == null) {
    return loadDefaultReviewPipeline()
  }
  try {
    return parseReviewPipeline(stored)
  } catch {
    return loadDefaultReviewPipeline()
  }
}

export function enabledPipelineSteps(config: ReviewPipelineConfig): ReviewPipelineStep[] {
  return config.steps.filter((s) => s.enabled)
}

export function buildStepFullPrompt(
  step: ReviewPipelineStep,
  systemPrompt: string,
  ws: ReviewWorkspaceContext,
): string {
  return buildWorkspaceStepPrompt(step.prompt, systemPrompt, ws)
}

export function computePipelineRequestSizes(
  config: ReviewPipelineConfig,
  systemPrompt: string,
  ws: ReviewWorkspaceContext,
): LlmRequestSizes {
  let total = 0
  for (const step of config.steps) {
    if (!step.enabled) continue
    total += buildStepFullPrompt(step, systemPrompt, ws).length
  }
  return {
    userContentChars: 0,
    overviewRequestChars: total,
    codeReviewRequestChars: 0,
    totalInputChars: total,
  }
}

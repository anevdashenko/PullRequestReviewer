import { Prisma, type ReviewRule } from '@prisma/client'
import {
  CODE_REVIEW_JSON_SCHEMA,
  DEFAULT_AUTONOMOUS_REVIEW_RULES,
  DEFAULT_BATCH_CODE_REVIEW_PROMPT,
  DEFAULT_BATCH_OVERVIEW_PROMPT,
  DEFAULT_CODE_REVIEW_JSON_PROMPT,
  DEFAULT_OVERVIEW_JSON_PROMPT,
  DEFAULT_PR_CODE_REVIEW_PROMPT,
  DEFAULT_PR_OVERVIEW_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  JSON_SCHEMA_PLACEHOLDER,
  OVERVIEW_JSON_SCHEMA_BATCH,
  OVERVIEW_JSON_SCHEMA_PR,
} from './prompt-defaults.js'
import {
  loadDefaultReviewPipeline,
  parseReviewPipeline,
  resolveReviewPipeline,
  type ReviewPipelineConfig,
} from './review-pipeline.js'

export function optionalPromptField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t.length > 0 ? t : null
}

export function reviewRulesToApi(rules: ReviewRule) {
  return {
    systemPrompt: rules.systemPrompt,
    excludeGlobs: rules.excludeGlobs,
    model: rules.model,
    reviewPipeline: resolveReviewPipeline(rules.reviewPipeline),
    prOverviewPrompt: rules.prOverviewPrompt,
    prCodeReviewPrompt: rules.prCodeReviewPrompt,
    batchOverviewPrompt: rules.batchOverviewPrompt,
    batchCodeReviewPrompt: rules.batchCodeReviewPrompt,
    overviewJsonPrompt: rules.overviewJsonPrompt,
    codeReviewJsonPrompt: rules.codeReviewJsonPrompt,
    batchOverviewJsonPrompt: rules.batchOverviewJsonPrompt,
    batchCodeReviewJsonPrompt: rules.batchCodeReviewJsonPrompt,
    jsonSchemaPlaceholder: JSON_SCHEMA_PLACEHOLDER,
    defaults: {
      defaultReviewPipeline: loadDefaultReviewPipeline(),
      autonomousReviewRules: DEFAULT_AUTONOMOUS_REVIEW_RULES,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      prOverviewPrompt: DEFAULT_PR_OVERVIEW_PROMPT,
      prCodeReviewPrompt: DEFAULT_PR_CODE_REVIEW_PROMPT,
      batchOverviewPrompt: DEFAULT_BATCH_OVERVIEW_PROMPT,
      batchCodeReviewPrompt: DEFAULT_BATCH_CODE_REVIEW_PROMPT,
      overviewJsonPrompt: DEFAULT_OVERVIEW_JSON_PROMPT,
      codeReviewJsonPrompt: DEFAULT_CODE_REVIEW_JSON_PROMPT,
      overviewJsonSchemaPr: OVERVIEW_JSON_SCHEMA_PR,
      overviewJsonSchemaBatch: OVERVIEW_JSON_SCHEMA_BATCH,
      codeReviewJsonSchema: CODE_REVIEW_JSON_SCHEMA,
    },
  }
}

export type ReviewRulesPutBody = {
  systemPrompt?: string
  excludeGlobs?: string[]
  model?: string
  reviewPipeline?: ReviewPipelineConfig | null
  prOverviewPrompt?: string | null
  prCodeReviewPrompt?: string | null
  batchOverviewPrompt?: string | null
  batchCodeReviewPrompt?: string | null
  overviewJsonPrompt?: string | null
  codeReviewJsonPrompt?: string | null
  batchOverviewJsonPrompt?: string | null
  batchCodeReviewJsonPrompt?: string | null
}

export function reviewRulesPutData(body: ReviewRulesPutBody): {
  systemPrompt?: string
  excludeGlobs?: Prisma.InputJsonValue
  model?: string
  reviewPipeline?: Prisma.InputJsonValue | typeof Prisma.JsonNull
  prOverviewPrompt?: string | null
  prCodeReviewPrompt?: string | null
  batchOverviewPrompt?: string | null
  batchCodeReviewPrompt?: string | null
  overviewJsonPrompt?: string | null
  codeReviewJsonPrompt?: string | null
  batchOverviewJsonPrompt?: string | null
  batchCodeReviewJsonPrompt?: string | null
} {
  const data: ReturnType<typeof reviewRulesPutData> = {}
  if (typeof body.systemPrompt === 'string') data.systemPrompt = body.systemPrompt
  if (Array.isArray(body.excludeGlobs)) data.excludeGlobs = body.excludeGlobs
  if (typeof body.model === 'string' && body.model.trim()) data.model = body.model.trim()

  const prOverview = optionalPromptField(body.prOverviewPrompt)
  if (prOverview !== undefined) data.prOverviewPrompt = prOverview
  const prCode = optionalPromptField(body.prCodeReviewPrompt)
  if (prCode !== undefined) data.prCodeReviewPrompt = prCode
  const batchOverview = optionalPromptField(body.batchOverviewPrompt)
  if (batchOverview !== undefined) data.batchOverviewPrompt = batchOverview
  const batchCode = optionalPromptField(body.batchCodeReviewPrompt)
  if (batchCode !== undefined) data.batchCodeReviewPrompt = batchCode
  const overviewJson = optionalPromptField(body.overviewJsonPrompt)
  if (overviewJson !== undefined) data.overviewJsonPrompt = overviewJson
  const codeJson = optionalPromptField(body.codeReviewJsonPrompt)
  if (codeJson !== undefined) data.codeReviewJsonPrompt = codeJson
  const batchOverviewJson = optionalPromptField(body.batchOverviewJsonPrompt)
  if (batchOverviewJson !== undefined) data.batchOverviewJsonPrompt = batchOverviewJson
  const batchCodeJson = optionalPromptField(body.batchCodeReviewJsonPrompt)
  if (batchCodeJson !== undefined) data.batchCodeReviewJsonPrompt = batchCodeJson

  if (body.reviewPipeline !== undefined) {
    if (body.reviewPipeline === null) {
      data.reviewPipeline = Prisma.JsonNull
    } else {
      data.reviewPipeline = parseReviewPipeline(body.reviewPipeline) as Prisma.InputJsonValue
    }
  }

  return data
}


import {
  CODE_REVIEW_JSON_SCHEMA,
  DEFAULT_BATCH_CODE_REVIEW_PROMPT,
  DEFAULT_BATCH_OVERVIEW_PROMPT,
  DEFAULT_CODE_REVIEW_JSON_PROMPT,
  DEFAULT_OVERVIEW_JSON_PROMPT,
  DEFAULT_PR_CODE_REVIEW_PROMPT,
  DEFAULT_PR_OVERVIEW_PROMPT,
  JSON_SCHEMA_PLACEHOLDER,
  OVERVIEW_JSON_SCHEMA_BATCH,
  OVERVIEW_JSON_SCHEMA_PR,
} from './prompt-defaults.js'

export type ReviewKind = 'pr' | 'batch'

/** Prompt fields stored per repository (ReviewRule). Empty/null → built-in default. */
export type ReviewRulePrompts = {
  systemPrompt: string
  prOverviewPrompt?: string | null
  prCodeReviewPrompt?: string | null
  batchOverviewPrompt?: string | null
  batchCodeReviewPrompt?: string | null
  overviewJsonPrompt?: string | null
  codeReviewJsonPrompt?: string | null
  batchOverviewJsonPrompt?: string | null
  batchCodeReviewJsonPrompt?: string | null
}

export type ResolvedPhasePrompts = {
  overviewSystem: string
  codeReviewSystem: string
  overviewJsonInstruction: string
  codeReviewJsonInstruction: string
}

function appendRepoRules(base: string, systemPrompt: string): string {
  const rules = systemPrompt.trim()
  return rules ? `${base}\n\nRepository rules:\n${rules}` : base
}

function pickText(value: string | null | undefined, fallback: string): string {
  const t = value?.trim()
  return t ? t : fallback
}

function applyJsonSchema(template: string, schema: string): string {
  if (template.includes(JSON_SCHEMA_PLACEHOLDER)) {
    return template.split(JSON_SCHEMA_PLACEHOLDER).join(schema)
  }
  return `${template.trim()}\n\nShape (JSON only):\n${schema}`
}

export function resolveReviewPrompts(rules: ReviewRulePrompts, kind: ReviewKind): ResolvedPhasePrompts {
  const overviewBase =
    kind === 'batch'
      ? pickText(rules.batchOverviewPrompt, DEFAULT_BATCH_OVERVIEW_PROMPT)
      : pickText(rules.prOverviewPrompt, DEFAULT_PR_OVERVIEW_PROMPT)
  const codeReviewBase =
    kind === 'batch'
      ? pickText(rules.batchCodeReviewPrompt, DEFAULT_BATCH_CODE_REVIEW_PROMPT)
      : pickText(rules.prCodeReviewPrompt, DEFAULT_PR_CODE_REVIEW_PROMPT)

  const overviewJsonTemplate =
    kind === 'batch'
      ? pickText(rules.batchOverviewJsonPrompt, pickText(rules.overviewJsonPrompt, DEFAULT_OVERVIEW_JSON_PROMPT))
      : pickText(rules.overviewJsonPrompt, DEFAULT_OVERVIEW_JSON_PROMPT)
  const codeReviewJsonTemplate =
    kind === 'batch'
      ? pickText(
          rules.batchCodeReviewJsonPrompt,
          pickText(rules.codeReviewJsonPrompt, DEFAULT_CODE_REVIEW_JSON_PROMPT),
        )
      : pickText(rules.codeReviewJsonPrompt, DEFAULT_CODE_REVIEW_JSON_PROMPT)

  const overviewSchema = kind === 'batch' ? OVERVIEW_JSON_SCHEMA_BATCH : OVERVIEW_JSON_SCHEMA_PR

  return {
    overviewSystem: appendRepoRules(overviewBase, rules.systemPrompt),
    codeReviewSystem: appendRepoRules(codeReviewBase, rules.systemPrompt),
    overviewJsonInstruction: applyJsonSchema(overviewJsonTemplate, overviewSchema),
    codeReviewJsonInstruction: applyJsonSchema(codeReviewJsonTemplate, CODE_REVIEW_JSON_SCHEMA),
  }
}

export function buildPhasePrompt(systemPrompt: string, jsonInstruction: string, userContent: string): string {
  return `${systemPrompt}\n\n${jsonInstruction}\n\n---\n\n${userContent}`
}

function llmRequestCharCount(systemPrompt: string, jsonInstruction: string, userContent: string): number {
  return `${systemPrompt}\n\n${jsonInstruction}`.length + userContent.length
}

export function computePhaseRequestSizes(
  rules: ReviewRulePrompts,
  kind: ReviewKind,
  userContent: string,
): { overviewRequestChars: number; codeReviewRequestChars: number } {
  const resolved = resolveReviewPrompts(rules, kind)
  return {
    overviewRequestChars: llmRequestCharCount(resolved.overviewSystem, resolved.overviewJsonInstruction, userContent),
    codeReviewRequestChars: llmRequestCharCount(
      resolved.codeReviewSystem,
      resolved.codeReviewJsonInstruction,
      userContent,
    ),
  }
}

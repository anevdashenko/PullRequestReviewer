import type { ReviewRule } from '@prisma/client'
import type { ReviewRulePrompts } from './prompts.js'

export function reviewRuleToPrompts(rules: ReviewRule): ReviewRulePrompts {
  return {
    systemPrompt: rules.systemPrompt,
    prOverviewPrompt: rules.prOverviewPrompt,
    prCodeReviewPrompt: rules.prCodeReviewPrompt,
    batchOverviewPrompt: rules.batchOverviewPrompt,
    batchCodeReviewPrompt: rules.batchCodeReviewPrompt,
    overviewJsonPrompt: rules.overviewJsonPrompt,
    codeReviewJsonPrompt: rules.codeReviewJsonPrompt,
    batchOverviewJsonPrompt: rules.batchOverviewJsonPrompt,
    batchCodeReviewJsonPrompt: rules.batchCodeReviewJsonPrompt,
  }
}

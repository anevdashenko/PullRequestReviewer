-- Per-repository review prompts (PR vs commit batch); JSON shape uses {{JSON_SCHEMA}} placeholder in app code.
ALTER TABLE "ReviewRule" ADD COLUMN "prOverviewPrompt" TEXT;
ALTER TABLE "ReviewRule" ADD COLUMN "prCodeReviewPrompt" TEXT;
ALTER TABLE "ReviewRule" ADD COLUMN "batchOverviewPrompt" TEXT;
ALTER TABLE "ReviewRule" ADD COLUMN "batchCodeReviewPrompt" TEXT;
ALTER TABLE "ReviewRule" ADD COLUMN "overviewJsonPrompt" TEXT;
ALTER TABLE "ReviewRule" ADD COLUMN "codeReviewJsonPrompt" TEXT;
ALTER TABLE "ReviewRule" ADD COLUMN "batchOverviewJsonPrompt" TEXT;
ALTER TABLE "ReviewRule" ADD COLUMN "batchCodeReviewJsonPrompt" TEXT;

-- AlterTable
ALTER TABLE "CommitBatchReview" ADD COLUMN "branchName" TEXT NOT NULL DEFAULT '';

-- Backfill legacy rows (pre-branch reviews) with a sentinel branch name
UPDATE "CommitBatchReview" SET "branchName" = 'main' WHERE "branchName" = '';

-- AlterTable
ALTER TABLE "ReviewedCommit" ADD COLUMN "branchName" TEXT NOT NULL DEFAULT '';

UPDATE "ReviewedCommit" SET "branchName" = 'main' WHERE "branchName" = '';

-- DropIndex
DROP INDEX "ReviewedCommit_repoId_sha_key";

-- CreateIndex
CREATE UNIQUE INDEX "ReviewedCommit_repoId_sha_branchName_key" ON "ReviewedCommit"("repoId", "sha", "branchName");

-- CreateIndex
CREATE INDEX "CommitBatchReview_repoId_branchName_createdAt_idx" ON "CommitBatchReview"("repoId", "branchName", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewedCommit_repoId_branchName_idx" ON "ReviewedCommit"("repoId", "branchName");

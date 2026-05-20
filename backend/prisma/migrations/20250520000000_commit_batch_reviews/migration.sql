-- AlterTable
ALTER TABLE "Repository" ADD COLUMN "commitReviewEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CommitBatchReview" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "authorEmail" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "commitShas" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "mdContent" TEXT,
    "rawAiOutput" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CommitBatchReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewedCommit" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "commitBatchReviewId" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewedCommit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitBatchReview_repoId_createdAt_idx" ON "CommitBatchReview"("repoId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewedCommit_repoId_idx" ON "ReviewedCommit"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewedCommit_repoId_sha_key" ON "ReviewedCommit"("repoId", "sha");

-- AddForeignKey
ALTER TABLE "CommitBatchReview" ADD CONSTRAINT "CommitBatchReview_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewedCommit" ADD CONSTRAINT "ReviewedCommit_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewedCommit" ADD CONSTRAINT "ReviewedCommit_commitBatchReviewId_fkey" FOREIGN KEY ("commitBatchReviewId") REFERENCES "CommitBatchReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

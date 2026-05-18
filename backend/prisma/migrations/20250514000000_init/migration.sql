-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRule" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "excludeGlobs" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',

    CONSTRAINT "ReviewRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "commitSha" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "rawAiOutput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_provider_owner_name_key" ON "Repository"("provider", "owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRule_repoId_key" ON "ReviewRule"("repoId");

-- CreateIndex
CREATE INDEX "ReviewLog_repoId_createdAt_idx" ON "ReviewLog"("repoId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewRule" ADD CONSTRAINT "ReviewRule_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

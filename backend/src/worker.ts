import { Worker } from 'bullmq'
import { prisma } from './db.js'
import {
  COMMIT_REVIEW_QUEUE,
  PR_REVIEW_QUEUE,
  redisConnection,
  type CommitReviewJobData,
  type ReviewJobData,
} from './queue.js'
import { formatCommitReviewMarkdown } from './lib/commit-review-format.js'
import { normalizeFindingPaths } from './lib/diff-lines.js'
import { includeFullFileContent } from './lib/defaults.js'
import { syncWorkspace } from './lib/repo-cache/index.js'
import {
  assertReviewLlmReady,
  getReviewLlmProvider,
  getReviewLlmStartupInfo,
  resolveLlmProviderId,
} from './lib/review-llm/index.js'
import type { ReviewLlmInput, ReviewWorkspaceContext } from './lib/review-llm/index.js'
import { reviewRuleToPrompts } from './lib/review-llm/prompt-fields.js'
import { DEFAULT_BATCH_OPENAI_USER_INTRO } from './lib/review-llm/prompt-defaults.js'
import type { ReviewRule } from '@prisma/client'
import { workerLog, shortSha } from './lib/logger.js'
import { getProvider } from './providers/index.js'
import type { ProviderId } from './providers/types.js'

function parseExcludeGlobs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string')
}

function parseCommitShas(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string')
}

function fullFileContextHint(): string {
  if (!includeFullFileContent()) return ''
  return 'Note: Some files include ### Full file (HEAD) for context; use ### Diff for what changed.\n\n'
}

function llmInputFromRules(rules: ReviewRule, reviewKind: 'pr' | 'batch'): Pick<ReviewLlmInput, 'model' | 'reviewKind' | 'prompts'> {
  return { model: rules.model, reviewKind, prompts: reviewRuleToPrompts(rules) }
}

async function runLlmReviewPhases(
  rules: ReviewRule,
  input: ReviewLlmInput,
  logExtra: Record<string, unknown>,
  step: (name: string, extra?: Record<string, unknown>) => void,
): Promise<{
  overview: Awaited<ReturnType<ReturnType<typeof getReviewLlmProvider>['runOverview']>>
  findings: Awaited<ReturnType<ReturnType<typeof getReviewLlmProvider>['runCodeReview']>>
  requestSizes: ReturnType<ReturnType<typeof getReviewLlmProvider>['computeRequestSizes']>
  overviewStarted: number
  codeReviewStarted: number
  qwenCliLog: string | null
}> {
  const llm = getReviewLlmProvider()
  llm.assertReady()
  if (llm.id === 'qwen-cli') {
    input.qwenCliLog = input.qwenCliLog ?? { text: '' }
  }
  const requestSizes = llm.computeRequestSizes(input)

  step('llm_overview', { model: rules.model, llmProvider: llm.id, ...logExtra })
  const overviewStarted = Date.now()
  const overview = await llm.runOverview(input)

  step('llm_code_review', { model: rules.model, llmProvider: llm.id })
  const codeReviewStarted = Date.now()
  const findings = await llm.runCodeReview(input)

  const qwenCliLog = llm.id === 'qwen-cli' ? (input.qwenCliLog?.text ?? null) : null
  return { overview, findings, requestSizes, overviewStarted, codeReviewStarted, qwenCliLog }
}

async function processReview(reviewLogId: string, jobId: string | undefined): Promise<void> {
  const step = (name: string, extra?: Record<string, unknown>) => {
    workerLog.info({ event: 'review_step', reviewLogId, jobId: jobId ?? null, step: name, ...extra }, name)
  }

  step('load_review_log')
  const log = await prisma.reviewLog.findUnique({
    where: { id: reviewLogId },
    include: { repository: { include: { rules: true } } },
  })
  if (!log) throw new Error(`ReviewLog ${reviewLogId} not found`)
  const repo = log.repository
  const rules = repo.rules
  if (!rules) throw new Error('Review rules missing')

  workerLog.info(
    {
      event: 'review_context',
      reviewLogId,
      jobId: jobId ?? null,
      repoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      prNumber: log.prNumber,
      commitSha: shortSha(log.commitSha),
      model: rules.model,
    },
    `review ${repo.owner}/${repo.name}#${log.prNumber}`,
  )

  step('mark_running')
  await prisma.reviewLog.update({
    where: { id: reviewLogId },
    data: { status: 'running' },
  })

  const provider = getProvider(repo.provider)
  const excludeGlobs = parseExcludeGlobs(rules.excludeGlobs)
  const llm = getReviewLlmProvider()

  let headSha: string
  let changedPaths: string[]
  let llmInput: ReviewLlmInput

  if (llm.id === 'qwen-cli') {
    step('sync_repo_workspace', { excludeGlobCount: excludeGlobs.length, provider: repo.provider })
    const syncStarted = Date.now()
    const mrRef = await provider.getMrRef(repo.accessToken, repo.owner, repo.name, log.prNumber)
    const sync = await syncWorkspace({
      provider: repo.provider as ProviderId,
      owner: repo.owner,
      name: repo.name,
      accessToken: repo.accessToken,
      branch: mrRef.headBranch,
      sha: mrRef.headSha,
      baseSha: mrRef.baseSha,
      excludeGlobs,
    })
    headSha = mrRef.headSha
    changedPaths = sync.changedPaths
    const workspace: ReviewWorkspaceContext = {
      workspacePath: sync.workspacePath,
      provider: repo.provider as ProviderId,
      owner: repo.owner,
      name: repo.name,
      branch: mrRef.headBranch,
      sha: mrRef.headSha,
      prNumber: log.prNumber,
      changedPaths,
    }
    llmInput = {
      ...llmInputFromRules(rules, 'pr'),
      workspace,
      reviewLogId,
      onQwenCliLogUpdate: async (log) => {
        await prisma.reviewLog.update({ where: { id: reviewLogId }, data: { qwenCliLog: log } })
      },
    }
    workerLog.info(
      {
        event: 'repo_workspace_ready',
        reviewLogId,
        jobId: jobId ?? null,
        ms: Date.now() - syncStarted,
        cacheKey: sync.cacheKey,
        cloned: sync.cloned,
        headSha: shortSha(headSha),
        changedPathCount: changedPaths.length,
      },
      'repo workspace synced',
    )
  } else {
    step('fetch_diff', { excludeGlobCount: excludeGlobs.length, provider: repo.provider })
    const diffStarted = Date.now()
    const diff = await provider.buildMrDiff(
      repo.accessToken,
      repo.owner,
      repo.name,
      log.prNumber,
      excludeGlobs,
    )
    headSha = diff.headSha
    changedPaths = diff.changedPaths
    const userContent = `Repository: ${repo.owner}/${repo.name}\nPR: #${log.prNumber}\n\n${fullFileContextHint()}${diff.diffText}`
    llmInput = { ...llmInputFromRules(rules, 'pr'), userContent }
    workerLog.info(
      {
        event: 'review_diff_ready',
        reviewLogId,
        jobId: jobId ?? null,
        ms: Date.now() - diffStarted,
        diffChars: diff.diffText.length,
        headSha: shortSha(headSha),
        includeFullFileContent: includeFullFileContent(),
        fullFilesAttached: diff.fullFilesAttached,
      },
      'diff fetched',
    )
  }

  const { overview, findings, requestSizes, overviewStarted, codeReviewStarted, qwenCliLog } =
    await runLlmReviewPhases(rules, llmInput, { reviewLogId, jobId: jobId ?? null }, step)
  workerLog.info(
    {
      event: 'review_llm_overview_done',
      reviewLogId,
      jobId: jobId ?? null,
      llmProvider: llm.id,
      ms: Date.now() - overviewStarted,
    },
    'LLM overview phase done',
  )
  workerLog.info(
    {
      event: 'review_llm_code_review_done',
      reviewLogId,
      jobId: jobId ?? null,
      llmProvider: llm.id,
      ms: Date.now() - codeReviewStarted,
      findingCount: findings.length,
    },
    'LLM code review phase done',
  )

  const ai = normalizeFindingPaths({ overview, findings }, changedPaths)
  const rawOut = JSON.stringify(ai)
  workerLog.info(
    {
      event: 'review_llm_done',
      reviewLogId,
      jobId: jobId ?? null,
      llmProvider: llm.id,
      msOverview: Date.now() - overviewStarted,
      msCodeReview: Date.now() - codeReviewStarted,
      outputChars: rawOut.length,
      ...requestSizes,
    },
    'LLM review phases completed',
  )

  step('submit_review', { provider: repo.provider })
  const submitStarted = Date.now()
  await provider.submitMrReview(
    repo.accessToken,
    repo.owner,
    repo.name,
    log.prNumber,
    headSha,
    ai,
    requestSizes,
  )
  workerLog.info(
    {
      event: 'review_submitted',
      reviewLogId,
      jobId: jobId ?? null,
      provider: repo.provider,
      ms: Date.now() - submitStarted,
    },
    `review posted to ${repo.provider}`,
  )

  step('mark_done')
  await prisma.reviewLog.update({
    where: { id: reviewLogId },
    data: {
      status: 'done',
      rawAiOutput: rawOut,
      qwenCliLog: qwenCliLog ?? undefined,
      finishedAt: new Date(),
      commitSha: log.commitSha ?? headSha,
    },
  })
}

const worker = new Worker<ReviewJobData>(
  PR_REVIEW_QUEUE,
  async (job) => {
    const { reviewLogId } = job.data
    const started = Date.now()
    workerLog.info(
      {
        event: 'job_active',
        reviewLogId,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        queue: PR_REVIEW_QUEUE,
      },
      'processing review job',
    )
    try {
      await processReview(reviewLogId, job.id)
      workerLog.info(
        {
          event: 'job_completed',
          reviewLogId,
          jobId: job.id,
          ms: Date.now() - started,
        },
        'review job completed',
      )
    } catch (err) {
      workerLog.error(
        {
          err,
          event: 'job_failed',
          reviewLogId,
          jobId: job.id,
          ms: Date.now() - started,
          attempt: job.attemptsMade + 1,
        },
        'review job failed',
      )
      throw err
    }
  },
  { connection: redisConnection },
)

worker.on('ready', () => {
  workerLog.info({ event: 'worker_ready', queue: PR_REVIEW_QUEUE }, 'BullMQ worker ready')
})

worker.on('failed', async (job, err) => {
  const id = job?.data?.reviewLogId
  if (!id) return
  const msg = err instanceof Error ? err.message : String(err)
  workerLog.error(
    {
      err,
      event: 'job_failed_handler',
      reviewLogId: id,
      jobId: job?.id ?? null,
      attempts: job?.attemptsMade ?? null,
    },
    'persisting failed status to database',
  )
  await prisma.reviewLog.update({
    where: { id },
    data: {
      status: 'failed',
      errorMessage: msg.slice(0, 8000),
      finishedAt: new Date(),
    },
  })
})

async function processCommitBatchReview(commitBatchReviewId: string, jobId: string | undefined): Promise<void> {
  const step = (name: string, extra?: Record<string, unknown>) => {
    workerLog.info(
      { event: 'commit_review_step', commitBatchReviewId, jobId: jobId ?? null, step: name, ...extra },
      name,
    )
  }

  step('load_commit_batch_review')
  const batch = await prisma.commitBatchReview.findUnique({
    where: { id: commitBatchReviewId },
    include: { repository: { include: { rules: true } } },
  })
  if (!batch) throw new Error(`CommitBatchReview ${commitBatchReviewId} not found`)
  const repo = batch.repository
  const rules = repo.rules
  if (!rules) throw new Error('Review rules missing')

  const shas = parseCommitShas(batch.commitShas)
  if (shas.length === 0) throw new Error('No commits in batch')

  workerLog.info(
    {
      event: 'commit_review_context',
      commitBatchReviewId,
      jobId: jobId ?? null,
      repoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      branchName: batch.branchName,
      authorLogin: batch.authorLogin,
      commitCount: shas.length,
      model: rules.model,
    },
    `commit batch review ${repo.owner}/${repo.name}:${batch.branchName} @${batch.authorLogin}`,
  )

  step('mark_running')
  await prisma.commitBatchReview.update({
    where: { id: commitBatchReviewId },
    data: { status: 'running' },
  })

  const provider = getProvider(repo.provider)
  const excludeGlobs = parseExcludeGlobs(rules.excludeGlobs)
  const llm = getReviewLlmProvider()

  let changedPaths: string[]
  let commitMessages: { sha: string; message: string }[] = []
  let llmInput: ReviewLlmInput

  if (llm.id === 'qwen-cli') {
    step('sync_repo_workspace', { excludeGlobCount: excludeGlobs.length, provider: repo.provider })
    const syncStarted = Date.now()
    const headSha = shas[shas.length - 1]
    const sync = await syncWorkspace({
      provider: repo.provider as ProviderId,
      owner: repo.owner,
      name: repo.name,
      accessToken: repo.accessToken,
      branch: batch.branchName,
      sha: headSha,
      commitShas: shas,
      excludeGlobs,
    })
    changedPaths = sync.changedPaths
    const workspace: ReviewWorkspaceContext = {
      workspacePath: sync.workspacePath,
      provider: repo.provider as ProviderId,
      owner: repo.owner,
      name: repo.name,
      branch: batch.branchName,
      sha: headSha,
      commitShas: shas,
      changedPaths,
    }
    llmInput = {
      ...llmInputFromRules(rules, 'batch'),
      workspace,
      commitBatchReviewId,
      onQwenCliLogUpdate: async (log) => {
        await prisma.commitBatchReview.update({
          where: { id: commitBatchReviewId },
          data: { qwenCliLog: log },
        })
      },
    }
    workerLog.info(
      {
        event: 'repo_workspace_ready',
        commitBatchReviewId,
        jobId: jobId ?? null,
        ms: Date.now() - syncStarted,
        cacheKey: sync.cacheKey,
        cloned: sync.cloned,
        headSha: shortSha(headSha),
        changedPathCount: changedPaths.length,
      },
      'repo workspace synced',
    )
  } else {
    step('fetch_diff', { excludeGlobCount: excludeGlobs.length, provider: repo.provider })
    const diffStarted = Date.now()
    const diff = await provider.buildCommitBatchDiff(
      repo.accessToken,
      repo.owner,
      repo.name,
      shas,
      excludeGlobs,
    )
    changedPaths = diff.changedPaths
    commitMessages = diff.commitMessages
    const commitList = commitMessages.map((c) => `- ${c.sha.slice(0, 7)}: ${c.message.split('\n')[0]}`).join('\n')
    const userContent = [
      `Repository: ${repo.owner}/${repo.name}`,
      `Branch: ${batch.branchName}`,
      `Author: ${batch.authorLogin}`,
      `Period: ${batch.periodStart.toISOString()} — ${batch.periodEnd.toISOString()}`,
      `Commits in this batch (${shas.length}):`,
      commitList,
      '',
      DEFAULT_BATCH_OPENAI_USER_INTRO,
      '',
      fullFileContextHint() + diff.diffText,
    ].join('\n')
    llmInput = { ...llmInputFromRules(rules, 'batch'), userContent }
    workerLog.info(
      {
        event: 'commit_review_diff_ready',
        commitBatchReviewId,
        jobId: jobId ?? null,
        ms: Date.now() - diffStarted,
        diffChars: diff.diffText.length,
        includeFullFileContent: includeFullFileContent(),
        fullFilesAttached: diff.fullFilesAttached,
      },
      'commit diff fetched',
    )
  }

  const { overview, findings, requestSizes, overviewStarted, codeReviewStarted, qwenCliLog } =
    await runLlmReviewPhases(rules, llmInput, { commitBatchReviewId, jobId: jobId ?? null }, step)
  workerLog.info(
    {
      event: 'commit_review_llm_overview_done',
      commitBatchReviewId,
      jobId: jobId ?? null,
      llmProvider: llm.id,
      ms: Date.now() - overviewStarted,
    },
    'LLM overview phase done',
  )
  workerLog.info(
    {
      event: 'commit_review_llm_code_review_done',
      commitBatchReviewId,
      jobId: jobId ?? null,
      llmProvider: llm.id,
      ms: Date.now() - codeReviewStarted,
      findingCount: findings.length,
    },
    'LLM code review phase done',
  )

  const ai = normalizeFindingPaths({ overview, findings }, changedPaths)
  const rawOut = JSON.stringify(ai)

  if (llm.id === 'qwen-cli' && commitMessages.length === 0) {
    const providerForCommits = getProvider(repo.provider)
    try {
      const diff = await providerForCommits.buildCommitBatchDiff(
        repo.accessToken,
        repo.owner,
        repo.name,
        shas,
        excludeGlobs,
      )
      commitMessages = diff.commitMessages
    } catch {
      commitMessages = shas.map((sha) => ({ sha, message: '' }))
    }
  }

  const commitMetas = shas.map((sha) => {
    const meta = commitMessages.find((m) => m.sha === sha)
    return {
      sha,
      message: meta?.message ?? '',
      url: provider.commitUrl(repo.owner, repo.name, sha),
    }
  })

  const mdContent = formatCommitReviewMarkdown(
    repo.owner,
    repo.name,
    batch.branchName,
    batch.authorLogin,
    batch.periodStart,
    batch.periodEnd,
    commitMetas,
    ai,
    requestSizes,
  )

  step('mark_done')
  await prisma.commitBatchReview.update({
    where: { id: commitBatchReviewId },
    data: {
      status: 'done',
      rawAiOutput: rawOut,
      mdContent,
      qwenCliLog: qwenCliLog ?? undefined,
      finishedAt: new Date(),
    },
  })

  const batchStillExists = await prisma.commitBatchReview.findUnique({
    where: { id: commitBatchReviewId },
    select: { id: true },
  })
  if (!batchStillExists) {
    workerLog.warn(
      { event: 'commit_review_skip_mark_reviewed', commitBatchReviewId, jobId: jobId ?? null },
      'batch removed during review; skip ReviewedCommit upsert',
    )
    return
  }

  for (const sha of shas) {
    await prisma.reviewedCommit.upsert({
      where: { repoId_sha_branchName: { repoId: repo.id, sha, branchName: batch.branchName } },
      create: { repoId: repo.id, branchName: batch.branchName, sha, commitBatchReviewId },
      update: { commitBatchReviewId, reviewedAt: new Date() },
    })
  }
}

const commitWorker = new Worker<CommitReviewJobData>(
  COMMIT_REVIEW_QUEUE,
  async (job) => {
    const { commitBatchReviewId } = job.data
    const started = Date.now()
    workerLog.info(
      {
        event: 'commit_job_active',
        commitBatchReviewId,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        queue: COMMIT_REVIEW_QUEUE,
      },
      'processing commit review job',
    )
    try {
      await processCommitBatchReview(commitBatchReviewId, job.id)
      workerLog.info(
        {
          event: 'commit_job_completed',
          commitBatchReviewId,
          jobId: job.id,
          ms: Date.now() - started,
        },
        'commit review job completed',
      )
    } catch (err) {
      workerLog.error(
        {
          err,
          event: 'commit_job_failed',
          commitBatchReviewId,
          jobId: job.id,
          ms: Date.now() - started,
          attempt: job.attemptsMade + 1,
        },
        'commit review job failed',
      )
      throw err
    }
  },
  { connection: redisConnection },
)

commitWorker.on('ready', () => {
  workerLog.info({ event: 'worker_ready', queue: COMMIT_REVIEW_QUEUE }, 'BullMQ commit review worker ready')
})

commitWorker.on('failed', async (job, err) => {
  const id = job?.data?.commitBatchReviewId
  if (!id) return
  const msg = err instanceof Error ? err.message : String(err)
  workerLog.error(
    {
      err,
      event: 'commit_job_failed_handler',
      commitBatchReviewId: id,
      jobId: job?.id ?? null,
      attempts: job?.attemptsMade ?? null,
    },
    'persisting failed commit review status to database',
  )
  await prisma.commitBatchReview.update({
    where: { id },
    data: {
      status: 'failed',
      errorMessage: msg.slice(0, 8000),
      finishedAt: new Date(),
    },
  })
})

void (async () => {
  try {
    await assertReviewLlmReady()
    workerLog.info(
      {
        event: 'worker_started',
        queue: PR_REVIEW_QUEUE,
        commitQueue: COMMIT_REVIEW_QUEUE,
        redisHost: redisConnection.host,
        redisPort: redisConnection.port,
        ...getReviewLlmStartupInfo(),
      },
      'PR and commit review workers started',
    )
  } catch (err) {
    workerLog.error(
      { err, event: 'worker_startup_failed', llmProvider: resolveLlmProviderId() },
      'worker LLM provider configuration invalid',
    )
    process.exit(1)
  }
})()

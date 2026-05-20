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
import { computeLlmRequestSizes, runLlmCodeReview, runLlmOverview } from './lib/llm.js'
import { workerLog, shortSha } from './lib/logger.js'
import { getProvider } from './providers/index.js'

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

  step('fetch_diff', { excludeGlobCount: excludeGlobs.length, provider: repo.provider })
  const diffStarted = Date.now()
  const { diffText, headSha, changedPaths, fullFilesAttached } = await provider.buildMrDiff(
    repo.accessToken,
    repo.owner,
    repo.name,
    log.prNumber,
    excludeGlobs,
  )
  workerLog.info(
    {
      event: 'review_diff_ready',
      reviewLogId,
      jobId: jobId ?? null,
      ms: Date.now() - diffStarted,
      diffChars: diffText.length,
      headSha: shortSha(headSha),
      includeFullFileContent: includeFullFileContent(),
      fullFilesAttached,
    },
    'diff fetched',
  )

  const baseUrl = process.env.OPENAI_BASE_URL?.trim()
  const apiKey = process.env.OPENAI_API_KEY?.trim() || (baseUrl ? 'local' : '')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set (for a local OpenAI-compatible server set OPENAI_BASE_URL)')
  }

  const userContent = `Repository: ${repo.owner}/${repo.name}\nPR: #${log.prNumber}\n\n${fullFileContextHint()}${diffText}`
  const requestSizes = computeLlmRequestSizes(rules.systemPrompt, userContent)

  step('llm_overview', { model: rules.model, hasOpenAiBaseUrl: Boolean(baseUrl) })
  const overviewStarted = Date.now()
  const overview = await runLlmOverview(apiKey, rules.model, rules.systemPrompt, userContent)
  workerLog.info(
    {
      event: 'review_llm_overview_done',
      reviewLogId,
      jobId: jobId ?? null,
      ms: Date.now() - overviewStarted,
    },
    'LLM overview phase done',
  )

  step('llm_code_review', { model: rules.model })
  const codeReviewStarted = Date.now()
  const findings = await runLlmCodeReview(apiKey, rules.model, rules.systemPrompt, userContent)
  workerLog.info(
    {
      event: 'review_llm_code_review_done',
      reviewLogId,
      jobId: jobId ?? null,
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

  step('fetch_diff', { excludeGlobCount: excludeGlobs.length, provider: repo.provider })
  const diffStarted = Date.now()
  const { diffText, changedPaths, commitMessages, fullFilesAttached } = await provider.buildCommitBatchDiff(
    repo.accessToken,
    repo.owner,
    repo.name,
    shas,
    excludeGlobs,
  )
  workerLog.info(
    {
      event: 'commit_review_diff_ready',
      commitBatchReviewId,
      jobId: jobId ?? null,
      ms: Date.now() - diffStarted,
      diffChars: diffText.length,
      includeFullFileContent: includeFullFileContent(),
      fullFilesAttached,
    },
    'commit diff fetched',
  )

  const baseUrl = process.env.OPENAI_BASE_URL?.trim()
  const apiKey = process.env.OPENAI_API_KEY?.trim() || (baseUrl ? 'local' : '')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set (for a local OpenAI-compatible server set OPENAI_BASE_URL)')
  }

  const commitList = commitMessages.map((c) => `- ${c.sha.slice(0, 7)}: ${c.message.split('\n')[0]}`).join('\n')
  const userContent = [
    `Repository: ${repo.owner}/${repo.name}`,
    `Branch: ${batch.branchName}`,
    `Author: ${batch.authorLogin}`,
    `Period: ${batch.periodStart.toISOString()} — ${batch.periodEnd.toISOString()}`,
    `Commits in this batch (${shas.length}):`,
    commitList,
    '',
    'Review this set of commits (not a pull request). Summarize what was done across all commits, then analyze the combined code changes for bugs and issues.',
    '',
    fullFileContextHint() + diffText,
  ].join('\n')
  const requestSizes = computeLlmRequestSizes(rules.systemPrompt, userContent)

  step('llm_overview', { model: rules.model, hasOpenAiBaseUrl: Boolean(baseUrl) })
  const overviewStarted = Date.now()
  const overview = await runLlmOverview(apiKey, rules.model, rules.systemPrompt, userContent)
  workerLog.info(
    {
      event: 'commit_review_llm_overview_done',
      commitBatchReviewId,
      jobId: jobId ?? null,
      ms: Date.now() - overviewStarted,
    },
    'LLM overview phase done',
  )

  step('llm_code_review', { model: rules.model })
  const codeReviewStarted = Date.now()
  const findings = await runLlmCodeReview(apiKey, rules.model, rules.systemPrompt, userContent)
  workerLog.info(
    {
      event: 'commit_review_llm_code_review_done',
      commitBatchReviewId,
      jobId: jobId ?? null,
      ms: Date.now() - codeReviewStarted,
      findingCount: findings.length,
    },
    'LLM code review phase done',
  )

  const ai = normalizeFindingPaths({ overview, findings }, changedPaths)
  const rawOut = JSON.stringify(ai)

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
      finishedAt: new Date(),
    },
  })

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

workerLog.info(
  {
    event: 'worker_started',
    queue: PR_REVIEW_QUEUE,
    commitQueue: COMMIT_REVIEW_QUEUE,
    redisHost: redisConnection.host,
    redisPort: redisConnection.port,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasOpenAiBaseUrl: Boolean(process.env.OPENAI_BASE_URL?.trim()),
  },
  'PR and commit review workers started',
)

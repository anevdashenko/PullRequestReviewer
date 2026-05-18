import { Worker } from 'bullmq'
import { Octokit } from '@octokit/rest'
import { prisma } from './db.js'
import { PR_REVIEW_QUEUE, redisConnection, type ReviewJobData } from './queue.js'
import { normalizeAiFindings } from './lib/diff-lines.js'
import { buildPrDiffText } from './lib/pr-diff.js'
import { runLlmReview } from './lib/llm.js'
import { submitGithubReview } from './lib/review-submit.js'
import { workerLog, shortSha } from './lib/logger.js'

function parseExcludeGlobs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string')
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

  const octokit = new Octokit({ auth: repo.accessToken })
  const excludeGlobs = parseExcludeGlobs(rules.excludeGlobs)

  step('fetch_diff', { excludeGlobCount: excludeGlobs.length })
  const diffStarted = Date.now()
  const { diffText, headSha, validLinesByPath } = await buildPrDiffText(
    octokit,
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
    },
    'diff fetched',
  )

  const baseUrl = process.env.OPENAI_BASE_URL?.trim()
  const apiKey = process.env.OPENAI_API_KEY?.trim() || (baseUrl ? 'local' : '')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set (for a local OpenAI-compatible server set OPENAI_BASE_URL)')
  }

  step('llm_review', { model: rules.model, hasOpenAiBaseUrl: Boolean(baseUrl) })
  const llmStarted = Date.now()
  const userContent = `Repository: ${repo.owner}/${repo.name}\nPR: #${log.prNumber}\n\n${diffText}`
  const aiRaw = await runLlmReview(apiKey, rules.model, rules.systemPrompt, userContent)
  const { result: ai, stats: lineStats } = normalizeAiFindings(aiRaw, validLinesByPath)
  if (lineStats.snapped > 0 || lineStats.droppedLine > 0 || lineStats.pathUnresolved > 0) {
    workerLog.info(
      {
        event: 'review_lines_normalized',
        reviewLogId,
        jobId: jobId ?? null,
        ...lineStats,
      },
      'LLM line numbers adjusted to diff',
    )
  }
  const rawOut = JSON.stringify(ai)
  workerLog.info(
    {
      event: 'review_llm_done',
      reviewLogId,
      jobId: jobId ?? null,
      ms: Date.now() - llmStarted,
      outputChars: rawOut.length,
    },
    'LLM response received',
  )

  step('submit_github_review')
  const submitStarted = Date.now()
  await submitGithubReview(octokit, repo.owner, repo.name, log.prNumber, headSha, ai)
  workerLog.info(
    {
      event: 'review_submitted',
      reviewLogId,
      jobId: jobId ?? null,
      ms: Date.now() - submitStarted,
    },
    'review posted to GitHub',
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

workerLog.info(
  {
    event: 'worker_started',
    queue: PR_REVIEW_QUEUE,
    redisHost: redisConnection.host,
    redisPort: redisConnection.port,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasOpenAiBaseUrl: Boolean(process.env.OPENAI_BASE_URL?.trim()),
  },
  'PR review worker process started',
)

import { prisma } from '../db.js'
import { enqueueCommitReview } from '../queue.js'
import { scheduleLog, shortSha } from './logger.js'

const activeStatuses = ['queued', 'running'] as const

export type CommitInfo = {
  sha: string
  authorLogin: string
  authorEmail: string | null
}

export type ScheduleCommitBatchResult =
  | { accepted: true; commitBatchReviewId: string }
  | { accepted: false; reason: string }

export type ScheduleCommitBatchContext = {
  source: 'poll'
  tickId?: string
}

function parseCommitShas(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string')
}

/**
 * Creates a CommitBatchReview and enqueues processing for a batch of commits
 * by one author when not already reviewed or in-flight.
 */
export async function scheduleCommitBatchReview(
  repoId: string,
  branchName: string,
  authorLogin: string,
  authorEmail: string | null,
  commits: CommitInfo[],
  periodStart: Date,
  periodEnd: Date,
  ctx: ScheduleCommitBatchContext = { source: 'poll' },
): Promise<ScheduleCommitBatchResult> {
  const shas = commits.map((c) => c.sha)
  const baseFields = {
    event: 'commit_schedule_check' as const,
    source: ctx.source,
    tickId: ctx.tickId ?? null,
    repoId,
    branchName,
    authorLogin,
    commitCount: shas.length,
    shas: shas.map(shortSha),
  }

  if (shas.length === 0) {
    scheduleLog.info({ ...baseFields, outcome: 'skip', reason: 'no commits' }, 'commit schedule: skip')
    return { accepted: false, reason: 'no commits' }
  }

  const alreadyReviewed = await prisma.reviewedCommit.findMany({
    where: { repoId, branchName, sha: { in: shas } },
    select: { sha: true },
  })
  const reviewedSet = new Set(alreadyReviewed.map((r) => r.sha))
  const unreviewed = shas.filter((s) => !reviewedSet.has(s))
  if (unreviewed.length === 0) {
    scheduleLog.info(
      { ...baseFields, outcome: 'skip', reason: 'all commits already reviewed' },
      'commit schedule: skip',
    )
    return { accepted: false, reason: 'all commits already reviewed' }
  }

  const inFlight = await prisma.commitBatchReview.findMany({
    where: {
      repoId,
      branchName,
      authorLogin,
      status: { in: [...activeStatuses] },
    },
    select: { id: true, status: true, commitShas: true },
  })

  for (const batch of inFlight) {
    const batchShas = parseCommitShas(batch.commitShas)
    const overlap = unreviewed.some((s) => batchShas.includes(s))
    if (overlap) {
      scheduleLog.info(
        {
          ...baseFields,
          outcome: 'skip',
          reason: 'batch already queued or running for overlapping commits',
          existingBatchId: batch.id,
          existingStatus: batch.status,
        },
        'commit schedule: skip',
      )
      return { accepted: false, reason: 'batch already queued or running for overlapping commits' }
    }
  }

  const log = await prisma.commitBatchReview.create({
    data: {
      repoId,
      branchName,
      authorLogin,
      authorEmail,
      periodStart,
      periodEnd,
      commitShas: unreviewed,
      status: 'queued',
    },
  })

  scheduleLog.info(
    { ...baseFields, outcome: 'queued', commitBatchReviewId: log.id, unreviewedCount: unreviewed.length },
    'commit schedule: created CommitBatchReview, enqueueing job',
  )

  await enqueueCommitReview({ commitBatchReviewId: log.id })

  scheduleLog.info(
    {
      event: 'commit_schedule_enqueued',
      source: ctx.source,
      tickId: ctx.tickId ?? null,
      commitBatchReviewId: log.id,
      repoId,
      branchName,
      authorLogin,
    },
    'commit schedule: job added to Redis queue',
  )

  return { accepted: true, commitBatchReviewId: log.id }
}

import { prisma } from '../db.js'
import { enqueueReview } from '../queue.js'
import { scheduleLog, shortSha } from './logger.js'

const activeStatuses = ['queued', 'running'] as const

export type SchedulePrReviewResult =
  | { accepted: true; reviewLogId: string }
  | { accepted: false; reason: string }

export type SchedulePrReviewContext = {
  source: 'poll' | 'webhook'
  tickId?: string
}

/**
 * Creates a ReviewLog and enqueues processing when this PR head is not already
 * covered by a completed or in-flight review (same repo, PR number, head SHA).
 */
export async function schedulePrReview(
  repoId: string,
  prNumber: number,
  headSha: string | null,
  ctx: SchedulePrReviewContext = { source: 'webhook' },
): Promise<SchedulePrReviewResult> {
  const baseFields = {
    event: 'schedule_check' as const,
    source: ctx.source,
    tickId: ctx.tickId ?? null,
    repoId,
    prNumber,
    headSha: shortSha(headSha),
  }

  if (!headSha) {
    scheduleLog.info({ ...baseFields, outcome: 'skip', reason: 'missing head sha' }, 'schedule: skip')
    return { accepted: false, reason: 'missing head sha' }
  }

  const alreadyDone = await prisma.reviewLog.findFirst({
    where: {
      repoId,
      prNumber,
      commitSha: headSha,
      status: 'done',
    },
    select: { id: true },
  })
  if (alreadyDone) {
    scheduleLog.info(
      { ...baseFields, outcome: 'skip', reason: 'already reviewed for this commit', existingLogId: alreadyDone.id },
      'schedule: skip',
    )
    return { accepted: false, reason: 'already reviewed for this commit' }
  }

  const inFlight = await prisma.reviewLog.findFirst({
    where: {
      repoId,
      prNumber,
      commitSha: headSha,
      status: { in: [...activeStatuses] },
    },
    select: { id: true, status: true },
  })
  if (inFlight) {
    scheduleLog.info(
      {
        ...baseFields,
        outcome: 'skip',
        reason: 'review already queued or running',
        existingLogId: inFlight.id,
        existingStatus: inFlight.status,
      },
      'schedule: skip',
    )
    return { accepted: false, reason: 'review already queued or running' }
  }

  const log = await prisma.reviewLog.create({
    data: {
      repoId,
      prNumber,
      commitSha: headSha,
      status: 'queued',
    },
  })

  scheduleLog.info(
    { ...baseFields, outcome: 'queued', reviewLogId: log.id },
    'schedule: created ReviewLog, enqueueing job',
  )

  await enqueueReview({ reviewLogId: log.id })

  scheduleLog.info(
    { event: 'schedule_enqueued', source: ctx.source, tickId: ctx.tickId ?? null, reviewLogId: log.id, repoId, prNumber },
    'schedule: job added to Redis queue',
  )

  return { accepted: true, reviewLogId: log.id }
}

import { prisma } from '../db.js'
import { pollLog } from './logger.js'
import { pollCommitsForRepository } from '../poll-commits.js'
import { commitReviewQueue } from '../queue.js'

export type ClearCommitReviewsResult = {
  reviewedCommitsDeleted: number
  batchReviewsDeleted: number
  pollScheduled: number
}

async function purgeCommitReviewQueueJobs(batchIds: Set<string>): Promise<void> {
  if (batchIds.size === 0) return
  const statuses = ['waiting', 'delayed', 'active', 'paused'] as const
  for (const status of statuses) {
    const jobs = await commitReviewQueue.getJobs([status], 0, -1)
    for (const job of jobs) {
      const batchId = (job.data as { commitBatchReviewId?: string }).commitBatchReviewId
      if (batchId && batchIds.has(batchId)) {
        await job.remove()
      }
    }
  }
}

export async function clearCommitReviewsForRepo(repoId: string): Promise<ClearCommitReviewsResult> {
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: { commitReviewEnabled: true },
  })
  if (!repo) {
    throw new Error(`Repository ${repoId} not found`)
  }

  const batches = await prisma.commitBatchReview.findMany({
    where: { repoId },
    select: { id: true },
  })
  const batchIds = new Set(batches.map((b) => b.id))

  if (batchIds.size > 0) {
    try {
      await purgeCommitReviewQueueJobs(batchIds)
    } catch (err) {
      pollLog.warn(
        { err, event: 'commit_reviews_clear_queue_purge_failed', repoId, pendingBatches: batchIds.size },
        'could not purge commit-review queue jobs (Redis unavailable?) — database rows will still be cleared',
      )
    }
  }

  const batchReviews = await prisma.commitBatchReview.deleteMany({ where: { repoId } })
  // ReviewedCommit rows survive batch delete (FK onDelete: SetNull); remove all tracking for this repo.
  const reviewedCommits = await prisma.reviewedCommit.deleteMany({ where: { repoId } })

  let pollScheduled = 0
  if (repo.commitReviewEnabled) {
    try {
      const poll = await pollCommitsForRepository(repoId, { source: 'clear' })
      pollScheduled = poll.authorsScheduled
    } catch (err) {
      pollLog.warn(
        { err, event: 'commit_reviews_clear_poll_failed', repoId },
        'commit reviews cleared but post-clear poll failed — next COMMIT_POLL_INTERVAL_MS tick will retry',
      )
    }
  }

  return {
    reviewedCommitsDeleted: reviewedCommits.count,
    batchReviewsDeleted: batchReviews.count,
    pollScheduled,
  }
}

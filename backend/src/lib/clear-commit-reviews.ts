import { prisma } from '../db.js'
import { commitReviewQueue } from '../queue.js'

export type ClearCommitReviewsResult = {
  reviewedCommitsDeleted: number
  batchReviewsDeleted: number
}

export async function clearCommitReviewsForRepo(repoId: string): Promise<ClearCommitReviewsResult> {
  const batches = await prisma.commitBatchReview.findMany({
    where: { repoId },
    select: { id: true },
  })
  const batchIds = new Set(batches.map((b) => b.id))

  if (batchIds.size > 0) {
    const statuses = ['waiting', 'delayed', 'active'] as const
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

  const [reviewedCommits, batchReviews] = await prisma.$transaction([
    prisma.reviewedCommit.deleteMany({ where: { repoId } }),
    prisma.commitBatchReview.deleteMany({ where: { repoId } }),
  ])

  return {
    reviewedCommitsDeleted: reviewedCommits.count,
    batchReviewsDeleted: batchReviews.count,
  }
}

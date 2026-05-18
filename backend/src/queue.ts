import { Queue } from 'bullmq'

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const u = new URL(redisUrl)

export const redisConnection = {
  host: u.hostname,
  port: Number(u.port || 6379),
  maxRetriesPerRequest: null,
}

export const PR_REVIEW_QUEUE = 'pr-review'

export const reviewQueue = new Queue(PR_REVIEW_QUEUE, { connection: redisConnection })

export type ReviewJobData = {
  reviewLogId: string
}

export async function enqueueReview(data: ReviewJobData): Promise<void> {
  await reviewQueue.add('review', data, {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  })
}

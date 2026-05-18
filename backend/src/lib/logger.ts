import pino from 'pino'

const base = pino({
  level: process.env.LOG_LEVEL ?? 'info',
})

/** Periodic GitHub PR poll (runs inside API when PR_POLL_INTERVAL_MS > 0). */
export const pollLog = base.child({ component: 'pr-poll' })

/** BullMQ worker that runs LLM review and posts to GitHub. */
export const workerLog = base.child({ component: 'pr-worker' })

/** Scheduling a review (poll, webhook). */
export const scheduleLog = base.child({ component: 'pr-schedule' })

export function shortSha(sha: string | null | undefined): string | null {
  if (!sha) return null
  return sha.length > 7 ? sha.slice(0, 7) : sha
}

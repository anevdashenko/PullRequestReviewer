import { prisma } from './db.js'
import { schedulePrReview } from './lib/schedule-pr-review.js'
import { pollLog, shortSha } from './lib/logger.js'
import { getProvider } from './providers/index.js'

type PollTickStats = {
  reposTotal: number
  reposOk: number
  reposFailed: number
  prsSeen: number
  scheduled: number
  skipped: number
}

async function pollOnce(tickId: string): Promise<PollTickStats> {
  const stats: PollTickStats = {
    reposTotal: 0,
    reposOk: 0,
    reposFailed: 0,
    prsSeen: 0,
    scheduled: 0,
    skipped: 0,
  }

  const repos = await prisma.repository.findMany({
    where: { prReviewEnabled: true },
    select: { id: true, provider: true, owner: true, name: true, accessToken: true },
  })

  stats.reposTotal = repos.length
  pollLog.info(
    { event: 'poll_tick_repos_loaded', tickId, repoCount: repos.length },
    'loaded repositories for poll',
  )

  if (repos.length === 0) {
    pollLog.info({ event: 'poll_tick_no_repos', tickId }, 'no PR-review-enabled repositories — nothing to poll')
    return stats
  }

  for (const repo of repos) {
    const repoRef = `${repo.owner}/${repo.name}`
    const repoStarted = Date.now()
    pollLog.info(
      {
        event: 'poll_repo_start',
        tickId,
        repoId: repo.id,
        provider: repo.provider,
        owner: repo.owner,
        name: repo.name,
      },
      `polling open MRs for ${repoRef}`,
    )

    try {
      const provider = getProvider(repo.provider)
      const mrs = await provider.listOpenMrs(repo.accessToken, repo.owner, repo.name)
      let repoScheduled = 0
      let repoSkipped = 0

      pollLog.info(
        {
          event: 'poll_mrs_list',
          tickId,
          repoId: repo.id,
          provider: repo.provider,
          mrCount: mrs.length,
        },
        `returned ${mrs.length} open MR(s)`,
      )

      for (const mr of mrs) {
        stats.prsSeen += 1
        const result = await schedulePrReview(repo.id, mr.number, mr.headSha, {
          source: 'poll',
          tickId,
        })

        if (result.accepted) {
          repoScheduled += 1
          stats.scheduled += 1
          pollLog.info(
            {
              event: 'poll_pr_scheduled',
              tickId,
              repoId: repo.id,
              provider: repo.provider,
              owner: repo.owner,
              name: repo.name,
              prNumber: mr.number,
              headSha: shortSha(mr.headSha),
              reviewLogId: result.reviewLogId,
            },
            `queued review for ${repoRef}#${mr.number}`,
          )
        } else {
          repoSkipped += 1
          stats.skipped += 1
          pollLog.info(
            {
              event: 'poll_pr_skipped',
              tickId,
              repoId: repo.id,
              provider: repo.provider,
              owner: repo.owner,
              name: repo.name,
              prNumber: mr.number,
              headSha: shortSha(mr.headSha),
              reason: result.reason,
            },
            `skipped ${repoRef}#${mr.number}: ${result.reason}`,
          )
        }
      }

      stats.reposOk += 1
      pollLog.info(
        {
          event: 'poll_repo_done',
          tickId,
          repoId: repo.id,
          provider: repo.provider,
          owner: repo.owner,
          name: repo.name,
          ms: Date.now() - repoStarted,
          prsSeen: mrs.length,
          scheduled: repoScheduled,
          skipped: repoSkipped,
        },
        `finished ${repoRef}`,
      )
    } catch (err) {
      stats.reposFailed += 1
      pollLog.error(
        {
          err,
          event: 'poll_repo_error',
          tickId,
          repoId: repo.id,
          provider: repo.provider,
          owner: repo.owner,
          name: repo.name,
          ms: Date.now() - repoStarted,
        },
        `poll failed for ${repoRef}`,
      )
    }
  }

  return stats
}

let tickCounter = 0

/**
 * Periodically lists open merge requests for every configured repository and
 * enqueues a review when the current head commit has not been reviewed yet.
 * Disabled when PR_POLL_INTERVAL_MS is unset or non-positive.
 */
export function startPrPollTimer(): void {
  const intervalMs = Number(process.env.PR_POLL_INTERVAL_MS ?? 0)
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    pollLog.info(
      { event: 'poll_timer_disabled', prPollIntervalMs: process.env.PR_POLL_INTERVAL_MS ?? null },
      'PR poll disabled (set PR_POLL_INTERVAL_MS to a positive number, e.g. 300000 for 5 min)',
    )
    return
  }

  const run = (): void => {
    const tickId = `tick-${++tickCounter}`
    const started = Date.now()
    pollLog.info({ event: 'poll_tick_start', tickId, intervalMs }, 'poll tick started')

    void pollOnce(tickId)
      .then((stats) => {
        pollLog.info(
          {
            event: 'poll_tick_done',
            tickId,
            ms: Date.now() - started,
            ...stats,
          },
          'poll tick finished',
        )
      })
      .catch((err) => {
        pollLog.error({ err, event: 'poll_tick_failed', tickId, ms: Date.now() - started }, 'poll tick failed')
      })
  }

  const initialDelayMs = Math.min(5000, intervalMs)
  pollLog.info(
    { event: 'poll_timer_enabled', intervalMs, initialDelayMs },
    `PR poll enabled every ${intervalMs} ms (first run in ${initialDelayMs} ms)`,
  )
  setTimeout(run, initialDelayMs)
  setInterval(run, intervalMs)
}

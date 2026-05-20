import { prisma } from './db.js'
import { scheduleCommitBatchReview, type CommitInfo } from './lib/schedule-commit-review.js'
import { pollLog } from './lib/logger.js'
import { getProvider } from './providers/index.js'

function getLookbackSec(): number {
  const raw = process.env.COMMIT_REVIEW_LOOKBACK_SEC ?? '86400'
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 86400
  return n
}

type PollCommitTickStats = {
  reposTotal: number
  reposOk: number
  reposFailed: number
  branchesPolled: number
  commitsSeen: number
  authorsScheduled: number
  skipped: number
}

async function pollCommitsOnce(tickId: string): Promise<PollCommitTickStats> {
  const stats: PollCommitTickStats = {
    reposTotal: 0,
    reposOk: 0,
    reposFailed: 0,
    branchesPolled: 0,
    commitsSeen: 0,
    authorsScheduled: 0,
    skipped: 0,
  }

  const lookbackSec = getLookbackSec()
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - lookbackSec * 1000)
  const sinceIso = periodStart.toISOString()

  const repos = await prisma.repository.findMany({
    where: { commitReviewEnabled: true },
    select: { id: true, provider: true, owner: true, name: true, accessToken: true },
  })

  stats.reposTotal = repos.length
  pollLog.info(
    { event: 'commit_poll_tick_repos_loaded', tickId, repoCount: repos.length, lookbackSec, sinceIso },
    'loaded repositories for commit poll',
  )

  if (repos.length === 0) {
    pollLog.info({ event: 'commit_poll_tick_no_repos', tickId }, 'no commit-review-enabled repositories')
    return stats
  }

  for (const repo of repos) {
    const repoRef = `${repo.owner}/${repo.name}`
    const repoStarted = Date.now()
    pollLog.info(
      {
        event: 'commit_poll_repo_start',
        tickId,
        repoId: repo.id,
        provider: repo.provider,
        owner: repo.owner,
        name: repo.name,
      },
      `polling commits for ${repoRef}`,
    )

    try {
      const provider = getProvider(repo.provider)
      const branchNames = await provider.listBranches(repo.accessToken, repo.owner, repo.name)

      if (branchNames.length === 0) {
        pollLog.warn({ event: 'commit_poll_repo_skip', tickId, repoId: repo.id, reason: 'no branches' }, 'skip')
        stats.reposOk += 1
        continue
      }

      let repoScheduled = 0
      let repoSkipped = 0
      let repoNewCommits = 0
      let branchesWithCommits = 0
      let branchesSkippedEmpty = 0

      for (const branchName of branchNames) {
        stats.branchesPolled += 1

        const reviewedRows = await prisma.reviewedCommit.findMany({
          where: { repoId: repo.id, branchName },
          select: { sha: true },
        })
        const reviewedSet = new Set(reviewedRows.map((r) => r.sha))

        const polled = await provider.listRecentCommits(
          repo.accessToken,
          repo.owner,
          repo.name,
          branchName,
          sinceIso,
        )

        const commits: CommitInfo[] = []
        for (const c of polled) {
          stats.commitsSeen += 1
          if (reviewedSet.has(c.sha)) continue
          commits.push({
            sha: c.sha,
            authorLogin: c.authorLogin,
            authorEmail: c.authorEmail,
          })
        }

        if (commits.length === 0) {
          branchesSkippedEmpty += 1
          continue
        }

        branchesWithCommits += 1
        repoNewCommits += commits.length

        const byAuthor = new Map<string, CommitInfo[]>()
        for (const c of commits) {
          const list = byAuthor.get(c.authorLogin) ?? []
          list.push(c)
          byAuthor.set(c.authorLogin, list)
        }

        for (const [authorLogin, authorCommits] of byAuthor) {
          const authorEmail = authorCommits.find((c) => c.authorEmail)?.authorEmail ?? null
          const result = await scheduleCommitBatchReview(
            repo.id,
            branchName,
            authorLogin,
            authorEmail,
            authorCommits,
            periodStart,
            periodEnd,
            { source: 'poll', tickId },
          )

          if (result.accepted) {
            repoScheduled += 1
            stats.authorsScheduled += 1
          } else {
            repoSkipped += 1
            stats.skipped += 1
          }
        }
      }

      stats.reposOk += 1
      pollLog.info(
        {
          event: 'commit_poll_repo_done',
          tickId,
          repoId: repo.id,
          provider: repo.provider,
          owner: repo.owner,
          name: repo.name,
          ms: Date.now() - repoStarted,
          branchesTotal: branchNames.length,
          branchesWithCommits,
          branchesSkippedEmpty,
          newCommits: repoNewCommits,
          scheduled: repoScheduled,
          skipped: repoSkipped,
        },
        `finished commit poll for ${repoRef}`,
      )
    } catch (err) {
      stats.reposFailed += 1
      pollLog.error(
        {
          err,
          event: 'commit_poll_repo_error',
          tickId,
          repoId: repo.id,
          provider: repo.provider,
          owner: repo.owner,
          name: repo.name,
          ms: Date.now() - repoStarted,
        },
        `commit poll failed for ${repoRef}`,
      )
    }
  }

  return stats
}

let tickCounter = 0

/**
 * Periodically lists recent commits on all branches for repositories with
 * commitReviewEnabled and enqueues batch reviews grouped by author per branch.
 * Disabled when COMMIT_POLL_INTERVAL_MS is unset or non-positive.
 */
export function startCommitPollTimer(): void {
  const intervalMs = Number(process.env.COMMIT_POLL_INTERVAL_MS ?? 0)
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    pollLog.info(
      { event: 'commit_poll_timer_disabled', commitPollIntervalMs: process.env.COMMIT_POLL_INTERVAL_MS ?? null },
      'Commit poll disabled (set COMMIT_POLL_INTERVAL_MS to a positive number)',
    )
    return
  }

  const run = (): void => {
    const tickId = `commit-tick-${++tickCounter}`
    const started = Date.now()
    pollLog.info({ event: 'commit_poll_tick_start', tickId, intervalMs }, 'commit poll tick started')

    void pollCommitsOnce(tickId)
      .then((stats) => {
        pollLog.info(
          {
            event: 'commit_poll_tick_done',
            tickId,
            ms: Date.now() - started,
            ...stats,
          },
          'commit poll tick finished',
        )
      })
      .catch((err) => {
        pollLog.error(
          { err, event: 'commit_poll_tick_failed', tickId, ms: Date.now() - started },
          'commit poll tick failed',
        )
      })
  }

  const initialDelayMs = Math.min(5000, intervalMs)
  pollLog.info(
    { event: 'commit_poll_timer_enabled', intervalMs, initialDelayMs, lookbackSec: getLookbackSec() },
    `Commit poll enabled every ${intervalMs} ms (first run in ${initialDelayMs} ms)`,
  )
  setTimeout(run, initialDelayMs)
  setInterval(run, intervalMs)
}

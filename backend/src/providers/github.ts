import { Octokit } from '@octokit/rest'
import type { FastifyRequest } from 'fastify'
import { buildCommitBatchDiffText } from '../lib/commit-diff.js'
import { buildPrDiffText } from '../lib/pr-diff.js'
import { submitGithubReview } from '../lib/review-submit.js'
import { verifyGithubSignature } from '../lib/webhook-signature.js'
import type { MrRefInfo, OpenMr, PolledCommit, VcsProvider } from './types.js'

type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer }

type GithubPrPayload = {
  action?: string
  pull_request?: { number: number; head?: { sha?: string } }
  repository?: { full_name?: string; name?: string; owner?: { login?: string } }
}

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

function repoFromPayload(body: GithubPrPayload): { owner?: string; name?: string } {
  const full = body.repository?.full_name
  const ownerLogin = body.repository?.owner?.login
  const repoName = body.repository?.name
  const owner = ownerLogin ?? (full?.includes('/') ? full.split('/')[0] : undefined)
  const name = repoName ?? (full?.includes('/') ? full.split('/')[1] : undefined)
  return { owner, name }
}

function authorKey(commit: {
  author?: { login?: string | null } | null
  commit: { author?: { email?: string | null; name?: string | null } | null }
}): string {
  const login = commit.author?.login?.trim()
  if (login) return login
  const email = commit.commit.author?.email?.trim()
  if (email) return email
  const name = commit.commit.author?.name?.trim()
  return name || 'unknown'
}

function authorEmail(commit: { commit: { author?: { email?: string | null } | null } }): string | null {
  const email = commit.commit.author?.email?.trim()
  return email || null
}

export const githubProvider: VcsProvider = {
  id: 'github',

  verifyWebhook(req, secret) {
    const raw = (req as RequestWithRawBody).rawBody
    if (!raw || !Buffer.isBuffer(raw)) return false
    const sig = headerValue(req.headers['x-hub-signature-256'])
    return verifyGithubSignature(raw, secret, sig)
  },

  parseMrWebhook(body, headers) {
    const payload = body as GithubPrPayload
    const { owner, name } = repoFromPayload(payload)
    if (!owner || !name) return null

    const event = headerValue(headers['x-github-event'])
    if (event !== 'pull_request') {
      return {
        owner,
        name,
        mrNumber: 0,
        headSha: null,
        accepted: false,
        ignoreReason: 'not pull_request',
      }
    }

    const action = payload.action
    if (action !== 'opened' && action !== 'synchronize' && action !== 'reopened') {
      return {
        owner,
        name,
        mrNumber: 0,
        headSha: null,
        accepted: false,
        ignoreReason: `action ${action}`,
      }
    }

    const mrNumber = payload.pull_request?.number
    if (typeof mrNumber !== 'number') return null

    return {
      owner,
      name,
      mrNumber,
      headSha: payload.pull_request?.head?.sha ?? null,
      accepted: true,
    }
  },

  async listOpenMrs(accessToken, owner, name) {
    const octokit = new Octokit({ auth: accessToken })
    const out: OpenMr[] = []
    let page = 1
    const perPage = 50
    for (;;) {
      const { data: pulls } = await octokit.pulls.list({
        owner,
        repo: name,
        state: 'open',
        per_page: perPage,
        page,
      })
      for (const pr of pulls) {
        out.push({ number: pr.number, headSha: pr.head?.sha ?? null })
      }
      if (pulls.length < perPage) break
      page += 1
    }
    return out
  },

  async getMrRef(accessToken, owner, name, mrNumber) {
    const octokit = new Octokit({ auth: accessToken })
    const { data: pr } = await octokit.pulls.get({ owner, repo: name, pull_number: mrNumber })
    const headSha = pr.head?.sha
    const headBranch = pr.head?.ref
    const baseSha = pr.base?.sha
    if (!headSha || !headBranch || !baseSha) {
      throw new Error(`GitHub PR #${mrNumber} missing head/base ref metadata`)
    }
    return { headSha, headBranch, baseSha } satisfies MrRefInfo
  },

  async buildMrDiff(accessToken, owner, name, mrNumber, excludeGlobs) {
    const octokit = new Octokit({ auth: accessToken })
    return buildPrDiffText(octokit, owner, name, mrNumber, excludeGlobs)
  },

  async submitMrReview(accessToken, owner, name, mrNumber, headSha, reviewBody) {
    const octokit = new Octokit({ auth: accessToken })
    await submitGithubReview(octokit, owner, name, mrNumber, headSha, reviewBody)
  },

  async getDefaultBranch(accessToken, owner, name) {
    const octokit = new Octokit({ auth: accessToken })
    const { data } = await octokit.repos.get({ owner, repo: name })
    return data.default_branch ?? null
  },

  async listBranches(accessToken, owner, name) {
    const octokit = new Octokit({ auth: accessToken })
    const out: string[] = []
    let page = 1
    const perPage = 100
    for (;;) {
      const { data: branches } = await octokit.repos.listBranches({
        owner,
        repo: name,
        per_page: perPage,
        page,
      })
      for (const b of branches) {
        if (b.name) out.push(b.name)
      }
      if (branches.length < perPage) break
      page += 1
    }
    return out
  },

  async listRecentCommits(accessToken, owner, name, branchName, sinceIso) {
    const octokit = new Octokit({ auth: accessToken })
    const out: PolledCommit[] = []
    let page = 1
    const perPage = 100
    for (;;) {
      const { data: pageCommits } = await octokit.repos.listCommits({
        owner,
        repo: name,
        sha: branchName,
        since: sinceIso,
        per_page: perPage,
        page,
      })
      for (const c of pageCommits) {
        if (!c.sha) continue
        out.push({
          sha: c.sha,
          authorLogin: authorKey(c),
          authorEmail: authorEmail(c),
        })
      }
      if (pageCommits.length < perPage) break
      page += 1
    }
    return out
  },

  async buildCommitBatchDiff(accessToken, owner, name, shas, excludeGlobs) {
    const octokit = new Octokit({ auth: accessToken })
    return buildCommitBatchDiffText(octokit, owner, name, shas, excludeGlobs)
  },

  mrUrl(owner, name, mrNumber) {
    return `https://github.com/${owner}/${name}/pull/${mrNumber}`
  },

  commitUrl(owner, name, sha) {
    return `https://github.com/${owner}/${name}/commit/${sha}`
  },
}

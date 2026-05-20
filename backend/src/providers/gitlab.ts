import crypto from 'node:crypto'
import { Gitlab } from '@gitbeaker/rest'
import { minimatch } from 'minimatch'
import { DIFF_MAX_CHARS } from '../lib/defaults.js'
import { formatReviewBody } from '../lib/review-submit.js'
import type { CommitBatchDiffResult, PolledCommit, VcsProvider } from './types.js'
const GITLAB_HOST = 'https://gitlab.com'

type GitlabMrPayload = {
  object_kind?: string
  object_attributes?: {
    iid?: number
    action?: string
    last_commit?: { id?: string }
  }
  project?: {
    namespace?: string
    path?: string
    path_with_namespace?: string
  }
}

type GitlabChange = {
  diff?: string
  new_path?: string
  old_path?: string
  new_file?: boolean
  deleted_file?: boolean
}

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

function projectPath(owner: string, name: string): string {
  return `${owner}/${name}`
}

function gitlabClient(token: string): InstanceType<typeof Gitlab> {
  return new Gitlab({ token, host: GITLAB_HOST })
}

function repoFromPayload(body: GitlabMrPayload): { owner?: string; name?: string } {
  const ns = body.project?.namespace
  const path = body.project?.path
  if (ns && path) return { owner: ns, name: path }
  const full = body.project?.path_with_namespace
  if (full?.includes('/')) {
    const idx = full.lastIndexOf('/')
    return { owner: full.slice(0, idx), name: full.slice(idx + 1) }
  }
  return {}
}

function fileStatus(change: GitlabChange): string {
  if (change.new_file) return 'added'
  if (change.deleted_file) return 'removed'
  return 'modified'
}

function appendChangesToDiff(
  out: string,
  changes: GitlabChange[],
  excludeGlobs: string[],
  changedPaths: string[],
): string {
  let result = out
  for (const ch of changes) {
    const filename = ch.new_path ?? ch.old_path
    if (!filename) continue
    if (!filename.toLowerCase().endsWith('.cs')) continue
    if (excludeGlobs.some((g) => minimatch(filename, g, { dot: true }))) continue
    const patch = ch.diff ?? ''
    if (!patch && !ch.new_file && !ch.deleted_file) continue
    changedPaths.push(filename)
    result += `\n## ${filename} (${fileStatus(ch)})\n${patch || '(no patch)'}\n`
    if (result.length > DIFF_MAX_CHARS) {
      result += '\n\n[TRUNCATED: diff exceeded character limit]\n'
      break
    }
  }
  return result
}

export const gitlabProvider: VcsProvider = {
  id: 'gitlab',

  verifyWebhook(req, secret) {
    const token = headerValue(req.headers['x-gitlab-token'])
    if (!token || !secret) return false
    try {
      const a = Buffer.from(token, 'utf8')
      const b = Buffer.from(secret, 'utf8')
      if (a.length !== b.length) return false
      return crypto.timingSafeEqual(a, b)
    } catch {
      return token === secret
    }
  },

  parseMrWebhook(body, _headers) {
    const payload = body as GitlabMrPayload
    const { owner, name } = repoFromPayload(payload)
    if (!owner || !name) return null

    if (payload.object_kind !== 'merge_request') {
      return {
        owner,
        name,
        mrNumber: 0,
        headSha: null,
        accepted: false,
        ignoreReason: 'not merge_request',
      }
    }

    const action = payload.object_attributes?.action
    if (action !== 'open' && action !== 'update' && action !== 'reopen') {
      return {
        owner,
        name,
        mrNumber: 0,
        headSha: null,
        accepted: false,
        ignoreReason: `action ${action}`,
      }
    }

    const mrNumber = payload.object_attributes?.iid
    if (typeof mrNumber !== 'number') return null

    return {
      owner,
      name,
      mrNumber,
      headSha: payload.object_attributes?.last_commit?.id ?? null,
      accepted: true,
    }
  },

  async listOpenMrs(accessToken, owner, name) {
    const api = gitlabClient(accessToken)
    const projectId = projectPath(owner, name)
    const mrs = await api.MergeRequests.all({ projectId, state: 'opened' })
    return mrs.map((mr) => ({
      number: mr.iid,
      headSha: mr.sha ?? null,
    }))
  },

  async buildMrDiff(accessToken, owner, name, mrNumber, excludeGlobs) {
    const api = gitlabClient(accessToken)
    const projectId = projectPath(owner, name)
    const mr = await api.MergeRequests.show(projectId, mrNumber)
    const headSha = mr.sha ?? ''
    const changes = (await api.MergeRequests.showChanges(projectId, mrNumber)) as {
      changes?: GitlabChange[]
    }
    const changedPaths: string[] = []
    let out = appendChangesToDiff('', changes.changes ?? [], excludeGlobs, changedPaths)
    const diffText = out.trim() || '(no .cs file changes in this MR)'
    return { diffText, headSha, changedPaths }
  },

  async submitMrReview(accessToken, owner, name, mrNumber, _headSha, ai, requestSizes) {
    const api = gitlabClient(accessToken)
    const projectId = projectPath(owner, name)
    await api.MergeRequestNotes.create(projectId, mrNumber, formatReviewBody(ai, requestSizes))
  },

  async getDefaultBranch(accessToken, owner, name) {
    const api = gitlabClient(accessToken)
    const project = await api.Projects.show(projectPath(owner, name))
    const branch = project.default_branch
    return typeof branch === 'string' ? branch : null
  },

  async listBranches(accessToken, owner, name) {
    const api = gitlabClient(accessToken)
    const projectId = projectPath(owner, name)
    const out: string[] = []
    let page = 1
    const perPage = 100
    for (;;) {
      const pageBranches = await api.Branches.all(projectId, { perPage, page })
      for (const b of pageBranches) {
        const branchName = typeof b.name === 'string' ? b.name : null
        if (branchName) out.push(branchName)
      }
      if (pageBranches.length < perPage) break
      page += 1
    }
    return out
  },

  async listRecentCommits(accessToken, owner, name, branchName, sinceIso) {
    const api = gitlabClient(accessToken)
    const projectId = projectPath(owner, name)
    const out: PolledCommit[] = []
    let page = 1
    const perPage = 100
    for (;;) {
      const pageCommits = await api.Commits.all(projectId, {
        refName: branchName,
        since: sinceIso,
        perPage,
        page,
      })
      for (const c of pageCommits) {
        const sha = typeof c.id === 'string' ? c.id : null
        if (!sha) continue
        const username = (c as { author_username?: string }).author_username
        const authorName = typeof c.author_name === 'string' ? c.author_name : undefined
        const authorEmail = typeof c.author_email === 'string' ? c.author_email : undefined
        const login = username?.trim() || authorName?.trim() || authorEmail?.trim() || 'unknown'
        out.push({
          sha,
          authorLogin: login,
          authorEmail: authorEmail?.trim() || null,
        })
      }
      if (pageCommits.length < perPage) break
      page += 1
    }
    return out
  },

  async buildCommitBatchDiff(accessToken, owner, name, shas, excludeGlobs) {
    const api = gitlabClient(accessToken)
    const projectId = projectPath(owner, name)
    let out = ''
    const changedPaths = new Set<string>()
    const commitMessages: CommitBatchDiffResult['commitMessages'] = []

    for (const sha of shas) {
      const commit = await api.Commits.show(projectId, sha)
      const message = commit.message ?? '(no message)'
      commitMessages.push({ sha, message })

      out += `\n# Commit ${sha.slice(0, 7)}\n${message.split('\n')[0]}\n`

      const diff = (await api.Commits.showDiff(projectId, sha)) as GitlabChange[]
      const paths: string[] = []
      out = appendChangesToDiff(out, diff, excludeGlobs, paths)
      for (const p of paths) changedPaths.add(p)

      if (out.length > DIFF_MAX_CHARS) {
        out += '\n\n[TRUNCATED: diff exceeded character limit]\n'
        return {
          diffText: out.trim() || '(no .cs file changes in these commits)',
          changedPaths: [...changedPaths],
          commitMessages,
        }
      }
    }

    const diffText = out.trim() || '(no .cs file changes in these commits)'
    return { diffText, changedPaths: [...changedPaths], commitMessages }
  },

  mrUrl(owner, name, mrNumber) {
    return `https://gitlab.com/${owner}/${name}/-/merge_requests/${mrNumber}`
  },

  commitUrl(owner, name, sha) {
    return `https://gitlab.com/${owner}/${name}/-/commit/${sha}`
  },
}

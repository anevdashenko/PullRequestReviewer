import crypto from 'node:crypto'
import { Gitlab } from '@gitbeaker/rest'
import { minimatch } from 'minimatch'
import {
  appendFileChange,
  appendWithBudget,
  type DiffAppendResult,
  type FileChangeStatus,
} from '../lib/diff-content.js'
import { fetchGitlabFileAtRef } from '../lib/gitlab-file-content.js'
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

function fileStatus(change: GitlabChange): FileChangeStatus {
  if (change.new_file) return 'added'
  if (change.deleted_file) return 'removed'
  return 'modified'
}

async function appendChangesToDiffAsync(
  state: DiffAppendResult,
  changes: GitlabChange[],
  excludeGlobs: string[],
  changedPaths: string[],
  ref: string,
  fetchFile: (path: string, ref: string) => Promise<string | null>,
): Promise<DiffAppendResult> {
  let next = state
  for (const ch of changes) {
    if (next.truncated) break
    const filename = ch.new_path ?? ch.old_path
    if (!filename) continue
    if (!filename.toLowerCase().endsWith('.cs')) continue
    if (excludeGlobs.some((g) => minimatch(filename, g, { dot: true }))) continue
    const patch = ch.diff ?? ''
    if (!patch && !ch.new_file && !ch.deleted_file) continue
    changedPaths.push(filename)
    next = await appendFileChange(next, filename, fileStatus(ch), patch, ref, fetchFile)
  }
  return next
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
    const fetchFile = (path: string, fileRef: string) => fetchGitlabFileAtRef(api, projectId, path, fileRef)
    const state = await appendChangesToDiffAsync(
      { out: '', truncated: false, fullFilesAttached: 0 },
      changes.changes ?? [],
      excludeGlobs,
      changedPaths,
      headSha,
      fetchFile,
    )
    const diffText = state.out.trim() || '(no .cs file changes in this MR)'
    return { diffText, headSha, changedPaths, fullFilesAttached: state.fullFilesAttached }
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
    let state: DiffAppendResult = { out: '', truncated: false, fullFilesAttached: 0 }
    const changedPaths = new Set<string>()
    const commitMessages: CommitBatchDiffResult['commitMessages'] = []
    const fetchFile = (path: string, fileRef: string) => fetchGitlabFileAtRef(api, projectId, path, fileRef)

    for (const sha of shas) {
      const commit = await api.Commits.show(projectId, sha)
      const message = commit.message ?? '(no message)'
      commitMessages.push({ sha, message })

      const header = `\n# Commit ${sha.slice(0, 7)}\n${message.split('\n')[0]}\n`
      const afterHeader = appendWithBudget(state.out, header)
      state = {
        out: afterHeader.out,
        truncated: afterHeader.truncated,
        fullFilesAttached: state.fullFilesAttached,
      }
      if (state.truncated) break

      const diff = (await api.Commits.showDiff(projectId, sha)) as GitlabChange[]
      const paths: string[] = []
      state = await appendChangesToDiffAsync(state, diff, excludeGlobs, paths, sha, fetchFile)
      for (const p of paths) changedPaths.add(p)

      if (state.truncated) {
        return {
          diffText: state.out.trim() || '(no .cs file changes in these commits)',
          changedPaths: [...changedPaths],
          commitMessages,
          fullFilesAttached: state.fullFilesAttached,
        }
      }
    }

    const diffText = state.out.trim() || '(no .cs file changes in these commits)'
    return {
      diffText,
      changedPaths: [...changedPaths],
      commitMessages,
      fullFilesAttached: state.fullFilesAttached,
    }
  },

  mrUrl(owner, name, mrNumber) {
    return `https://gitlab.com/${owner}/${name}/-/merge_requests/${mrNumber}`
  },

  commitUrl(owner, name, sha) {
    return `https://gitlab.com/${owner}/${name}/-/commit/${sha}`
  },
}

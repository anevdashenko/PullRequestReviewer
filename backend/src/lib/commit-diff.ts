import { Octokit } from '@octokit/rest'
import { minimatch } from 'minimatch'
import {
  appendFileChange,
  appendWithBudget,
  type DiffAppendResult,
  type FileChangeStatus,
} from './diff-content.js'
import { fetchGithubFileAtRef } from './github-file-content.js'

export type CommitMessageMeta = {
  sha: string
  message: string
}

export type CommitBatchDiffBuildResult = {
  diffText: string
  changedPaths: string[]
  commitMessages: CommitMessageMeta[]
  fullFilesAttached: number
}

function normalizeStatus(status: string | undefined): FileChangeStatus | null {
  if (status === 'added' || status === 'modified' || status === 'removed') return status
  return null
}

export async function buildCommitBatchDiffText(
  octokit: Octokit,
  owner: string,
  repo: string,
  shas: string[],
  excludeGlobs: string[],
): Promise<CommitBatchDiffBuildResult> {
  let state: DiffAppendResult = { out: '', truncated: false, fullFilesAttached: 0 }
  const changedPaths = new Set<string>()
  const commitMessages: CommitMessageMeta[] = []

  const fetchFile = (path: string, ref: string) => fetchGithubFileAtRef(octokit, owner, repo, path, ref)

  for (const sha of shas) {
    const { data: commit } = await octokit.repos.getCommit({ owner, repo, ref: sha })
    const message = commit.commit?.message ?? '(no message)'
    commitMessages.push({ sha, message })

    const header = `\n# Commit ${sha.slice(0, 7)}\n${message.split('\n')[0]}\n`
    const afterHeader = appendWithBudget(state.out, header)
    state = {
      out: afterHeader.out,
      truncated: afterHeader.truncated,
      fullFilesAttached: state.fullFilesAttached,
    }
    if (state.truncated) break

    for (const f of commit.files ?? []) {
      if (!f.filename) continue
      if (!f.filename.toLowerCase().endsWith('.cs')) continue
      if (excludeGlobs.some((g) => minimatch(f.filename, g, { dot: true }))) continue

      const status = normalizeStatus(f.status)
      if (!status) continue

      const patch = f.patch ?? ''
      if (!patch && status !== 'added' && status !== 'removed') continue

      changedPaths.add(f.filename)
      state = await appendFileChange(state, f.filename, status, patch, sha, fetchFile)
      if (state.truncated) {
        return {
          diffText: state.out.trim() || '(no .cs file changes in these commits)',
          changedPaths: [...changedPaths],
          commitMessages,
          fullFilesAttached: state.fullFilesAttached,
        }
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
}

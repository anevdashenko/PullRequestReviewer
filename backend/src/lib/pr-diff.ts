import { Octokit } from '@octokit/rest'
import { minimatch } from 'minimatch'
import {
  appendFileChange,
  type DiffAppendResult,
  type FileChangeStatus,
} from './diff-content.js'
import { fetchGithubFileAtRef } from './github-file-content.js'

export type PrDiffResult = {
  diffText: string
  headSha: string
  changedPaths: string[]
  fullFilesAttached: number
}

function normalizeStatus(status: string | undefined): FileChangeStatus | null {
  if (status === 'added' || status === 'modified' || status === 'removed') return status
  return null
}

export async function buildPrDiffText(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  excludeGlobs: string[],
): Promise<PrDiffResult> {
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber })
  const headSha = pr.head.sha
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  })

  const fetchFile = (path: string, ref: string) => fetchGithubFileAtRef(octokit, owner, repo, path, ref)

  let state: DiffAppendResult = { out: '', truncated: false, fullFilesAttached: 0 }
  const changedPaths: string[] = []

  for (const f of files) {
    if (!f.filename) continue
    if (!f.filename.toLowerCase().endsWith('.cs')) continue
    if (excludeGlobs.some((g) => minimatch(f.filename, g, { dot: true }))) continue

    const status = normalizeStatus(f.status)
    if (!status) continue

    const patch = f.patch ?? ''
    if (!patch && status !== 'added' && status !== 'removed') continue

    changedPaths.push(f.filename)
    state = await appendFileChange(state, f.filename, status, patch, headSha, fetchFile)
    if (state.truncated) break
  }

  const diffText = state.out.trim() || '(no .cs file changes in this PR)'
  return { diffText, headSha, changedPaths, fullFilesAttached: state.fullFilesAttached }
}

import { Octokit } from '@octokit/rest'
import { minimatch } from 'minimatch'
import { DIFF_MAX_CHARS } from './defaults.js'

export type CommitMessageMeta = {
  sha: string
  message: string
}

export async function buildCommitBatchDiffText(
  octokit: Octokit,
  owner: string,
  repo: string,
  shas: string[],
  excludeGlobs: string[],
): Promise<{ diffText: string; changedPaths: string[]; commitMessages: CommitMessageMeta[] }> {
  let out = ''
  const changedPaths = new Set<string>()
  const commitMessages: CommitMessageMeta[] = []

  for (const sha of shas) {
    const { data: commit } = await octokit.repos.getCommit({ owner, repo, ref: sha })
    const message = commit.commit?.message ?? '(no message)'
    commitMessages.push({ sha, message })

    out += `\n# Commit ${sha.slice(0, 7)}\n${message.split('\n')[0]}\n`

    for (const f of commit.files ?? []) {
      if (!f.filename) continue
      if (!f.filename.toLowerCase().endsWith('.cs')) continue
      if (excludeGlobs.some((g) => minimatch(f.filename, g, { dot: true }))) continue
      const patch = f.patch ?? ''
      if (!patch && f.status !== 'added' && f.status !== 'removed') continue
      changedPaths.add(f.filename)
      out += `\n## ${f.filename} (${f.status})\n${patch || '(no patch)'}\n`
      if (out.length > DIFF_MAX_CHARS) {
        out += '\n\n[TRUNCATED: diff exceeded character limit]\n'
        return {
          diffText: out.trim() || '(no .cs file changes in these commits)',
          changedPaths: [...changedPaths],
          commitMessages,
        }
      }
    }
  }

  const diffText = out.trim() || '(no .cs file changes in these commits)'
  return { diffText, changedPaths: [...changedPaths], commitMessages }
}

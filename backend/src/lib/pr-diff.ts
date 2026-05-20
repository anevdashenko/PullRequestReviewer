import { Octokit } from '@octokit/rest'
import { minimatch } from 'minimatch'
import { DIFF_MAX_CHARS } from './defaults.js'

export async function buildPrDiffText(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  excludeGlobs: string[],
): Promise<{ diffText: string; headSha: string; changedPaths: string[] }> {
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber })
  const headSha = pr.head.sha
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  })
  let out = ''
  const changedPaths: string[] = []
  for (const f of files) {
    if (!f.filename) continue
    if (!f.filename.toLowerCase().endsWith('.cs')) continue
    if (excludeGlobs.some((g) => minimatch(f.filename, g, { dot: true }))) continue
    const patch = f.patch ?? ''
    if (!patch && f.status !== 'added' && f.status !== 'removed') continue
    changedPaths.push(f.filename)
    out += `\n## ${f.filename} (${f.status})\n${patch || '(no patch)'}\n`
    if (out.length > DIFF_MAX_CHARS) {
      out += '\n\n[TRUNCATED: diff exceeded character limit]\n'
      break
    }
  }
  const diffText = out.trim() || '(no .cs file changes in this PR)'
  return { diffText, headSha, changedPaths }
}

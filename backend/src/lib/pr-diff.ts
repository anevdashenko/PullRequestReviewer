import { Octokit } from '@octokit/rest'
import { minimatch } from 'minimatch'
import { parseUnifiedPatchRightLines } from './diff-lines.js'

const MAX_CHARS = 120_000

export async function buildPrDiffText(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  excludeGlobs: string[],
): Promise<{ diffText: string; headSha: string; validLinesByPath: Map<string, Set<number>> }> {
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber })
  const headSha = pr.head.sha
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  })
  let out = ''
  const validLinesByPath = new Map<string, Set<number>>()
  for (const f of files) {
    if (!f.filename) continue
    if (excludeGlobs.some((g) => minimatch(f.filename, g, { dot: true }))) continue
    const patch = f.patch ?? ''
    if (!patch && f.status !== 'added' && f.status !== 'removed') continue
    if (patch) validLinesByPath.set(f.filename, parseUnifiedPatchRightLines(patch))
    out += `\n## ${f.filename} (${f.status})\n${patch || '(no patch)'}\n`
    if (out.length > MAX_CHARS) {
      out += '\n\n[TRUNCATED: diff exceeded character limit]\n'
      break
    }
  }
  const diffText = out.trim() || '(no textual diff)'
  return { diffText, headSha, validLinesByPath }
}

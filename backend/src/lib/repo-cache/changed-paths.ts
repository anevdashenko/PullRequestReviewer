import { minimatch } from 'minimatch'
import { execGit } from './git-runner.js'

function filterCsPaths(paths: string[], excludeGlobs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const path = p.trim()
    if (!path || !path.toLowerCase().endsWith('.cs')) continue
    if (excludeGlobs.some((g) => minimatch(path, g, { dot: true }))) continue
    if (seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

function parseNameOnlyOutput(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export async function listChangedPaths(
  workspacePath: string,
  spec: {
    sha: string
    baseSha?: string
    commitShas?: string[]
    excludeGlobs: string[]
  },
): Promise<string[]> {
  const excludeGlobs = spec.excludeGlobs

  if (spec.baseSha) {
    const out = await execGit(['diff', '--name-only', `${spec.baseSha}..${spec.sha}`], workspacePath)
    return filterCsPaths(parseNameOnlyOutput(out), excludeGlobs)
  }

  if (spec.commitShas && spec.commitShas.length > 0) {
    const shas = spec.commitShas
    if (shas.length === 1) {
      const out = await execGit(['show', '--name-only', '--pretty=format:', shas[0]], workspacePath)
      return filterCsPaths(parseNameOnlyOutput(out), excludeGlobs)
    }
    const oldest = shas[0]
    const newest = shas[shas.length - 1]
    const out = await execGit(['diff', '--name-only', `${oldest}^..${newest}`], workspacePath)
    return filterCsPaths(parseNameOnlyOutput(out), excludeGlobs)
  }

  const out = await execGit(['show', '--name-only', '--pretty=format:', spec.sha], workspacePath)
  return filterCsPaths(parseNameOnlyOutput(out), excludeGlobs)
}

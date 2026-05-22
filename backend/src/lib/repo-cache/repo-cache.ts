import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cacheKeyFor, buildCloneUrl } from './clone-url.js'
import { listChangedPaths } from './changed-paths.js'
import { execGit } from './git-runner.js'
import type { SyncWorkspaceResult, SyncWorkspaceSpec } from './types.js'

const DEFAULT_REPO_CACHE_ROOT = '/var/cache/prr/repos'
const REVIEW_BRANCH = '_prr_review'

function resolveRepoCacheRoot(): string {
  return process.env.REPO_CACHE_ROOT?.trim() || DEFAULT_REPO_CACHE_ROOT
}

function resolveFetchDepth(): number | undefined {
  const raw = process.env.REPO_CACHE_FETCH_DEPTH?.trim()
  if (!raw || raw === '0') return undefined
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

function workspacePathFor(spec: SyncWorkspaceSpec): string {
  const key = cacheKeyFor(spec.provider, spec.owner, spec.name)
  return join(resolveRepoCacheRoot(), key)
}

/** Per-repo async mutex (single worker process). */
const lockTails = new Map<string, Promise<void>>()

async function withRepoLock<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = lockTails.get(cacheKey) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  lockTails.set(cacheKey, prev.then(() => gate))
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

async function syncWorkspaceInner(spec: SyncWorkspaceSpec): Promise<SyncWorkspaceResult> {
  const started = Date.now()
  const cacheKey = cacheKeyFor(spec.provider, spec.owner, spec.name)
  const workspacePath = workspacePathFor(spec)
  const cloneUrl = buildCloneUrl(spec.provider, spec.owner, spec.name, spec.accessToken)
  const depth = resolveFetchDepth()

  mkdirSync(join(resolveRepoCacheRoot(), spec.provider, spec.owner), { recursive: true })

  let cloned = false
  const gitDir = join(workspacePath, '.git')

  if (!existsSync(gitDir)) {
    const cloneArgs = ['clone']
    if (depth) cloneArgs.push(`--depth`, String(depth))
    cloneArgs.push(cloneUrl, workspacePath)
    await execGit(cloneArgs)
    cloned = true
  } else {
    await execGit(['remote', 'set-url', 'origin', cloneUrl], workspacePath)
    const fetchArgs = ['fetch', '--prune', 'origin']
    if (depth) fetchArgs.push(`--depth=${depth}`)
    await execGit(fetchArgs, workspacePath)
  }

  await execGit(['fetch', 'origin', spec.sha], workspacePath).catch(() => {
    /* sha may already be present after full fetch */
  })

  await execGit(['checkout', '-B', REVIEW_BRANCH, spec.sha], workspacePath)
  await execGit(['reset', '--hard', spec.sha], workspacePath)
  await execGit(['clean', '-fdx'], workspacePath)

  const changedPaths = await listChangedPaths(workspacePath, {
    sha: spec.sha,
    baseSha: spec.baseSha,
    commitShas: spec.commitShas,
    excludeGlobs: spec.excludeGlobs ?? [],
  })

  return {
    workspacePath,
    cacheKey,
    changedPaths,
    cloned,
    syncMs: Date.now() - started,
  }
}

export async function syncWorkspace(spec: SyncWorkspaceSpec): Promise<SyncWorkspaceResult> {
  const cacheKey = cacheKeyFor(spec.provider, spec.owner, spec.name)
  return withRepoLock(cacheKey, () => syncWorkspaceInner(spec))
}

export function getRepoCacheRoot(): string {
  return resolveRepoCacheRoot()
}

import type { ProviderId } from '../../providers/types.js'

export type SyncWorkspaceSpec = {
  provider: ProviderId
  owner: string
  name: string
  accessToken: string
  branch: string
  sha: string
  /** PR merge base (git diff base..head) */
  baseSha?: string
  /** Commit batch SHAs (oldest first for diff range) */
  commitShas?: string[]
  excludeGlobs?: string[]
}

export type SyncWorkspaceResult = {
  workspacePath: string
  cacheKey: string
  changedPaths: string[]
  cloned: boolean
  syncMs: number
}

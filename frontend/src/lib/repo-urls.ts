export type RepoProvider = 'github' | 'gitlab'

export function normalizeProvider(provider: string | undefined | null): RepoProvider {
  return provider === 'gitlab' ? 'gitlab' : 'github'
}

export function mrUrl(provider: string, owner: string, name: string, mrNumber: number): string {
  const p = normalizeProvider(provider)
  if (p === 'gitlab') {
    return `https://gitlab.com/${owner}/${name}/-/merge_requests/${mrNumber}`
  }
  return `https://github.com/${owner}/${name}/pull/${mrNumber}`
}

export function commitUrl(provider: string, owner: string, name: string, sha: string): string {
  const p = normalizeProvider(provider)
  if (p === 'gitlab') {
    return `https://gitlab.com/${owner}/${name}/-/commit/${sha}`
  }
  return `https://github.com/${owner}/${name}/commit/${sha}`
}

export function webhookPath(provider: RepoProvider): string {
  return provider === 'gitlab' ? '/webhooks/gitlab' : '/webhooks/github'
}

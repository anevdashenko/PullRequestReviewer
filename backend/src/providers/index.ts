import { githubProvider } from './github.js'
import { gitlabProvider } from './gitlab.js'
import type { ProviderId, VcsProvider } from './types.js'

export type { ProviderId, VcsProvider, OpenMr, ParsedMrWebhook, PolledCommit } from './types.js'

const providers: Record<ProviderId, VcsProvider> = {
  github: githubProvider,
  gitlab: gitlabProvider,
}

export function isProviderId(value: string): value is ProviderId {
  return value === 'github' || value === 'gitlab'
}

export function normalizeProviderId(value: string | undefined | null): ProviderId {
  if (value && isProviderId(value)) return value
  return 'github'
}

export function getProvider(id: string): VcsProvider {
  const providerId = normalizeProviderId(id)
  return providers[providerId]
}

export function mrUrl(provider: string, owner: string, name: string, mrNumber: number): string {
  return getProvider(provider).mrUrl(owner, name, mrNumber)
}

export function commitUrl(provider: string, owner: string, name: string, sha: string): string {
  return getProvider(provider).commitUrl(owner, name, sha)
}

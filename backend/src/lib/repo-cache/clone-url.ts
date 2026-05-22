import type { ProviderId } from '../../providers/types.js'

const GITHUB_HOST = process.env.GITHUB_HOST?.trim() || 'github.com'
const GITLAB_HOST = process.env.GITLAB_HOST?.trim() || 'https://gitlab.com'

function encodePathSegment(s: string): string {
  return encodeURIComponent(s).replace(/%2F/g, '/')
}

/** Authenticated HTTPS clone URL (never log return value). */
export function buildCloneUrl(provider: ProviderId, owner: string, name: string, accessToken: string): string {
  const token = encodeURIComponent(accessToken.trim())
  if (provider === 'github') {
    return `https://x-access-token:${token}@${GITHUB_HOST}/${encodePathSegment(owner)}/${encodePathSegment(name)}.git`
  }
  const host = GITLAB_HOST.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://oauth2:${token}@${host}/${encodePathSegment(owner)}/${encodePathSegment(name)}.git`
}

export function cacheKeyFor(provider: ProviderId, owner: string, name: string): string {
  return `${provider}/${owner}/${name}`
}

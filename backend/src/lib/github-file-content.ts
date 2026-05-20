import { Octokit } from '@octokit/rest'

function decodeGitHubContent(data: { content?: string; encoding?: string }): string | null {
  if (!data.content || data.encoding !== 'base64') return null
  try {
    return Buffer.from(data.content, 'base64').toString('utf8')
  } catch {
    return null
  }
}

export async function fetchGithubFileAtRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  if (!ref.trim()) return null
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    })
    if (Array.isArray(data) || data.type !== 'file') return null
    return decodeGitHubContent(data)
  } catch {
    return null
  }
}

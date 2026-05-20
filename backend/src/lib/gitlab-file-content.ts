import type { Gitlab } from '@gitbeaker/rest'

type GitlabApi = InstanceType<typeof Gitlab>

function decodeGitLabContent(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { content?: string; encoding?: string }
  if (typeof obj.content !== 'string') return null
  if (obj.encoding === 'base64') {
    try {
      return Buffer.from(obj.content, 'base64').toString('utf8')
    } catch {
      return null
    }
  }
  return obj.content
}

export async function fetchGitlabFileAtRef(
  api: GitlabApi,
  projectId: string,
  path: string,
  ref: string,
): Promise<string | null> {
  if (!ref.trim()) return null
  try {
    const raw = await api.RepositoryFiles.showRaw(projectId, path, ref)
    if (typeof raw === 'string') return raw
    return decodeGitLabContent(raw)
  } catch {
    try {
      const meta = await api.RepositoryFiles.show(projectId, path, ref)
      return decodeGitLabContent(meta)
    } catch {
      return null
    }
  }
}

import {
  DIFF_MAX_CHARS,
  FILE_MAX_CHARS,
  includeFullFileContent,
  PATCH_MIN_CHARS,
} from './defaults.js'

export const DIFF_TRUNCATED_MARKER = '\n\n[TRUNCATED: diff exceeded character limit]\n'

export type FileChangeStatus = 'added' | 'modified' | 'removed'

export type DiffAppendResult = {
  out: string
  truncated: boolean
  fullFilesAttached: number
}

function normalizePatch(patch: string): string {
  const p = patch.trim()
  return p || '(no patch)'
}

export function shouldAttachFullFile(patch: string): boolean {
  if (!includeFullFileContent()) return false
  const raw = patch.trim()
  if (!raw || raw === '(no patch)') return true
  return raw.length < PATCH_MIN_CHARS
}

export function fullContentWithinLimit(content: string): boolean {
  return content.length <= FILE_MAX_CHARS
}

export function formatFileSection(
  filename: string,
  status: string,
  patch: string,
  fullContent?: string,
): string {
  const patchText = normalizePatch(patch)
  if (!fullContent) {
    return `\n## ${filename} (${status})\n${patchText}\n`
  }
  return [
    `\n## ${filename} (${status})`,
    '',
    '### Full file (HEAD)',
    fullContent,
    '',
    '### Diff',
    patchText,
    '',
  ].join('\n')
}

export function appendWithBudget(out: string, chunk: string, maxChars: number = DIFF_MAX_CHARS): DiffAppendResult {
  const next = out + chunk
  if (next.length <= maxChars) {
    return { out: next, truncated: false, fullFilesAttached: 0 }
  }
  return {
    out: out + DIFF_TRUNCATED_MARKER,
    truncated: true,
    fullFilesAttached: 0,
  }
}

export function canAttachFullFile(status: FileChangeStatus): boolean {
  return status === 'added' || status === 'modified'
}

export async function buildFileSection(
  filename: string,
  status: FileChangeStatus,
  patch: string,
  ref: string,
  fetchFile: (path: string, ref: string) => Promise<string | null>,
): Promise<{ section: string; fullFileAttached: boolean }> {
  let fullContent: string | undefined
  if (canAttachFullFile(status) && shouldAttachFullFile(patch)) {
    const content = await fetchFile(filename, ref)
    if (content && fullContentWithinLimit(content)) {
      fullContent = content
    }
  }
  return {
    section: formatFileSection(filename, status, patch, fullContent),
    fullFileAttached: fullContent !== undefined,
  }
}

export async function appendFileChange(
  state: DiffAppendResult,
  filename: string,
  status: FileChangeStatus,
  patch: string,
  ref: string,
  fetchFile: (path: string, ref: string) => Promise<string | null>,
): Promise<DiffAppendResult> {
  if (state.truncated) return state

  const { section, fullFileAttached } = await buildFileSection(filename, status, patch, ref, fetchFile)
  const appended = appendWithBudget(state.out, section)
  return {
    out: appended.out,
    truncated: appended.truncated,
    fullFilesAttached: state.fullFilesAttached + (fullFileAttached ? 1 : 0),
  }
}

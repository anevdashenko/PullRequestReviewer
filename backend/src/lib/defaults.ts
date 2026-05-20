export const DEFAULT_MODEL =
  process.env.DEFAULT_LLM_MODEL?.trim() || 'qwen2.5-coder-7b-instruct'

const DEFAULT_DIFF_MAX_CHARS = 120_000
const DEFAULT_PATCH_MIN_CHARS = 500
const DEFAULT_FILE_MAX_CHARS = 20_000

function envFlagTrue(raw: string | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

/** Max characters of diff text sent to the LLM per review request (overview + code review share the same diff). */
export function resolveDiffMaxChars(): number {
  const raw = process.env.DIFF_MAX_CHARS?.trim()
  if (!raw) return DEFAULT_DIFF_MAX_CHARS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DIFF_MAX_CHARS
  return n
}

export function includeFullFileContent(): boolean {
  return envFlagTrue(process.env.INCLUDE_FULL_FILE_CONTENT)
}

/** Attach full file when patch is shorter than this (and INCLUDE_FULL_FILE_CONTENT is on). */
export function resolvePatchMinChars(): number {
  const raw = process.env.PATCH_MIN_CHARS?.trim()
  if (!raw) return DEFAULT_PATCH_MIN_CHARS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PATCH_MIN_CHARS
  return n
}

/** Max characters of a single full file block included in the diff. */
export function resolveFileMaxChars(): number {
  const raw = process.env.FILE_MAX_CHARS?.trim()
  if (!raw) return DEFAULT_FILE_MAX_CHARS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FILE_MAX_CHARS
  return n
}

export const DIFF_MAX_CHARS = resolveDiffMaxChars()
export const PATCH_MIN_CHARS = resolvePatchMinChars()
export const FILE_MAX_CHARS = resolveFileMaxChars()

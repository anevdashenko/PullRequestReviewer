export const DEFAULT_MODEL =
  process.env.DEFAULT_LLM_MODEL?.trim() || 'qwen2.5-coder-7b-instruct'

const DEFAULT_DIFF_MAX_CHARS = 120_000

/** Max characters of diff text sent to the LLM per review request (overview + code review share the same diff). */
export function resolveDiffMaxChars(): number {
  const raw = process.env.DIFF_MAX_CHARS?.trim()
  if (!raw) return DEFAULT_DIFF_MAX_CHARS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DIFF_MAX_CHARS
  return n
}

export const DIFF_MAX_CHARS = resolveDiffMaxChars()

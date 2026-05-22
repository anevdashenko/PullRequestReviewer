import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { workerLog } from '../logger.js'
import { getRepoCacheRoot } from '../repo-cache/index.js'

export type QwenCliPhase = 'overview' | 'code_review'

export type QwenCliLogContext = {
  phase: QwenCliPhase
  reviewLogId?: string
  commitBatchReviewId?: string
  workspacePath?: string
}

const DEFAULT_MAX_LOG_CHARS = 500_000

export function resolveQwenCliLogMaxChars(): number {
  const raw = process.env.QWEN_CLI_LOG_MAX_CHARS?.trim()
  if (!raw) return DEFAULT_MAX_LOG_CHARS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_LOG_CHARS
  return n
}

export function isQwenCliLogStreamEnabled(): boolean {
  const raw = process.env.QWEN_CLI_LOG_STREAM?.trim().toLowerCase()
  if (!raw) return true
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no'
}

function truncateLog(text: string): string {
  const max = resolveQwenCliLogMaxChars()
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[TRUNCATED: qwen CLI log exceeded ${max} characters]\n`
}

export function appendQwenCliLogSection(existing: string, section: string): string {
  const combined = existing ? `${existing}\n\n${section}` : section
  return truncateLog(combined)
}

export function formatQwenCliSectionHeader(ctx: QwenCliLogContext, extra?: string): string {
  const ids = [
    ctx.reviewLogId ? `reviewLogId=${ctx.reviewLogId}` : null,
    ctx.commitBatchReviewId ? `commitBatchReviewId=${ctx.commitBatchReviewId}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  const wp = ctx.workspacePath ? ` cwd=${ctx.workspacePath}` : ''
  const tail = extra ? ` ${extra}` : ''
  return `=== qwen-cli ${ctx.phase} ${ids}${wp}${tail} ===`
}

export function logQwenCliChunk(
  ctx: QwenCliLogContext,
  stream: 'stdout' | 'stderr',
  chunk: string,
): void {
  if (!isQwenCliLogStreamEnabled() || !chunk) return
  const lines = chunk.split('\n')
  for (const line of lines) {
    if (line.length === 0) continue
    workerLog.debug(
      {
        event: 'qwen_cli_stream',
        phase: ctx.phase,
        stream,
        reviewLogId: ctx.reviewLogId ?? null,
        commitBatchReviewId: ctx.commitBatchReviewId ?? null,
      },
      line,
    )
  }
}

export function writeQwenCliLogFile(jobKey: string, phase: QwenCliPhase, content: string): string | null {
  const dir = process.env.QWEN_CLI_LOG_DIR?.trim()
  if (!dir) {
    const root = join(getRepoCacheRoot(), 'qwen-logs')
    try {
      mkdirSync(root, { recursive: true })
      const path = join(root, `${jobKey}-${phase}.log`)
      appendFileSync(path, content, 'utf8')
      return path
    } catch {
      return null
    }
  }
  try {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${jobKey}-${phase}.log`)
    appendFileSync(path, content, 'utf8')
    return path
  } catch {
    return null
  }
}

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { workerLog } from '../logger.js'
import {
  appendQwenCliLogSection,
  buildQwenCliLogSectionStart,
  formatQwenCliSectionHeader,
  isQwenCliLogIncludePromptEnabled,
  logQwenCliChunk,
  type QwenCliLogContext,
  type QwenCliPhase,
  writeQwenCliLogFile,
} from './qwen-cli-log.js'
import type { ReviewLlmInput } from './types.js'

const DEFAULT_QWEN_CLI_PATH = 'qwen'
const DEFAULT_QWEN_SETTINGS_PATH = '/root/.qwen/settings.json'
const DEFAULT_QWEN_CLI_TIMEOUT_MS = 600_000

function resolveQwenCliPath(): string {
  return process.env.QWEN_CLI_PATH?.trim() || DEFAULT_QWEN_CLI_PATH
}

function resolveQwenSettingsPath(): string {
  return process.env.QWEN_SETTINGS_PATH?.trim() || DEFAULT_QWEN_SETTINGS_PATH
}

function resolveQwenTimeoutMs(): number {
  const raw = process.env.QWEN_CLI_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_QWEN_CLI_TIMEOUT_MS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_QWEN_CLI_TIMEOUT_MS
  return n
}

function parseExtraArgs(): string[] {
  const raw = process.env.QWEN_CLI_EXTRA_ARGS?.trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function jobKey(input: ReviewLlmInput): string {
  return input.reviewLogId ?? input.commitBatchReviewId ?? 'unknown'
}

/** Qwen CLI reads ~/.qwen/settings.json; sync mounted config into home before each run. */
function ensureQwenHomeSettings(): void {
  const src = resolveQwenSettingsPath()
  if (!existsSync(src)) {
    throw new Error(`Qwen settings not found at ${src}`)
  }
  const destDir = join(homedir(), '.qwen')
  const dest = join(destDir, 'settings.json')
  mkdirSync(destDir, { recursive: true })
  copyFileSync(src, dest)
}

export type QwenCliRunResult = {
  stdout: string
  logSection: string
}

export function runQwenCli(prompt: string, workspacePath: string, ctx: QwenCliLogContext): Promise<QwenCliRunResult> {
  ensureQwenHomeSettings()
  const cliPath = resolveQwenCliPath()
  const timeoutMs = resolveQwenTimeoutMs()
  const home = homedir()
  const args = ['-p', prompt, '--yolo', ...parseExtraArgs()]
  const started = Date.now()

  workerLog.info(
    {
      event: 'qwen_cli_start',
      phase: ctx.phase,
      reviewLogId: ctx.reviewLogId ?? null,
      commitBatchReviewId: ctx.commitBatchReviewId ?? null,
      workspacePath,
      promptChars: prompt.length,
    },
    formatQwenCliSectionHeader(ctx, 'started'),
  )

  const commandLine = `${cliPath} -p <prompt> --yolo ${parseExtraArgs().join(' ')}`.trim()
  const sectionParts: string[] = [
    buildQwenCliLogSectionStart(ctx, {
      startedAt: new Date(started),
      promptChars: prompt.length,
      commandLine,
      prompt: isQwenCliLogIncludePromptEnabled() ? prompt : undefined,
    }),
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        HOME: home,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Qwen CLI timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      logQwenCliChunk(ctx, 'stdout', text)
      sectionParts.push(text)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      logQwenCliChunk(ctx, 'stderr', text)
      sectionParts.push(`[stderr] ${text}`)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`Qwen CLI spawn failed: ${err.message}`))
    })

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const ms = Date.now() - started
      sectionParts.push('')
      sectionParts.push(formatQwenCliSectionHeader(ctx, `finished exit=${code ?? signal} ms=${ms}`))

      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit ${code ?? signal}`
        workerLog.error(
          {
            event: 'qwen_cli_failed',
            phase: ctx.phase,
            reviewLogId: ctx.reviewLogId ?? null,
            commitBatchReviewId: ctx.commitBatchReviewId ?? null,
            exitCode: code,
            ms,
          },
          detail.slice(0, 500),
        )
        reject(new Error(`Qwen CLI exited with code ${code}: ${detail.slice(0, 2000)}`))
        return
      }
      const out = stdout.trim()
      if (!out) {
        reject(new Error(`Qwen CLI returned empty stdout${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ''}`))
        return
      }
      workerLog.info(
        {
          event: 'qwen_cli_done',
          phase: ctx.phase,
          reviewLogId: ctx.reviewLogId ?? null,
          commitBatchReviewId: ctx.commitBatchReviewId ?? null,
          ms,
          stdoutChars: out.length,
          stderrChars: stderr.length,
        },
        formatQwenCliSectionHeader(ctx, `done ms=${ms}`),
      )
      resolve({ stdout: out, logSection: sectionParts.join('\n') })
    })
  })
}

export async function persistQwenCliPhaseLog(
  input: ReviewLlmInput,
  phase: QwenCliPhase,
  logSection: string,
): Promise<void> {
  if (!input.qwenCliLog) {
    input.qwenCliLog = { text: '' }
  }
  input.qwenCliLog.text = appendQwenCliLogSection(input.qwenCliLog.text, logSection)
  writeQwenCliLogFile(jobKey(input), phase, logSection)
  if (input.onQwenCliLogUpdate) {
    await input.onQwenCliLogUpdate(input.qwenCliLog.text)
  }
}

export function assertQwenCliEnvironment(): void {
  const settingsPath = resolveQwenSettingsPath()
  if (!existsSync(settingsPath)) {
    throw new Error(
      `Qwen settings not found at ${settingsPath} (mount config/qwen/settings.json or set QWEN_SETTINGS_PATH)`,
    )
  }
  const git = spawnSync('git', ['--version'], { stdio: 'ignore' })
  if (git.status !== 0) {
    throw new Error('git is not available in PATH (required for Qwen CLI workspace reviews)')
  }
}

export async function assertQwenCliReady(): Promise<void> {
  const settingsPath = resolveQwenSettingsPath()
  try {
    await access(settingsPath, constants.R_OK)
  } catch {
    throw new Error(
      `Qwen settings not found at ${settingsPath} (mount config/qwen/settings.json or set QWEN_SETTINGS_PATH)`,
    )
  }
  assertQwenCliEnvironment()
}

export function getQwenCliStartupInfo(): Record<string, unknown> {
  return {
    qwenCliPath: resolveQwenCliPath(),
    qwenSettingsPath: resolveQwenSettingsPath(),
    qwenCliTimeoutMs: resolveQwenTimeoutMs(),
    qwenCliLogStream: process.env.QWEN_CLI_LOG_STREAM?.trim() ?? 'true',
    qwenCliLogIncludePrompt: isQwenCliLogIncludePromptEnabled(),
    repoCacheRoot: process.env.REPO_CACHE_ROOT?.trim() || '/var/cache/prr/repos',
  }
}

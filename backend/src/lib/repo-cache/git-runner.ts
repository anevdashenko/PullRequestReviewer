import { spawn } from 'node:child_process'

const DEFAULT_GIT_TIMEOUT_MS = 300_000

export function resolveGitTimeoutMs(): number {
  const raw = process.env.REPO_CACHE_GIT_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_GIT_TIMEOUT_MS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GIT_TIMEOUT_MS
  return n
}

export async function execGit(args: string[], cwd?: string): Promise<string> {
  const timeoutMs = resolveGitTimeoutMs()
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`git spawn failed: ${err.message}`))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        const detail = (stderr || stdout).trim().slice(0, 2000)
        reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${detail}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

export async function assertGitAvailable(): Promise<void> {
  await execGit(['--version'])
}

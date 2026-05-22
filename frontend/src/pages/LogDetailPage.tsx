import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { mrUrl } from '../lib/repo-urls'

type LogDetail = {
  id: string
  repoId: string
  prNumber: number
  commitSha: string | null
  status: string
  errorMessage: string | null
  rawAiOutput: string | null
  qwenCliLog: string | null
  createdAt: string
  finishedAt: string | null
  repository: { id: string; owner: string; name: string; provider: string }
}

export default function LogDetailPage() {
  const { logId, repoId } = useParams<{ logId: string; repoId?: string }>()
  const [log, setLog] = useState<LogDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!logId) return
    setError(null)
    api<LogDetail>(`/api/review-logs/${logId}`)
      .then(setLog)
      .catch((e: Error) => setError(e.message))
  }, [logId])

  const repo = log?.repository
  const prUrl =
    repo && log ? mrUrl(repo.provider, repo.owner, repo.name, log.prNumber) : null

  return (
    <>
      <p>
        {repoId ? (
          <Link to={`/repos/${repoId}/logs`}>← Repository logs</Link>
        ) : (
          <Link to="/logs">← All logs</Link>
        )}
        {' · '}
        <Link to="/">Repositories</Link>
      </p>
      <h1>PR review log</h1>
      {error && <p className="error">{error}</p>}
      {log && (
        <>
          <div className="card">
            <p>
              <strong>Repo:</strong>{' '}
              <span className="mono">
                {repo?.owner}/{repo?.name}
              </span>
            </p>
            <p>
              <strong>PR:</strong>{' '}
              {prUrl ? (
                <a href={prUrl} target="_blank" rel="noreferrer">
                  #{log.prNumber}
                </a>
              ) : (
                <>#{log.prNumber}</>
              )}
            </p>
            <p>
              <strong>Status:</strong> {log.status}
              {log.commitSha && (
                <>
                  {' '}
                  · <strong>SHA:</strong> <code>{log.commitSha.slice(0, 7)}</code>
                </>
              )}
            </p>
            <p>
              <strong>Created:</strong> {new Date(log.createdAt).toLocaleString()}
              {log.finishedAt && (
                <>
                  {' '}
                  · <strong>Finished:</strong> {new Date(log.finishedAt).toLocaleString()}
                </>
              )}
            </p>
            {log.errorMessage && <p className="error">{log.errorMessage}</p>}
          </div>

          {log.qwenCliLog && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Qwen CLI log</h2>
              <p className="muted">Stdout/stderr captured during overview and code review phases.</p>
              <pre className="log-viewer">{log.qwenCliLog}</pre>
            </div>
          )}

          {log.rawAiOutput && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>AI JSON output</h2>
              <pre className="log-viewer">{log.rawAiOutput}</pre>
            </div>
          )}

          {!log.qwenCliLog && !log.rawAiOutput && log.status === 'running' && (
            <div className="card">
              <p>Review in progress. Refresh to load Qwen CLI log (updated after each phase).</p>
            </div>
          )}
        </>
      )}
    </>
  )
}

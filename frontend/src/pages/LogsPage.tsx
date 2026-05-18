import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

type LogRow = {
  id: string
  repoId: string
  prNumber: number
  commitSha: string | null
  status: string
  errorMessage: string | null
  rawAiOutput: string | null
  createdAt: string
  finishedAt: string | null
  repository?: { owner: string; name: string }
}

export default function LogsPage() {
  const { repoId } = useParams<{ repoId?: string }>()
  const [rows, setRows] = useState<LogRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    const path = repoId ? `/api/repos/${repoId}/logs?limit=80` : '/api/logs?limit=100'
    api<LogRow[]>(path)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [repoId])

  return (
    <>
      {!repoId && <h1>Review logs</h1>}
      {repoId && (
        <p>
          <Link to="/">← Repositories</Link> · <Link to="/logs">All logs</Link>
        </p>
      )}
      {repoId && <h1>Repository logs</h1>}
      {error && <p className="error">{error}</p>}
      <div className="card" style={{ overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <p>No logs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Repo</th>
                <th>PR</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const slug = r.repository ? `${r.repository.owner}/${r.repository.name}` : r.repoId
                const prUrl =
                  r.repository &&
                  `https://github.com/${r.repository.owner}/${r.repository.name}/pull/${r.prNumber}`
                return (
                  <tr key={r.id}>
                    <td className="mono">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="mono">{slug}</td>
                    <td>
                      {prUrl ? (
                        <a href={prUrl} target="_blank" rel="noreferrer">
                          #{r.prNumber}
                        </a>
                      ) : (
                        <>#{r.prNumber}</>
                      )}
                    </td>
                    <td>{r.status}</td>
                    <td className="mono" style={{ maxWidth: 360 }}>
                      {r.errorMessage && <span className="error">{r.errorMessage}</span>}
                      {r.rawAiOutput && !r.errorMessage && <span title={r.rawAiOutput}>AI output stored</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

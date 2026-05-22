import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

type ReviewRow = {
  id: string
  branchName: string
  authorLogin: string
  authorEmail: string | null
  periodStart: string
  periodEnd: string
  commitCount: number
  status: string
  seenByUser: boolean
  createdAt: string
  finishedAt: string | null
}

type RepoInfo = {
  id: string
  owner: string
  name: string
}

export default function CommitReviewsListPage() {
  const { repoId } = useParams<{ repoId: string }>()
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (!repoId) return
    setError(null)
    Promise.all([
      api<RepoInfo & { provider: string }>(`/api/repos/${repoId}`),
      api<ReviewRow[]>(`/api/repos/${repoId}/commit-reviews?limit=100`),
    ])
      .then(([r, reviews]) => {
        setRepo({ id: r.id, owner: r.owner, name: r.name })
        setRows(reviews)
      })
      .catch((e: Error) => setError(e.message))
  }, [repoId])

  const clearReviews = async () => {
    if (!repoId || !repo) return
    const label = `${repo.owner}/${repo.name}`
    if (
      !confirm(
        `Clear all commit reviews and the reviewed-commit history for ${label}? Unreviewed commits in the lookback window will be scheduled again immediately if commit review is enabled. This cannot be undone.`,
      )
    ) {
      return
    }
    setClearing(true)
    setError(null)
    try {
      await api(`/api/repos/${repoId}/commit-reviews`, { method: 'DELETE' })
      setRows([])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <p>
        <Link to="/commit-reviews">← Commit reviews</Link>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{repo ? `${repo.owner}/${repo.name}` : 'Reviews'}</h1>
        {repoId && (
          <button
            type="button"
            className="danger"
            style={{ marginTop: 0 }}
            disabled={clearing || !repo}
            onClick={() => void clearReviews()}
          >
            {clearing ? 'Clearing…' : 'Clear reviews'}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {rows.length === 0 ? (
          <p>No reviews for this repository.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Viewed</th>
                <th>Branch</th>
                <th>Author</th>
                <th>Commits</th>
                <th>Period</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.seenByUser ? 'review-row-seen' : 'review-row-new'}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td className={r.seenByUser ? 'success' : 'error'}>{r.seenByUser ? 'seen' : 'new'}</td>
                  <td className="mono">{r.branchName}</td>
                  <td className="mono">{r.authorLogin}</td>
                  <td>{r.commitCount}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {new Date(r.periodStart).toLocaleDateString()} — {new Date(r.periodEnd).toLocaleDateString()}
                  </td>
                  <td>{r.status}</td>
                  <td>
                    <Link to={`/commit-reviews/${repoId}/${r.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

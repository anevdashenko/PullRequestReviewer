import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

type RepoWithReviews = {
  id: string
  provider: string
  owner: string
  name: string
  reviewCount: number
}

export default function CommitReviewReposPage() {
  const [rows, setRows] = useState<RepoWithReviews[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    api<RepoWithReviews[]>('/api/commit-reviews/repos')
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <>
      <h1>Commit reviews</h1>
      <p style={{ marginTop: 0, color: '#475569' }}>
        Repositories with at least one completed or in-progress commit batch review.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {rows.length === 0 ? (
          <p>No commit reviews yet. Enable &quot;Commit review&quot; on a repository and wait for the poll.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Repository</th>
                <th>Reviews</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">
                    {r.owner}/{r.name}
                  </td>
                  <td>{r.reviewCount}</td>
                  <td>
                    <Link to={`/commit-reviews/${r.id}`}>View reviews</Link>
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

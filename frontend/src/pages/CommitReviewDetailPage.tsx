import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'
import { commitUrl } from '../lib/repo-urls'

type ReviewDetail = {
  id: string
  repoId: string
  repository: { id: string; owner: string; name: string; provider: string }
  branchName: string
  authorLogin: string
  authorEmail: string | null
  periodStart: string
  periodEnd: string
  commitShas: string[]
  commitCount: number
  status: string
  seenByUser: boolean
  mdContent: string | null
  errorMessage: string | null
  qwenCliLog: string | null
  createdAt: string
  finishedAt: string | null
}

export default function CommitReviewDetailPage() {
  const { repoId, reviewId } = useParams<{ repoId: string; reviewId: string }>()
  const [review, setReview] = useState<ReviewDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)

  async function markSeen() {
    if (!reviewId || !review || review.seenByUser) return
    setMarking(true)
    setError(null)
    try {
      const updated = await api<{ id: string; seenByUser: boolean }>(`/api/commit-reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ seenByUser: true }),
      })
      setReview((prev) => (prev ? { ...prev, seenByUser: updated.seenByUser } : prev))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as seen')
    } finally {
      setMarking(false)
    }
  }

  useEffect(() => {
    if (!reviewId) return
    setError(null)
    api<ReviewDetail>(`/api/commit-reviews/${reviewId}`)
      .then(setReview)
      .catch((e: Error) => setError(e.message))
  }, [reviewId])

  const repo = review?.repository

  return (
    <>
      <p>
        <Link to="/commit-reviews">← Commit reviews</Link>
        {repo && (
          <>
            {' · '}
            <Link to={`/commit-reviews/${repoId ?? review.repoId}`}>
              {repo.owner}/{repo.name}
            </Link>
          </>
        )}
      </p>
      <h1>Commit batch review</h1>

      {error && <p className="error">{error}</p>}

      {review && (
        <>
          <div className="card">
            <p>
              <strong>Branch:</strong> <span className="mono">{review.branchName}</span>
            </p>
            <p>
              <strong>Author:</strong> <span className="mono">{review.authorLogin}</span>
            </p>
            <p>
              <strong>Status:</strong> {review.status}
              {' · '}
              <strong>Viewed:</strong>{' '}
              <span className={review.seenByUser ? 'success' : 'error'}>
                {review.seenByUser ? 'seen' : 'new'}
              </span>
            </p>
            <p>
              <button
                type="button"
                className="secondary"
                disabled={review.seenByUser || marking}
                onClick={() => void markSeen()}
              >
                {review.seenByUser ? 'Seen' : marking ? 'Marking…' : 'Mark seen'}
              </button>
            </p>
            <p>
              <strong>Period:</strong> {new Date(review.periodStart).toLocaleString()} —{' '}
              {new Date(review.periodEnd).toLocaleString()}
            </p>
            <p>
              <strong>Commits ({review.commitCount}):</strong>
            </p>
            <ul>
              {review.commitShas.map((sha) => (
                <li key={sha}>
                  <a
                    href={commitUrl(
                      review.repository.provider,
                      review.repository.owner,
                      review.repository.name,
                      sha,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <code>{sha.slice(0, 7)}</code>
                  </a>
                </li>
              ))}
            </ul>
            {review.errorMessage && <p className="error">{review.errorMessage}</p>}
          </div>

          {review.qwenCliLog && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Qwen CLI log</h2>
              <p className="muted">Captured during overview and code review. Refresh while running to see updates.</p>
              <pre className="log-viewer">{review.qwenCliLog}</pre>
            </div>
          )}

          {review.status === 'done' && review.mdContent ? (
            <div className="card markdown-body">
              <ReactMarkdown>{review.mdContent}</ReactMarkdown>
            </div>
          ) : review.status !== 'done' && !review.qwenCliLog ? (
            <div className="card">
              <p>Review is not ready yet ({review.status}).</p>
            </div>
          ) : review.status !== 'done' ? null : (
            <div className="card">
              <p>No markdown content stored.</p>
            </div>
          )}
        </>
      )}
    </>
  )
}

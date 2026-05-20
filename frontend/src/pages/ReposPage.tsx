import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { normalizeProvider, webhookPath, type RepoProvider } from '../lib/repo-urls'

const DEFAULT_MODEL = 'qwen2.5-coder-7b-instruct'

type RepoRow = {
  id: string
  provider: string
  owner: string
  name: string
  createdAt: string
  prReviewEnabled: boolean
  commitReviewEnabled: boolean
  hasRules: boolean
  model: string | null
}

export default function ReposPage() {
  const [rows, setRows] = useState<RepoRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const initialForm = () => ({
    provider: 'github' as RepoProvider,
    owner: '',
    name: '',
    accessToken: '',
    webhookSecret: '',
    model: DEFAULT_MODEL,
    prReviewEnabled: true,
    commitReviewEnabled: false,
  })
  const [form, setForm] = useState(initialForm())
  const [busy, setBusy] = useState(false)
  const [modelEdits, setModelEdits] = useState<Record<string, string>>({})
  const [savingModelId, setSavingModelId] = useState<string | null>(null)
  const [togglingPrId, setTogglingPrId] = useState<string | null>(null)
  const [togglingCommitId, setTogglingCommitId] = useState<string | null>(null)
  const apiPublicBase = import.meta.env.VITE_PUBLIC_API_URL ?? 'http://localhost:3000'
  const webhookUrl = `${apiPublicBase.replace(/\/$/, '')}${webhookPath(form.provider)}`
  const isGitlab = form.provider === 'gitlab'

  const load = () => {
    setError(null)
    api<RepoRow[]>('/api/repos')
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }

  useEffect(() => {
    load()
  }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api<{ id: string }>('/api/repos', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setForm(initialForm())
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const modelForRow = (r: RepoRow) => modelEdits[r.id] ?? r.model ?? DEFAULT_MODEL

  const saveModel = async (id: string) => {
    const model = modelEdits[id]?.trim()
    if (!model) return
    setSavingModelId(id)
    setError(null)
    try {
      await api(`/api/repos/${id}/rules`, {
        method: 'PUT',
        body: JSON.stringify({ model }),
      })
      setModelEdits((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingModelId(null)
    }
  }

  const togglePrReview = async (id: string, enabled: boolean) => {
    setTogglingPrId(id)
    setError(null)
    try {
      await api(`/api/repos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ prReviewEnabled: enabled }),
      })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTogglingPrId(null)
    }
  }

  const toggleCommitReview = async (id: string, enabled: boolean) => {
    setTogglingCommitId(id)
    setError(null)
    try {
      await api(`/api/repos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ commitReviewEnabled: enabled }),
      })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTogglingCommitId(null)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this repository and its logs?')) return
    setError(null)
    try {
      await api(`/api/repos/${id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <h1>Repositories</h1>
      <p className="mono" style={{ marginTop: 0 }}>
        Webhook URL for <strong>{form.provider}</strong> (must reach the API — use ngrok URL in production):{' '}
        <code>{webhookUrl}</code>
      </p>
      {isGitlab ? (
        <p style={{ fontSize: '0.9rem', color: '#475569' }}>
          In GitLab: Project → Settings → Webhooks. URL as above. Enable <strong>Merge request events</strong>.
          Secret token must match the value stored for this repo.
        </p>
      ) : (
        <p style={{ fontSize: '0.9rem', color: '#475569' }}>
          In GitHub: Settings → Webhooks → Add webhook. Content type <strong>application/json</strong>. Events:{' '}
          <strong>Pull requests</strong>. Secret must match the value stored for this repo.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add repository</h2>
        <form onSubmit={add}>
          <label>Provider</label>
          <select
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value as RepoProvider })}
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
          <label>{isGitlab ? 'Namespace (group or user)' : 'Owner (org or user)'}</label>
          <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} required />
          <label>{isGitlab ? 'Project path (slug)' : 'Repository name'}</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label>
            {isGitlab ? 'GitLab Personal Access Token (api, read_repository, write_repository)' : 'GitHub access token (repo scope)'}
          </label>
          <input
            type="password"
            value={form.accessToken}
            onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
            required
            autoComplete="off"
          />
          <label>
            {isGitlab ? 'Webhook secret token (same as in GitLab webhook settings)' : 'Webhook secret (same as in GitHub webhook settings)'}
          </label>
          <input
            type="password"
            value={form.webhookSecret}
            onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
            required
            autoComplete="off"
          />
          <label>LLM model</label>
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder={DEFAULT_MODEL}
            required
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={form.prReviewEnabled}
              onChange={(e) => setForm({ ...form, prReviewEnabled: e.target.checked })}
            />
            PR / MR review (webhooks and PR poll)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={form.commitReviewEnabled}
              onChange={(e) => setForm({ ...form, commitReviewEnabled: e.target.checked })}
            />
            Commit review (commit poll batches by author)
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Add'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Connected</h2>
        {rows.length === 0 ? (
          <p>No repositories yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Repo</th>
                <th>PR / MR review</th>
                <th>Commit review</th>
                <th>Model</th>
                <th>Rules</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{normalizeProvider(r.provider)}</td>
                  <td>
                    <span className="mono">
                      {r.owner}/{r.name}
                    </span>
                  </td>
                  <td>
                    <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        checked={r.prReviewEnabled}
                        disabled={togglingPrId === r.id}
                        onChange={(e) => togglePrReview(r.id, e.target.checked)}
                      />
                      {togglingPrId === r.id ? '…' : 'enabled'}
                    </label>
                  </td>
                  <td>
                    <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        checked={r.commitReviewEnabled}
                        disabled={togglingCommitId === r.id}
                        onChange={(e) => toggleCommitReview(r.id, e.target.checked)}
                      />
                      {togglingCommitId === r.id ? '…' : 'enabled'}
                    </label>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        className="mono"
                        style={{ minWidth: '12rem', margin: 0 }}
                        value={modelForRow(r)}
                        onChange={(e) => setModelEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        style={{ marginTop: 0 }}
                        disabled={
                          savingModelId === r.id ||
                          modelForRow(r).trim() === (r.model ?? DEFAULT_MODEL)
                        }
                        onClick={() => saveModel(r.id)}
                      >
                        {savingModelId === r.id ? '…' : 'Save'}
                      </button>
                    </div>
                  </td>
                  <td>{r.hasRules ? 'yes' : 'no'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link to={`/repos/${r.id}/rules`}>Rules</Link>
                    {' · '}
                    <Link to={`/repos/${r.id}/logs`}>Logs</Link>
                    {' · '}
                    <button type="button" className="danger" style={{ marginTop: 0 }} onClick={() => remove(r.id)}>
                      Delete
                    </button>
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

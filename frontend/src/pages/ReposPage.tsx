import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

const DEFAULT_MODEL = 'qwen2.5-coder-7b-instruct'

type RepoRow = {
  id: string
  provider: string
  owner: string
  name: string
  createdAt: string
  hasRules: boolean
  model: string | null
}

export default function ReposPage() {
  const [rows, setRows] = useState<RepoRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    owner: '',
    name: '',
    accessToken: '',
    webhookSecret: '',
    model: DEFAULT_MODEL,
  })
  const [busy, setBusy] = useState(false)
  const [modelEdits, setModelEdits] = useState<Record<string, string>>({})
  const [savingModelId, setSavingModelId] = useState<string | null>(null)
  const apiPublicBase = import.meta.env.VITE_PUBLIC_API_URL ?? 'http://localhost:3000'
  const webhookUrl = `${apiPublicBase.replace(/\/$/, '')}/webhooks/github`

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
      let formBody = JSON.stringify(form);
      console.log("Send form for add ", formBody);
      
      await api<{ id: string }>('/api/repos', {
        method: 'POST',
        body: formBody,
      })
      setForm({ owner: '', name: '', accessToken: '', webhookSecret: '', model: DEFAULT_MODEL })
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
        GitHub webhook URL (must reach the API — use ngrok URL in production): <code>{webhookUrl}</code>
      </p>
      <p style={{ fontSize: '0.9rem', color: '#475569' }}>
        In GitHub: Settings → Webhooks → Add webhook. Content type <strong>application/json</strong>. Events:{' '}
        <strong>Pull requests</strong>. Secret must match the value stored for this repo.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add repository</h2>
        <form onSubmit={add}>
          <label>Owner (org or user)</label>
          <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} required />
          <label>Repository name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label>GitHub access token (repo scope)</label>
          <input
            type="password"
            value={form.accessToken}
            onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
            required
            autoComplete="off"
          />
          <label>Webhook secret (same as in GitHub webhook settings)</label>
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
                <th>Repo</th>
                <th>Model</th>
                <th>Rules</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="mono">
                      {r.owner}/{r.name}
                    </span>
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

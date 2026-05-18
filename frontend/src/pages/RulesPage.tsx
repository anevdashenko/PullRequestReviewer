import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'

type RepoDetail = {
  id: string
  owner: string
  name: string
  rules: { systemPrompt: string; excludeGlobs: string[]; model: string } | null
}

export default function RulesPage() {
  const { id } = useParams<{ id: string }>()
  const [repo, setRepo] = useState<RepoDetail | null>(null)
  const [prompt, setPrompt] = useState('')
  const [globs, setGlobs] = useState('')
  const [model, setModel] = useState('qwen2.5-coder-7b-instruct')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!id) return
    setError(null)
    api<RepoDetail>(`/api/repos/${id}`)
      .then((r) => {
        setRepo(r)
        if (r.rules) {
          setPrompt(r.rules.systemPrompt)
          setGlobs((r.rules.excludeGlobs ?? []).join('\n'))
          setModel(r.rules.model)
        }
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setError(null)
    setSaved(false)
    try {
      const excludeGlobs = globs
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      await api(`/api/repos/${id}/rules`, {
        method: 'PUT',
        body: JSON.stringify({ systemPrompt: prompt, excludeGlobs, model }),
      })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!id) return <p>Missing id</p>

  return (
    <>
      <p>
        <Link to="/">← Repositories</Link>
      </p>
      <h1>Review rules</h1>
      {repo && (
        <p className="mono">
          {repo.owner}/{repo.name}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {saved && <p className="success">Saved.</p>}
      <form className="card" onSubmit={save}>
        <label>OpenAI model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} />
        <label>System prompt</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
        <label>Exclude file globs (one per line, e.g. <code>*.lock</code>)</label>
        <textarea value={globs} onChange={(e) => setGlobs(e.target.value)} placeholder={'*.md\npackage-lock.json'} />
        <button type="submit">Save rules</button>
      </form>
    </>
  )
}

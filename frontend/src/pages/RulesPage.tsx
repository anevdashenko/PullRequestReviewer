import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'

type ReviewPipelineStep = {
  id: string
  name: string
  enabled: boolean
  prompt: string
}

type ReviewPipelineConfig = {
  version: 1
  steps: ReviewPipelineStep[]
}

type RepoRules = {
  systemPrompt: string
  excludeGlobs: string[]
  model: string
  reviewPipeline: ReviewPipelineConfig
  defaults: {
    defaultReviewPipeline: ReviewPipelineConfig
    systemPrompt: string
  }
}

type RepoDetail = {
  id: string
  owner: string
  name: string
  rules: RepoRules | null
}

export default function RulesPage() {
  const { id } = useParams<{ id: string }>()
  const [repo, setRepo] = useState<RepoDetail | null>(null)
  const [defaultPipeline, setDefaultPipeline] = useState<ReviewPipelineConfig | null>(null)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [pipelineJson, setPipelineJson] = useState('')
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
          setDefaultPipeline(r.rules.defaults.defaultReviewPipeline)
          setSystemPrompt(r.rules.systemPrompt)
          setPipelineJson(JSON.stringify(r.rules.reviewPipeline, null, 2))
          setGlobs((r.rules.excludeGlobs ?? []).join('\n'))
          setModel(r.rules.model)
        }
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  const resetPipelineToDefault = () => {
    if (defaultPipeline) {
      setPipelineJson(JSON.stringify(defaultPipeline, null, 2))
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setError(null)
    setSaved(false)
    let reviewPipeline: ReviewPipelineConfig
    try {
      reviewPipeline = JSON.parse(pipelineJson) as ReviewPipelineConfig
    } catch {
      setError('Review pipeline: invalid JSON')
      return
    }
    try {
      const excludeGlobs = globs
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      await api(`/api/repos/${id}/rules`, {
        method: 'PUT',
        body: JSON.stringify({
          systemPrompt,
          excludeGlobs,
          model,
          reviewPipeline,
        }),
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

        <h2>Repository rules</h2>
        <p className="muted small">Appended to every review pipeline step as &quot;Repository rules&quot;.</p>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} required rows={3} />

        <h2>Review pipeline (JSON)</h2>
        <p className="muted small">
          Steps run sequentially via Qwen CLI after the repo workspace is synced. Each enabled step becomes a
          separate section in the review comment. Default template:{' '}
          <code>config/review-pipeline.default.json</code>
        </p>
        <textarea
          value={pipelineJson}
          onChange={(e) => setPipelineJson(e.target.value)}
          rows={24}
          className="mono"
          spellCheck={false}
        />
        <p>
          <button type="button" className="secondary" onClick={resetPipelineToDefault} disabled={!defaultPipeline}>
            Reset pipeline to default
          </button>
        </p>

        <h2>Diff filters</h2>
        <label>Exclude file globs (one per line, e.g. <code>*.lock</code>)</label>
        <textarea value={globs} onChange={(e) => setGlobs(e.target.value)} placeholder={'*.md\npackage-lock.json'} />

        <button type="submit">Save rules</button>
      </form>
    </>
  )
}

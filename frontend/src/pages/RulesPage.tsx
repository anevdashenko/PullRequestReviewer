import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'

type PromptDefaults = {
  systemPrompt: string
  prOverviewPrompt: string
  prCodeReviewPrompt: string
  batchOverviewPrompt: string
  batchCodeReviewPrompt: string
  overviewJsonPrompt: string
  codeReviewJsonPrompt: string
  overviewJsonSchemaPr: string
  overviewJsonSchemaBatch: string
  codeReviewJsonSchema: string
}

type RepoRules = {
  systemPrompt: string
  excludeGlobs: string[]
  model: string
  prOverviewPrompt: string | null
  prCodeReviewPrompt: string | null
  batchOverviewPrompt: string | null
  batchCodeReviewPrompt: string | null
  overviewJsonPrompt: string | null
  codeReviewJsonPrompt: string | null
  batchOverviewJsonPrompt: string | null
  batchCodeReviewJsonPrompt: string | null
  jsonSchemaPlaceholder: string
  defaults: PromptDefaults
}

type RepoDetail = {
  id: string
  owner: string
  name: string
  rules: RepoRules | null
}

function PromptField({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  placeholder: string
  onChange: (v: string) => void
}) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {hint && <p className="muted small">{hint}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={hint?.includes('JSON') ? 6 : 4}
      />
    </div>
  )
}

export default function RulesPage() {
  const { id } = useParams<{ id: string }>()
  const [repo, setRepo] = useState<RepoDetail | null>(null)
  const [defaults, setDefaults] = useState<PromptDefaults | null>(null)
  const [jsonPlaceholder, setJsonPlaceholder] = useState('{{JSON_SCHEMA}}')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [prOverview, setPrOverview] = useState('')
  const [prCodeReview, setPrCodeReview] = useState('')
  const [batchOverview, setBatchOverview] = useState('')
  const [batchCodeReview, setBatchCodeReview] = useState('')
  const [overviewJson, setOverviewJson] = useState('')
  const [codeReviewJson, setCodeReviewJson] = useState('')
  const [batchOverviewJson, setBatchOverviewJson] = useState('')
  const [batchCodeReviewJson, setBatchCodeReviewJson] = useState('')
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
          const d = r.rules.defaults
          setDefaults(d)
          setJsonPlaceholder(r.rules.jsonSchemaPlaceholder)
          setSystemPrompt(r.rules.systemPrompt)
          setPrOverview(r.rules.prOverviewPrompt ?? '')
          setPrCodeReview(r.rules.prCodeReviewPrompt ?? '')
          setBatchOverview(r.rules.batchOverviewPrompt ?? '')
          setBatchCodeReview(r.rules.batchCodeReviewPrompt ?? '')
          setOverviewJson(r.rules.overviewJsonPrompt ?? '')
          setCodeReviewJson(r.rules.codeReviewJsonPrompt ?? '')
          setBatchOverviewJson(r.rules.batchOverviewJsonPrompt ?? '')
          setBatchCodeReviewJson(r.rules.batchCodeReviewJsonPrompt ?? '')
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
        body: JSON.stringify({
          systemPrompt,
          excludeGlobs,
          model,
          prOverviewPrompt: prOverview,
          prCodeReviewPrompt: prCodeReview,
          batchOverviewPrompt: batchOverview,
          batchCodeReviewPrompt: batchCodeReview,
          overviewJsonPrompt: overviewJson,
          codeReviewJsonPrompt: codeReviewJson,
          batchOverviewJsonPrompt: batchOverviewJson,
          batchCodeReviewJsonPrompt: batchCodeReviewJson,
        }),
      })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!id) return <p>Missing id</p>

  const ph = defaults

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
        <p className="muted small">Appended to every review phase as &quot;Repository rules&quot;.</p>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} required rows={3} />

        <h2>PR review prompts</h2>
        <PromptField
          label="Overview (system)"
          value={prOverview}
          onChange={setPrOverview}
          placeholder={ph?.prOverviewPrompt ?? ''}
        />
        <PromptField
          label="Code review (system)"
          value={prCodeReview}
          onChange={setPrCodeReview}
          placeholder={ph?.prCodeReviewPrompt ?? ''}
        />

        <h2>Commit batch review prompts</h2>
        <p className="muted small">Used for commit poll / batch reviews (not pull requests).</p>
        <PromptField
          label="Overview (system)"
          value={batchOverview}
          onChange={setBatchOverview}
          placeholder={ph?.batchOverviewPrompt ?? ''}
        />
        <PromptField
          label="Code review (system)"
          value={batchCodeReview}
          onChange={setBatchCodeReview}
          placeholder={ph?.batchCodeReviewPrompt ?? ''}
        />

        <h2>JSON response templates</h2>
        <p className="muted small">
          Include <code>{jsonPlaceholder}</code> where the response shape should go — the app substitutes the
          schema required for parsing (PR vs batch overview schemas differ).
        </p>
        <PromptField
          label="Overview JSON (PR and default for batch)"
          hint={`PR schema example: ${ph?.overviewJsonSchemaPr.slice(0, 80)}…`}
          value={overviewJson}
          onChange={setOverviewJson}
          placeholder={ph?.overviewJsonPrompt ?? ''}
        />
        <PromptField
          label="Overview JSON (batch only, optional)"
          value={batchOverviewJson}
          onChange={setBatchOverviewJson}
          placeholder={ph?.overviewJsonPrompt ?? 'Leave empty to use overview JSON above'}
        />
        <PromptField
          label="Code review JSON (PR and default for batch)"
          value={codeReviewJson}
          onChange={setCodeReviewJson}
          placeholder={ph?.codeReviewJsonPrompt ?? ''}
        />
        <PromptField
          label="Code review JSON (batch only, optional)"
          value={batchCodeReviewJson}
          onChange={setBatchCodeReviewJson}
          placeholder={ph?.codeReviewJsonPrompt ?? 'Leave empty to use code review JSON above'}
        />

        <h2>Diff filters</h2>
        <label>Exclude file globs (one per line, e.g. <code>*.lock</code>)</label>
        <textarea value={globs} onChange={(e) => setGlobs(e.target.value)} placeholder={'*.md\npackage-lock.json'} />

        <button type="submit">Save rules</button>
      </form>
    </>
  )
}

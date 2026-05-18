import OpenAI from 'openai'

export type AiFinding = {
  severity: string
  path: string
  comment: string
}

export type AiOverview = {
  whatChanged: string
  affectedAreas: string[]
  focusForReviewer: string
  priorityReview: string[]
  checklist: string[]
}

export type AiReviewResult = {
  overview: AiOverview
  findings: AiFinding[]
}

const overviewJsonInstruction = `Respond with a single JSON object only (no markdown), shape:
{"whatChanged":"concise summary of what this PR does","affectedAreas":["project areas or modules touched"],"focusForReviewer":"what deserves the most scrutiny and why","priorityReview":["files or code areas to read first — use paths from the diff when possible"],"checklist":["actionable reviewer checklist items"]}
Base everything on the diff. Do not invent files. Max 8 items per array.`

const codeReviewJsonInstruction = `Respond with a single JSON object only (no markdown), shape:
{"findings":[{"severity":"info|warning|error","path":"relative .cs file path from the diff","comment":"short actionable note"}]}
Only comment on .cs files present in the diff. Do not use line numbers. Group multiple notes per file as separate findings with the same path. Max 20 findings.
Focus on potential bugs and errors, readability, extensibility, and performance.`

const overviewSystemPrompt = `You prepare human reviewers to triage a pull request before deep code review.
Describe what changed, which parts of the project are affected, what to focus on, which files or areas to read first, and a practical reviewer checklist. Be concise and actionable.`

const codeReviewSystemPrompt = `You are an expert code reviewer. Focus on bugs, security, performance, readability, extensibility, and maintainability. Be concise and actionable.`

function useJsonObjectResponseFormat(): boolean {
  const v = process.env.OPENAI_JSON_OBJECT_MODE?.trim().toLowerCase()
  if (v) return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
  if (process.env.OPENAI_BASE_URL?.trim()) return false
  return true
}

/** Strip markdown fences and parse JSON (local models often ignore "no markdown"). */
export function parseLlmJsonPayload(raw: string): unknown {
  let s = raw.trim()
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(s)
  if (fenced) {
    s = fenced[1].trim()
  } else if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```[\s\S]*$/, '').trim()
  }
  try {
    return JSON.parse(s)
  } catch {
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(s.slice(start, end + 1))
    }
    throw new Error('Invalid LLM JSON')
  }
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max)
}

async function runLlmJsonPhase(
  apiKey: string,
  model: string,
  systemPrompt: string,
  jsonInstruction: string,
  userContent: string,
): Promise<Record<string, unknown>> {
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined
  const client = new OpenAI({ apiKey, baseURL })
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${jsonInstruction}` },
      { role: 'user', content: userContent },
    ],
    ...(useJsonObjectResponseFormat() ? { response_format: { type: 'json_object' as const } } : {}),
    temperature: 0.3,
  })
  const raw = completion.choices[0]?.message?.content
  if (!raw) throw new Error('Empty LLM response')
  const parsed = parseLlmJsonPayload(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid LLM JSON')
  return parsed as Record<string, unknown>
}

function parseOverview(obj: Record<string, unknown>): AiOverview {
  return {
    whatChanged: typeof obj.whatChanged === 'string' ? obj.whatChanged.trim() : '',
    affectedAreas: stringArray(obj.affectedAreas, 8),
    focusForReviewer: typeof obj.focusForReviewer === 'string' ? obj.focusForReviewer.trim() : '',
    priorityReview: stringArray(obj.priorityReview, 8),
    checklist: stringArray(obj.checklist, 12),
  }
}

function parseFindings(obj: Record<string, unknown>): AiFinding[] {
  const findingsRaw = Array.isArray(obj.findings) ? obj.findings : []
  return findingsRaw
    .map((f) => {
      if (!f || typeof f !== 'object') return null
      const fr = f as Record<string, unknown>
      return {
        severity: typeof fr.severity === 'string' ? fr.severity : 'info',
        path: typeof fr.path === 'string' ? fr.path : '',
        comment: typeof fr.comment === 'string' ? fr.comment : '',
      }
    })
    .filter((x): x is AiFinding => x !== null && x.path.length > 0 && x.comment.length > 0)
}

export async function runLlmOverview(
  apiKey: string,
  model: string,
  repoSystemPrompt: string,
  userContent: string,
): Promise<AiOverview> {
  const system = repoSystemPrompt.trim()
    ? `${overviewSystemPrompt}\n\nRepository rules:\n${repoSystemPrompt.trim()}`
    : overviewSystemPrompt
  const obj = await runLlmJsonPhase(apiKey, model, system, overviewJsonInstruction, userContent)
  return parseOverview(obj)
}

export async function runLlmCodeReview(
  apiKey: string,
  model: string,
  repoSystemPrompt: string,
  userContent: string,
): Promise<AiFinding[]> {
  const system = repoSystemPrompt.trim()
    ? `${codeReviewSystemPrompt}\n\nRepository rules:\n${repoSystemPrompt.trim()}`
    : codeReviewSystemPrompt
  const obj = await runLlmJsonPhase(apiKey, model, system, codeReviewJsonInstruction, userContent)
  return parseFindings(obj)
}

export async function runFullPrReview(
  apiKey: string,
  model: string,
  repoSystemPrompt: string,
  userContent: string,
): Promise<AiReviewResult> {
  const overview = await runLlmOverview(apiKey, model, repoSystemPrompt, userContent)
  const findings = await runLlmCodeReview(apiKey, model, repoSystemPrompt, userContent)
  return { overview, findings }
}

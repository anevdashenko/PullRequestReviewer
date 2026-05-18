import OpenAI from 'openai'

export type AiFinding = {
  severity: string
  path: string
  line: number | null
  comment: string
}

export type AiReviewResult = {
  summary: string
  findings: AiFinding[]
}

const jsonInstruction = `Respond with a single JSON object only (no markdown), shape:
{"summary":"string overview of the PR","findings":[{"severity":"info|warning|error","path":"relative file path","line":number or null,"comment":"short actionable note"}]}
For "line": use the line number in the NEW file (right side of the diff), as in GitHub unified diff hunk headers (e.g. @@ -1,3 +42,5 @@ → new-file lines start near 42). Only cite lines that appear in the diff hunks (+ or context lines). Use null when unsure or when the note applies to the whole file. Max 20 findings.`

function useJsonObjectResponseFormat(): boolean {
  const v = process.env.OPENAI_JSON_OBJECT_MODE?.trim().toLowerCase()
  if (v) return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
  // Local OpenAI-compatible servers (LM Studio, vLLM, etc.) usually reject json_object.
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

export async function runLlmReview(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<AiReviewResult> {
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
  const obj = parsed as Record<string, unknown>
  const summary = typeof obj.summary === 'string' ? obj.summary : ''
  const findingsRaw = Array.isArray(obj.findings) ? obj.findings : []
  const findings: AiFinding[] = findingsRaw
    .map((f) => {
      if (!f || typeof f !== 'object') return null
      const fr = f as Record<string, unknown>
      return {
        severity: typeof fr.severity === 'string' ? fr.severity : 'info',
        path: typeof fr.path === 'string' ? fr.path : '',
        line: typeof fr.line === 'number' ? fr.line : null,
        comment: typeof fr.comment === 'string' ? fr.comment : '',
      }
    })
    .filter((x): x is AiFinding => x !== null && x.path.length > 0 && x.comment.length > 0)
  return { summary, findings }
}

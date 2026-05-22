/** Placeholder replaced at runtime with the JSON shape required for parsing. */
export const JSON_SCHEMA_PLACEHOLDER = '{{JSON_SCHEMA}}'

export const OVERVIEW_JSON_SCHEMA_PR = `{"whatChanged":"concise summary of what this PR does","affectedAreas":["project areas or modules touched"],"focusForReviewer":"what deserves the most scrutiny and why","priorityReview":["files or code areas to read first — use paths from the diff when possible"],"checklist":["actionable reviewer checklist items"]}`

export const OVERVIEW_JSON_SCHEMA_BATCH = `{"whatChanged":"concise summary of what this commit batch does","affectedAreas":["project areas or modules touched"],"focusForReviewer":"what deserves the most scrutiny and why","priorityReview":["files or code areas to read first — use paths from the diff when possible"],"checklist":["actionable reviewer checklist items"]}`

export const CODE_REVIEW_JSON_SCHEMA = `{"findings":[{"severity":"info|warning|error","path":"relative .cs file path from the diff","comment":"short actionable note"}]}`

export const DEFAULT_SYSTEM_PROMPT = `You are an expert code reviewer. Focus on bugs, security, performance, readability, and maintainability. Be concise and actionable.`

export const DEFAULT_PR_OVERVIEW_PROMPT = `You prepare human reviewers to triage a pull request before deep code review.
Describe what changed, which parts of the project are affected, what to focus on, which files or areas to read first, and a practical reviewer checklist. Be concise and actionable.`

export const DEFAULT_BATCH_OVERVIEW_PROMPT = `You prepare human reviewers to triage a set of commits (not a pull request) before deep code review.
Describe what changed across the batch, which parts of the project are affected, what to focus on, which files or areas to read first, and a practical reviewer checklist. Be concise and actionable.`

export const DEFAULT_PR_CODE_REVIEW_PROMPT = `You are an expert code reviewer. Focus on bugs, security, performance, readability, extensibility, and maintainability. Be concise and actionable.`

export const DEFAULT_BATCH_CODE_REVIEW_PROMPT = `You are an expert code reviewer reviewing a batch of commits (not a pull request). Focus on bugs, security, performance, readability, extensibility, and maintainability. Be concise and actionable.`

export const DEFAULT_OVERVIEW_JSON_PROMPT = `Respond with a single JSON object only (no markdown), shape:
${JSON_SCHEMA_PLACEHOLDER}
Base everything on the diff. Do not invent files. Max 8 items per array.`

export const DEFAULT_CODE_REVIEW_JSON_PROMPT = `Respond with a single JSON object only (no markdown), shape:
${JSON_SCHEMA_PLACEHOLDER}
Only comment on .cs files present in the diff. Do not use line numbers. Group multiple notes per file as separate findings with the same path. Max 20 findings.
Focus on potential bugs and errors, readability, extensibility, and performance.`

export const DEFAULT_WORKSPACE_INTRO = `You are in the repository working tree. Use git diff, read files, and inspect the codebase as needed.`

export const DEFAULT_BATCH_OPENAI_USER_INTRO = `Review this set of commits (not a pull request). Summarize what was done across all commits, then analyze the combined code changes for bugs and issues.`

import type { FastifyRequest } from 'fastify'
import type { AiReviewResult, LlmRequestSizes } from '../lib/llm.js'
import type { CommitMessageMeta } from '../lib/commit-diff.js'

export type ProviderId = 'github' | 'gitlab'

export type MrDiffResult = {
  diffText: string
  headSha: string
  changedPaths: string[]
  fullFilesAttached: number
}

export type OpenMr = {
  number: number
  headSha: string | null
}

export type ParsedMrWebhook = {
  owner: string
  name: string
  mrNumber: number
  headSha: string | null
  accepted: boolean
  ignoreReason?: string
}

export type PolledCommit = {
  sha: string
  authorLogin: string
  authorEmail: string | null
}

export type CommitBatchDiffResult = {
  diffText: string
  changedPaths: string[]
  commitMessages: CommitMessageMeta[]
  fullFilesAttached: number
}

export interface VcsProvider {
  id: ProviderId
  verifyWebhook(req: FastifyRequest, secret: string, rawBody?: Buffer): boolean
  parseMrWebhook(body: unknown, headers: Record<string, string | string[] | undefined>): ParsedMrWebhook | null
  listOpenMrs(accessToken: string, owner: string, name: string): Promise<OpenMr[]>
  buildMrDiff(
    accessToken: string,
    owner: string,
    name: string,
    mrNumber: number,
    excludeGlobs: string[],
  ): Promise<MrDiffResult>
  submitMrReview(
    accessToken: string,
    owner: string,
    name: string,
    mrNumber: number,
    headSha: string,
    ai: AiReviewResult,
    requestSizes: LlmRequestSizes,
  ): Promise<void>
  getDefaultBranch(accessToken: string, owner: string, name: string): Promise<string | null>
  listBranches(accessToken: string, owner: string, name: string): Promise<string[]>
  listRecentCommits(
    accessToken: string,
    owner: string,
    name: string,
    branchName: string,
    sinceIso: string,
  ): Promise<PolledCommit[]>
  buildCommitBatchDiff(
    accessToken: string,
    owner: string,
    name: string,
    shas: string[],
    excludeGlobs: string[],
  ): Promise<CommitBatchDiffResult>
  mrUrl(owner: string, name: string, mrNumber: number): string
  commitUrl(owner: string, name: string, sha: string): string
}

import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { clearCommitReviewsForRepo } from '../lib/clear-commit-reviews.js'
import { DEFAULT_MODEL } from '../lib/defaults.js'
import { isProviderId, normalizeProviderId } from '../providers/index.js'

const DEFAULT_PROMPT = `You are an expert code reviewer. Focus on bugs, security, performance, readability, and maintainability. Be concise and actionable.`

function parseExcludeGlobs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string')
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/repos', async (req) => {
    req.log.info({ event: 'repos_list' }, 'GET /repos')
    const rows = await prisma.repository.findMany({
      orderBy: { createdAt: 'desc' },
      include: { rules: true },
    })
    req.log.info({ event: 'repos_list', count: rows.length }, 'GET /repos done')
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      owner: r.owner,
      name: r.name,
      createdAt: r.createdAt,
      prReviewEnabled: r.prReviewEnabled,
      commitReviewEnabled: r.commitReviewEnabled,
      hasRules: !!r.rules,
      model: r.rules?.model ?? null,
    }))
  })

  app.post<{
    Body: {
      provider?: string
      owner: string
      name: string
      accessToken: string
      webhookSecret: string
      model?: string
      prReviewEnabled?: boolean
      commitReviewEnabled?: boolean
    }
  }>('/repos', async (req, reply) => {
    const {
      provider: providerRaw,
      owner,
      name,
      accessToken,
      webhookSecret,
      model,
      prReviewEnabled,
      commitReviewEnabled,
    } = req.body
    const provider = normalizeProviderId(providerRaw?.trim())
    if (providerRaw?.trim() && !isProviderId(providerRaw.trim())) {
      req.log.warn({ event: 'repo_create', outcome: 'validation_error', provider: providerRaw }, 'POST /repos: invalid provider')
      return reply.code(400).send({ error: 'provider must be github or gitlab' })
    }
    req.log.info(
      {
        event: 'repo_create',
        provider,
        owner: owner?.trim(),
        name: name?.trim(),
        hasAccessToken: Boolean(accessToken?.trim()),
        hasWebhookSecret: Boolean(webhookSecret?.trim()),
        prReviewEnabled,
        commitReviewEnabled,
      },
      'POST /repos: attempt',
    )
    if (
      prReviewEnabled !== undefined &&
      typeof prReviewEnabled !== 'boolean'
    ) {
      return reply.code(400).send({ error: 'prReviewEnabled must be a boolean' })
    }
    if (
      commitReviewEnabled !== undefined &&
      typeof commitReviewEnabled !== 'boolean'
    ) {
      return reply.code(400).send({ error: 'commitReviewEnabled must be a boolean' })
    }
    if (!owner?.trim() || !name?.trim() || !accessToken?.trim() || !webhookSecret?.trim()) {
      req.log.warn({ event: 'repo_create', outcome: 'validation_error' }, 'POST /repos: missing fields')
      return reply.code(400).send({ error: 'owner, name, accessToken, webhookSecret are required' })
    }
    try {
      const repo = await prisma.$transaction(async (tx) => {
        const created = await tx.repository.create({
          data: {
            provider,
            owner: owner.trim(),
            name: name.trim(),
            accessToken: accessToken.trim(),
            webhookSecret: webhookSecret.trim(),
            prReviewEnabled: prReviewEnabled ?? true,
            commitReviewEnabled: commitReviewEnabled ?? false,
          },
        })
        const modelName =
          typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL
        await tx.reviewRule.create({
          data: {
            repoId: created.id,
            systemPrompt: DEFAULT_PROMPT,
            excludeGlobs: [],
            model: modelName,
          },
        })
        return created
      })
      req.log.info({ event: 'repo_create', outcome: 'created', repoId: repo.id, owner: repo.owner, name: repo.name }, 'POST /repos ok')
      reply.code(201)
      return { id: repo.id }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        req.log.warn(
          { event: 'repo_create', outcome: 'duplicate', owner: owner.trim(), name: name.trim(), prismaCode: err.code },
          'POST /repos: unique constraint',
        )
        return reply.code(409).send({ error: 'Repository already exists for this provider/owner/name' })
      }
      req.log.error({ err, event: 'repo_create', outcome: 'error' }, 'POST /repos failed')
      throw err
    }
  })

  app.get<{ Params: { id: string } }>('/repos/:id', async (req, reply) => {
    req.log.info({ event: 'repo_get', repoId: req.params.id }, 'GET /repos/:id')
    const r = await prisma.repository.findUnique({
      where: { id: req.params.id },
      include: { rules: true },
    })
    if (!r) {
      req.log.warn({ event: 'repo_get', repoId: req.params.id, outcome: 'not_found' }, 'GET /repos/:id')
      return reply.code(404).send({ error: 'Not found' })
    }
    return {
      id: r.id,
      provider: r.provider,
      owner: r.owner,
      name: r.name,
      createdAt: r.createdAt,
      prReviewEnabled: r.prReviewEnabled,
      commitReviewEnabled: r.commitReviewEnabled,
      rules: r.rules
        ? {
            systemPrompt: r.rules.systemPrompt,
            excludeGlobs: parseExcludeGlobs(r.rules.excludeGlobs),
            model: r.rules.model,
          }
        : null,
    }
  })

  app.patch<{
    Params: { id: string }
    Body: { commitReviewEnabled?: boolean; prReviewEnabled?: boolean }
  }>('/repos/:id', async (req, reply) => {
    const { commitReviewEnabled, prReviewEnabled } = req.body ?? {}
    req.log.info(
      { event: 'repo_patch', repoId: req.params.id, commitReviewEnabled, prReviewEnabled },
      'PATCH /repos/:id',
    )
    const data: { commitReviewEnabled?: boolean; prReviewEnabled?: boolean } = {}
    if (typeof commitReviewEnabled === 'boolean') data.commitReviewEnabled = commitReviewEnabled
    if (typeof prReviewEnabled === 'boolean') data.prReviewEnabled = prReviewEnabled
    if (Object.keys(data).length === 0) {
      return reply.code(400).send({
        error: 'At least one of commitReviewEnabled or prReviewEnabled (boolean) is required',
      })
    }
    try {
      const repo = await prisma.repository.update({
        where: { id: req.params.id },
        data,
      })
      req.log.info({ event: 'repo_patch', repoId: repo.id, outcome: 'updated' }, 'PATCH /repos/:id ok')
      return {
        id: repo.id,
        prReviewEnabled: repo.prReviewEnabled,
        commitReviewEnabled: repo.commitReviewEnabled,
      }
    } catch {
      req.log.warn({ event: 'repo_patch', repoId: req.params.id, outcome: 'not_found' }, 'PATCH /repos/:id')
      return reply.code(404).send({ error: 'Not found' })
    }
  })

  app.delete<{ Params: { id: string } }>('/repos/:id', async (req, reply) => {
    req.log.info({ event: 'repo_delete', repoId: req.params.id }, 'DELETE /repos/:id')
    try {
      await prisma.repository.delete({ where: { id: req.params.id } })
      req.log.info({ event: 'repo_delete', repoId: req.params.id, outcome: 'deleted' }, 'DELETE /repos/:id ok')
      return reply.code(204).send()
    } catch {
      req.log.warn({ event: 'repo_delete', repoId: req.params.id, outcome: 'not_found' }, 'DELETE /repos/:id')
      return reply.code(404).send({ error: 'Not found' })
    }
  })

  app.put<{
    Params: { id: string }
    Body: { systemPrompt?: string; excludeGlobs?: string[]; model?: string }
  }>('/repos/:id/rules', async (req, reply) => {
    const { systemPrompt, excludeGlobs, model } = req.body
    req.log.info({ event: 'rules_put', repoId: req.params.id, keys: Object.keys(req.body ?? {}) }, 'PUT /repos/:id/rules')
    const repo = await prisma.repository.findUnique({ where: { id: req.params.id } })
    if (!repo) {
      req.log.warn({ event: 'rules_put', repoId: req.params.id, outcome: 'not_found' }, 'PUT /repos/:id/rules')
      return reply.code(404).send({ error: 'Not found' })
    }
    const data: {
      systemPrompt?: string
      excludeGlobs?: Prisma.InputJsonValue
      model?: string
    } = {}
    if (typeof systemPrompt === 'string') data.systemPrompt = systemPrompt
    if (Array.isArray(excludeGlobs)) data.excludeGlobs = excludeGlobs as Prisma.InputJsonValue
    if (typeof model === 'string' && model.trim()) data.model = model.trim()
    if (Object.keys(data).length === 0) {
      req.log.warn({ event: 'rules_put', repoId: req.params.id, outcome: 'empty_body' }, 'PUT /repos/:id/rules')
      return reply.code(400).send({ error: 'Nothing to update' })
    }
    await prisma.reviewRule.upsert({
      where: { repoId: repo.id },
      create: {
        repoId: repo.id,
        systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : DEFAULT_PROMPT,
        excludeGlobs: Array.isArray(excludeGlobs) ? excludeGlobs : [],
        model: typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL,
      },
      update: data,
    })
    req.log.info({ event: 'rules_put', repoId: req.params.id, outcome: 'saved' }, 'PUT /repos/:id/rules ok')
    return { ok: true }
  })

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/repos/:id/logs',
    async (req, reply) => {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50))
      req.log.info({ event: 'repo_logs', repoId: req.params.id, limit }, 'GET /repos/:id/logs')
      const repo = await prisma.repository.findUnique({ where: { id: req.params.id } })
      if (!repo) {
        req.log.warn({ event: 'repo_logs', repoId: req.params.id, outcome: 'not_found' }, 'GET /repos/:id/logs')
        return reply.code(404).send({ error: 'Not found' })
      }
      const logs = await prisma.reviewLog.findMany({
        where: { repoId: repo.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          repository: { select: { owner: true, name: true, provider: true } },
        },
      })
      req.log.info({ event: 'repo_logs', repoId: req.params.id, count: logs.length }, 'GET /repos/:id/logs done')
      return logs
    },
  )

  app.get('/commit-reviews/repos', async (req) => {
    req.log.info({ event: 'commit_review_repos_list' }, 'GET /commit-reviews/repos')
    const batches = await prisma.commitBatchReview.findMany({
      select: { repoId: true },
      distinct: ['repoId'],
    })
    const repoIds = batches.map((b) => b.repoId)
    if (repoIds.length === 0) {
      return []
    }
    const repos = await prisma.repository.findMany({
      where: { id: { in: repoIds } },
      select: { id: true, owner: true, name: true, provider: true },
    })
    const counts = await prisma.commitBatchReview.groupBy({
      by: ['repoId'],
      where: { repoId: { in: repoIds } },
      _count: { id: true },
    })
    const countMap = new Map(counts.map((c) => [c.repoId, c._count.id]))
    const newCounts = await prisma.commitBatchReview.groupBy({
      by: ['repoId'],
      where: {
        repoId: { in: repoIds },
        status: 'done',
        seenByUser: false,
      },
      _count: { id: true },
    })
    const newCountMap = new Map(newCounts.map((c) => [c.repoId, c._count.id]))
    return repos
      .map((r) => ({
        id: r.id,
        provider: r.provider,
        owner: r.owner,
        name: r.name,
        reviewCount: countMap.get(r.id) ?? 0,
        newReviewCount: newCountMap.get(r.id) ?? 0,
      }))
      .sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`))
  })

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/repos/:id/commit-reviews',
    async (req, reply) => {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50))
      req.log.info({ event: 'repo_commit_reviews', repoId: req.params.id, limit }, 'GET /repos/:id/commit-reviews')
      const repo = await prisma.repository.findUnique({ where: { id: req.params.id } })
      if (!repo) {
        return reply.code(404).send({ error: 'Not found' })
      }
      const reviews = await prisma.commitBatchReview.findMany({
        where: { repoId: repo.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          branchName: true,
          authorLogin: true,
          authorEmail: true,
          periodStart: true,
          periodEnd: true,
          commitShas: true,
          status: true,
          seenByUser: true,
          createdAt: true,
          finishedAt: true,
        },
      })
      return reviews.map((r) => ({
        ...r,
        commitCount: Array.isArray(r.commitShas) ? r.commitShas.length : 0,
        commitShas: undefined,
      }))
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/repos/:id/commit-reviews',
    async (req, reply) => {
      const repoId = req.params.id
      req.log.info({ event: 'commit_reviews_clear', repoId }, 'DELETE /repos/:id/commit-reviews')
      const repo = await prisma.repository.findUnique({ where: { id: repoId } })
      if (!repo) {
        req.log.warn({ event: 'commit_reviews_clear', repoId, outcome: 'not_found' }, 'DELETE /repos/:id/commit-reviews')
        return reply.code(404).send({ error: 'Not found' })
      }
      const result = await clearCommitReviewsForRepo(repoId)
      req.log.info(
        {
          event: 'commit_reviews_clear',
          repoId,
          outcome: 'cleared',
          ...result,
        },
        'DELETE /repos/:id/commit-reviews ok',
      )
      return result
    },
  )

  app.get<{ Params: { id: string } }>('/commit-reviews/:id', async (req, reply) => {
    req.log.info({ event: 'commit_review_get', reviewId: req.params.id }, 'GET /commit-reviews/:id')
    const review = await prisma.commitBatchReview.findUnique({
      where: { id: req.params.id },
      include: {
        repository: { select: { id: true, owner: true, name: true, provider: true } },
      },
    })
    if (!review) {
      return reply.code(404).send({ error: 'Not found' })
    }
    const commitShas = Array.isArray(review.commitShas)
      ? review.commitShas.filter((x): x is string => typeof x === 'string')
      : []
    return {
      id: review.id,
      repoId: review.repoId,
      repository: review.repository,
      branchName: review.branchName,
      authorLogin: review.authorLogin,
      authorEmail: review.authorEmail,
      periodStart: review.periodStart,
      periodEnd: review.periodEnd,
      commitShas,
      commitCount: commitShas.length,
      status: review.status,
      seenByUser: review.seenByUser,
      mdContent: review.mdContent,
      errorMessage: review.errorMessage,
      createdAt: review.createdAt,
      finishedAt: review.finishedAt,
    }
  })

  app.patch<{ Params: { id: string }; Body: { seenByUser?: boolean } }>(
    '/commit-reviews/:id',
    async (req, reply) => {
      if (req.body?.seenByUser !== true) {
        return reply.code(400).send({ error: 'seenByUser: true is required' })
      }
      req.log.info({ event: 'commit_review_mark_seen', reviewId: req.params.id }, 'PATCH /commit-reviews/:id')
      try {
        const review = await prisma.commitBatchReview.update({
          where: { id: req.params.id },
          data: { seenByUser: true },
          select: { id: true, seenByUser: true },
        })
        return review
      } catch {
        return reply.code(404).send({ error: 'Not found' })
      }
    },
  )

  app.get<{ Querystring: { repoId?: string; limit?: string } }>('/logs', async (req) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '100', 10) || 100))
    const where = req.query.repoId ? { repoId: req.query.repoId } : {}
    req.log.info({ event: 'logs_all', limit, repoId: req.query.repoId ?? null }, 'GET /logs')
    const rows = await prisma.reviewLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        repository: { select: { owner: true, name: true, provider: true } },
      },
    })
    req.log.info({ event: 'logs_all', count: rows.length }, 'GET /logs done')
    return rows
  })
}

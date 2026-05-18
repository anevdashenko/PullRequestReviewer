import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { DEFAULT_MODEL } from '../lib/defaults.js'

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
      hasRules: !!r.rules,
      model: r.rules?.model ?? null,
    }))
  })

  app.post<{
    Body: { owner: string; name: string; accessToken: string; webhookSecret: string; model?: string }
  }>('/repos', async (req, reply) => {
    const { owner, name, accessToken, webhookSecret, model } = req.body
    req.log.info(
      {
        event: 'repo_create',
        owner: owner?.trim(),
        name: name?.trim(),
        hasAccessToken: Boolean(accessToken?.trim()),
        hasWebhookSecret: Boolean(webhookSecret?.trim()),
      },
      'POST /repos: attempt',
    )
    if (!owner?.trim() || !name?.trim() || !accessToken?.trim() || !webhookSecret?.trim()) {
      req.log.warn({ event: 'repo_create', outcome: 'validation_error' }, 'POST /repos: missing fields')
      return reply.code(400).send({ error: 'owner, name, accessToken, webhookSecret are required' })
    }
    try {
      const repo = await prisma.$transaction(async (tx) => {
        const created = await tx.repository.create({
          data: {
            owner: owner.trim(),
            name: name.trim(),
            accessToken: accessToken.trim(),
            webhookSecret: webhookSecret.trim(),
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
      rules: r.rules
        ? {
            systemPrompt: r.rules.systemPrompt,
            excludeGlobs: parseExcludeGlobs(r.rules.excludeGlobs),
            model: r.rules.model,
          }
        : null,
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
          repository: { select: { owner: true, name: true } },
        },
      })
      req.log.info({ event: 'repo_logs', repoId: req.params.id, count: logs.length }, 'GET /repos/:id/logs done')
      return logs
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
        repository: { select: { owner: true, name: true } },
      },
    })
    req.log.info({ event: 'logs_all', count: rows.length }, 'GET /logs done')
    return rows
  })
}

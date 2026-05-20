import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../db.js'
import { schedulePrReview } from '../lib/schedule-pr-review.js'
import { getProvider, type ProviderId } from '../providers/index.js'

type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer }

function headerRecord(req: FastifyRequest): Record<string, string | string[] | undefined> {
  return req.headers as Record<string, string | string[] | undefined>
}

async function handleMrWebhook(
  providerId: ProviderId,
  req: FastifyRequest,
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
): Promise<unknown> {
  const provider = getProvider(providerId)
  const raw = (req as RequestWithRawBody).rawBody

  if (providerId === 'github') {
    if (!raw || !Buffer.isBuffer(raw)) {
      return reply.code(400).send({ error: 'Missing raw body' })
    }
  }

  const parsed = provider.parseMrWebhook(req.body, headerRecord(req))
  if (!parsed) {
    return reply.code(400).send({ error: 'Unknown repository or invalid payload' })
  }

  if (!parsed.accepted) {
    return reply.code(202).send({ ignored: true, reason: parsed.ignoreReason ?? 'ignored' })
  }

  const repo = await prisma.repository.findUnique({
    where: { provider_owner_name: { provider: providerId, owner: parsed.owner, name: parsed.name } },
  })
  if (!repo) {
    return reply.code(404).send({ error: 'Repository not registered' })
  }

  if (!provider.verifyWebhook(req, repo.webhookSecret, raw)) {
    return reply.code(401).send({ error: 'Invalid signature' })
  }

  if (!repo.prReviewEnabled) {
    return reply.code(202).send({ ignored: true, reason: 'pr review disabled for repository' })
  }

  const scheduled = await schedulePrReview(repo.id, parsed.mrNumber, parsed.headSha)
  if (!scheduled.accepted) {
    return reply.code(202).send({ accepted: false, ignored: true, reason: scheduled.reason })
  }

  return reply.code(202).send({ accepted: true, reviewLogId: scheduled.reviewLogId })
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/github', async (req, reply) => handleMrWebhook('github', req, reply))
  app.post('/webhooks/gitlab', async (req, reply) => handleMrWebhook('gitlab', req, reply))
}

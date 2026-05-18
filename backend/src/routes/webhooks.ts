import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../db.js'
import { scheduleGithubPrReview } from '../lib/schedule-pr-review.js'
import { verifyGithubSignature } from '../lib/webhook-signature.js'

type PrPayload = {
  action?: string
  pull_request?: { number: number; head?: { sha?: string } }
  repository?: { full_name?: string; name?: string; owner?: { login?: string } }
}

type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer }

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/github', async (req, reply) => {
    const raw = (req as RequestWithRawBody).rawBody
    if (!raw || !Buffer.isBuffer(raw)) {
      return reply.code(400).send({ error: 'Missing raw body' })
    }

    const sig = req.headers['x-hub-signature-256']
    const sigStr = Array.isArray(sig) ? sig[0] : sig

    const body = req.body as PrPayload
    const full = body.repository?.full_name
    const ownerLogin = body.repository?.owner?.login
    const repoName = body.repository?.name
    const owner = ownerLogin ?? (full?.includes('/') ? full.split('/')[0] : undefined)
    const name = repoName ?? (full?.includes('/') ? full.split('/')[1] : undefined)
    if (!owner || !name) {
      return reply.code(400).send({ error: 'Unknown repository' })
    }

    const repo = await prisma.repository.findUnique({
      where: { provider_owner_name: { provider: 'github', owner, name } },
    })
    if (!repo) {
      return reply.code(404).send({ error: 'Repository not registered' })
    }

    if (!verifyGithubSignature(raw, repo.webhookSecret, sigStr)) {
      return reply.code(401).send({ error: 'Invalid signature' })
    }

    const event = req.headers['x-github-event']
    const eventName = Array.isArray(event) ? event[0] : event
    if (eventName !== 'pull_request') {
      return reply.code(202).send({ ignored: true, reason: 'not pull_request' })
    }

    const action = body.action
    if (action !== 'opened' && action !== 'synchronize' && action !== 'reopened') {
      return reply.code(202).send({ ignored: true, reason: `action ${action}` })
    }

    const prNumber = body.pull_request?.number
    if (typeof prNumber !== 'number') {
      return reply.code(400).send({ error: 'Missing PR number' })
    }

    const headSha = body.pull_request?.head?.sha ?? null

    const scheduled = await scheduleGithubPrReview(repo.id, prNumber, headSha)
    if (!scheduled.accepted) {
      return reply.code(202).send({ accepted: false, ignored: true, reason: scheduled.reason })
    }

    return reply.code(202).send({ accepted: true, reviewLogId: scheduled.reviewLogId })
  })
}

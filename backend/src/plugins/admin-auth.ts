import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { registerApiRoutes } from '../routes/api.js'

/** Async so Fastify continues the lifecycle after the hook (sync hooks must call `done`). */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = process.env.ADMIN_API_KEY
  if (!key) {
    req.log.warn({ event: 'admin_auth', reason: 'ADMIN_API_KEY_missing', reqId: req.id }, 'reject: server misconfigured')
    return reply.code(503).send({ error: 'ADMIN_API_KEY not configured' })
  }
  const sent = req.headers['x-admin-key']
  const value = Array.isArray(sent) ? sent[0] : sent
  const hasHeader = typeof value === 'string' && value.length > 0
  const ok = value === key
  req.log.info(
    { event: 'admin_auth', method: req.method, url: req.url, hasAdminHeader: hasHeader, authOk: ok, reqId: req.id },
    ok ? 'admin key ok' : 'admin key mismatch or missing',
  )
  if (!ok) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
}

export async function registerAuthedApi(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req) => {
    req.log.info(
      { event: 'api_in', method: req.method, url: req.url, host: req.headers.host, reqId: req.id },
      'request received',
    )
  })

  app.addHook('onResponse', async (req, reply) => {
    req.log.info(
      {
        event: 'api_out',
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        ms: reply.elapsedTime,
        reqId: req.id,
      },
      'response sent',
    )
  })

  app.addHook('preHandler', requireAdmin)
  await registerApiRoutes(app)
}

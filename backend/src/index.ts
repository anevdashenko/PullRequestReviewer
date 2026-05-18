import Fastify, { type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import { connectDatabase } from './db.js'
import { registerAuthedApi } from './plugins/admin-auth.js'
import { startPrPollTimer } from './poll-repos.js'
import { registerWebhookRoutes } from './routes/webhooks.js'

type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer }

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: true,
  allowedHeaders: ['Content-Type', 'X-Admin-Key'],
})

app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  const path = req.url?.split('?')[0] ?? ''
  try {
    const buf = body instanceof Buffer ? body : Buffer.from(String(body), 'utf8')
    if (path === '/webhooks/github') {
      ;(req as RequestWithRawBody).rawBody = buf
    }
    const json = JSON.parse(buf.toString('utf8')) as unknown
    done(null, json)
  } catch (err) {
    done(err as Error, undefined)
  }
})

app.get('/api/health', async () => ({ ok: true, service: 'prr-api' }))

await app.register(registerAuthedApi, { prefix: '/api' })
await app.register(registerWebhookRoutes)

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await connectDatabase()
  app.log.info('database connected')
} catch (err) {
  app.log.error(err, 'database connection failed — fix DATABASE_URL or start Postgres')
  process.exit(1)
}

startPrPollTimer()

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

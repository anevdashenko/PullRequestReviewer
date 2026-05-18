import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

/** Fail fast at startup when Postgres is unreachable instead of hanging on first query. */
export async function connectDatabase(): Promise<void> {
  const timeoutMs = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000)
  await Promise.race([
    prisma.$connect(),
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Database connection timed out after ${timeoutMs}ms (check DATABASE_URL and that Postgres is running)`,
            ),
          ),
        timeoutMs,
      )
    }),
  ])
}

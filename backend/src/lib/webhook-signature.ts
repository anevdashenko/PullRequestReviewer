import crypto from 'node:crypto'

export function verifyGithubSignature(
  rawBody: Buffer,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const their = signatureHeader.slice(7)
  const ours = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    const a = Buffer.from(their, 'hex')
    const b = Buffer.from(ours, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

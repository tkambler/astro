import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { IncomingMessage } from 'node:http'

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
const maximumBuckets = 20_000

function prune(now: number) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
  while (buckets.size > maximumBuckets) buckets.delete(buckets.keys().next().value!)
}

/** A bounded, process-local fixed-window limiter for inexpensive edge protection. */
export function consumeRateLimit(scope: string, key: string, limit: number, windowMs: number) {
  const now = Date.now()
  if (buckets.size >= maximumBuckets) prune(now)
  const id = `${scope}:${key}`
  const current = buckets.get(id)
  const bucket = !current || current.resetAt <= now ? { count: 1, resetAt: now + windowMs }
    : { count: current.count + 1, resetAt: current.resetAt }
  buckets.set(id, bucket)
  return bucket.count <= limit ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
}

export function clientAddress(request: Pick<IncomingMessage, 'headers' | 'socket'>) {
  const forwarded = request.headers['x-forwarded-for']
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').map(value => value.trim()).filter(Boolean) ?? []
  chain.push(request.socket.remoteAddress || 'unknown')
  const trustedHops = Number(process.env.TRUST_PROXY_HOPS ?? 0)
  return chain[Math.max(0, chain.length - 1 - (Number.isSafeInteger(trustedHops) && trustedHops > 0 ? trustedHops : 0))]!
}

export function rateLimit(scope: string, limit: number, windowMs: number,
  key: (request: Request) => string = request => request.ip ?? clientAddress(request)): RequestHandler {
  return (request, response, next) => {
    const retryAfter = consumeRateLimit(scope, key(request), limit, windowMs)
    if (!retryAfter) return next()
    response.set('Retry-After', String(retryAfter))
    return response.status(429).json({ error: 'Too many requests. Try again later.' })
  }
}

export function concurrencyLimit(maximum: number): RequestHandler {
  let active = 0
  return (_request: Request, response: Response, next: NextFunction) => {
    if (active >= maximum) {
      response.set('Retry-After', '1')
      response.status(503).json({ error: 'Server is busy. Try again shortly.' })
      return
    }
    active++
    let released = false
    const release = () => { if (!released) { released = true; active-- } }
    response.once('finish', release)
    response.once('close', release)
    next()
  }
}

export function securityHeaders(production: boolean): RequestHandler {
  return (_request, response, next) => {
    response.set({
      // PGlite's local database runtime requires eval and WebAssembly compilation, including while offline.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    })
    if (production) response.set('Strict-Transport-Security', 'max-age=86400')
    next()
  }
}

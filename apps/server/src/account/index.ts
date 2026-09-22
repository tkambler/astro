import type { Express, Request, Response } from 'express'
import { accountForSession, authenticateAccount, createSession, endSession,
  registerAccount, authenticationAttemptAllowed, rotateRecoveryCode, recoverAccount,
  clearAuthenticationAttempts, AccountAlreadyExistsError, RegistrationDisabledError, AuthenticationBusyError, getSystemSettings,
  getAccountPreferences, setAccountPreferences, accountForApiKey, listApiKeys, createApiKey, deleteApiKey, ApiKeyLimitError } from '@astronote/domain'
import { account, accountPreferences, apiKeyName, credentials, passwordConfirmation, recoveryRequest } from '@astronote/schemas'
import { z } from 'zod'

const secure = process.env.NODE_ENV === 'production'
export const sessionCookieName = secure ? '__Host-astronote' : 'astronote_dev'
const cookieAttributes = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
type AttemptLimit = { source: string; maximum: number; windowMs: number }
const minutes = (value: number) => value * 60 * 1000
async function limited(response: Response, limits: AttemptLimit[]) {
  for (const { source, maximum, windowMs } of limits) if (!await authenticationAttemptAllowed(source, maximum, windowMs)) {
    response.set('Retry-After', String(Math.ceil(windowMs / 1000)))
    response.status(429).json({ error: 'Too many attempts. Try again later.' })
    return true
  }
  return false
}
function address(request: Request) { return request.ip ?? request.socket.remoteAddress ?? 'unknown' }
function busy(response: Response, error: unknown) {
  if (!(error instanceof AuthenticationBusyError)) return false
  response.set('Retry-After', '1')
  response.status(503).json({ error: 'Authentication service is busy. Try again shortly.' })
  return true
}
async function clearAccountLimit(scope: string, email: string) {
  await clearAuthenticationAttempts(`${scope}:account:${email}`)
}
function token(request: { headers: { cookie?: string } }) {
  const cookies = request.headers.cookie?.split(';') ?? []
  return cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${sessionCookieName}=`))?.slice(sessionCookieName.length + 1) ?? ''
}
function setCookie(response: Response, value: string) {
  response.setHeader('Set-Cookie', `${sessionCookieName}=${value}; Max-Age=2592000; ${cookieAttributes}`)
}
function clearCookie(response: Response) {
  response.setHeader('Set-Cookie', `${sessionCookieName}=; Max-Age=0; ${cookieAttributes}`)
}

export function currentAccount(request: { headers: { cookie?: string; authorization?: string } }) {
  const authorization = request.headers.authorization
  if (authorization?.startsWith('Bearer ')) return accountForApiKey(authorization.slice(7))
  return accountForSession(token(request))
}

export async function requireAccount(request: Request, response: Response) {
  const current = await currentAccount(request)
  if (!current) response.status(401).json({ error: 'Sign in to sync notes.' })
  return current
}

export function mountAccountRoutes(app: Express) {
  app.use('/api/account', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
  app.get('/api/account/registration', async (_request, response) => {
    try { return response.json(await getSystemSettings()) }
    catch { return response.status(500).json({ error: 'Could not check account registration' }) }
  })
  app.get('/api/account', async (request, response) => {
    try {
      const current = await currentAccount(request)
      return response.json({ account: current })
    } catch { return response.status(500).json({ error: 'Could not check account' }) }
  })
  app.post('/api/account/register', async (request, response) => {
    try {
      if (await limited(response, [{ source: `register:ip:${address(request)}`, maximum: 5, windowMs: minutes(60) }])) return
      const parsed = credentials.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
      const result = await registerAccount(parsed.data)
      const created = account.parse(result)
      setCookie(response, await createSession(created.id))
      return response.status(201).json({ account: created, recoveryCode: result.recoveryCode })
    } catch (error) {
      if (error instanceof AccountAlreadyExistsError) return response.status(409).json({ error: 'Account already exists' })
      if (error instanceof RegistrationDisabledError) return response.status(403).json({ error: 'Account registration is disabled' })
      if (busy(response, error)) return
      return response.status(500).json({ error: 'Could not create account' })
    }
  })
  app.post('/api/account/login', async (request, response) => {
    try {
      const parsed = credentials.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: 'Invalid credentials' })
      if (await limited(response, [
        { source: `login:ip:${address(request)}`, maximum: 30, windowMs: minutes(15) },
        { source: `login:account:${parsed.data.email}`, maximum: 10, windowMs: minutes(15) },
      ])) return
      const current = await authenticateAccount(parsed.data)
      if (!current) return response.status(401).json({ error: 'Invalid credentials' })
      await clearAccountLimit('login', parsed.data.email)
      setCookie(response, await createSession(current.id))
      return response.json({ account: current })
    } catch (error) {
      if (busy(response, error)) return
      return response.status(500).json({ error: 'Could not sign in' })
    }
  })
  app.post('/api/account/recover', async (request, response) => {
    try {
      const parsed = recoveryRequest.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: 'Invalid recovery details' })
      if (await limited(response, [
        { source: `recover:ip:${address(request)}`, maximum: 20, windowMs: minutes(15) },
        { source: `recover:account:${parsed.data.email}`, maximum: 5, windowMs: minutes(15) },
      ])) return
      const result = await recoverAccount(parsed.data)
      if (!result) return response.status(401).json({ error: 'Invalid recovery details' })
      await clearAccountLimit('recover', parsed.data.email)
      const current = account.parse(result)
      setCookie(response, await createSession(current.id))
      return response.json({ account: current, recoveryCode: result.recoveryCode })
    } catch (error) {
      if (busy(response, error)) return
      return response.status(500).json({ error: 'Could not recover account' })
    }
  })
  app.post('/api/account/recovery-code', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const parsed = passwordConfirmation.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: 'Current password is required' })
      if (await limited(response, [
        { source: `rotate-recovery:ip:${address(request)}`, maximum: 20, windowMs: minutes(15) },
        { source: `rotate-recovery:account:${current.email}`, maximum: 5, windowMs: minutes(15) },
      ])) return
      if (!await authenticateAccount({ email: current.email, password: parsed.data.password }))
        return response.status(401).json({ error: 'Current password is incorrect' })
      await clearAccountLimit('rotate-recovery', current.email)
      return response.json({ recoveryCode: await rotateRecoveryCode(current.id) })
    } catch (error) {
      if (busy(response, error)) return
      return response.status(500).json({ error: 'Could not generate recovery code' })
    }
  })
  app.get('/api/account/preferences', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const saved = await getAccountPreferences(current.id)
      if (saved === null) return response.json({ preferences: null })
      const parsed = accountPreferences.safeParse(saved)
      return response.json({ preferences: parsed.success ? parsed.data : null })
    } catch { return response.status(500).json({ error: 'Could not load preferences' }) }
  })
  app.put('/api/account/preferences', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const parsed = accountPreferences.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: 'Invalid preferences' })
      await setAccountPreferences(current.id, parsed.data)
      return response.status(204).end()
    } catch { return response.status(500).json({ error: 'Could not save preferences' }) }
  })
  app.get('/api/account/api-keys', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      return response.json({ apiKeys: await listApiKeys(current.id) })
    } catch { return response.status(500).json({ error: 'Could not load API keys' }) }
  })
  app.post('/api/account/api-keys', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const parsed = apiKeyName.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: 'Enter a name between 1 and 80 characters' })
      return response.status(201).json(await createApiKey(current.id, parsed.data.name))
    } catch (error) {
      if (error instanceof ApiKeyLimitError) return response.status(409).json({ error: 'An account may have at most 20 API keys' })
      return response.status(500).json({ error: 'Could not create API key' })
    }
  })
  app.delete('/api/account/api-keys/:id', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      const id = z.uuid().safeParse(request.params.id)
      if (!id.success) return response.status(400).json({ error: 'Invalid API key ID' })
      if (!await deleteApiKey(current.id, id.data)) return response.status(404).json({ error: 'API key not found' })
      return response.status(204).end()
    } catch { return response.status(500).json({ error: 'Could not delete API key' }) }
  })
  app.post('/api/account/logout', async (request, response) => {
    try { await endSession(token(request)) }
    finally { clearCookie(response) }
    return response.status(204).end()
  })
}

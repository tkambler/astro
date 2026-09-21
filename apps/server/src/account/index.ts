import type { Express, Request, Response } from 'express'
import { accountForSession, authenticateAccount, createSession, endSession,
  registerAccount, authenticationAttemptAllowed, rotateRecoveryCode, recoverAccount,
  AccountAlreadyExistsError, RegistrationDisabledError, getSystemSettings,
  getAccountPreferences, setAccountPreferences } from '@astronote/domain'
import { account, accountPreferences, credentials, recoveryRequest } from '@astronote/schemas'

const secure = process.env.NODE_ENV === 'production'
export const sessionCookieName = secure ? '__Host-astronote' : 'astronote_dev'
const cookieAttributes = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
async function limited(request: Request, response: Response) {
  if (await authenticationAttemptAllowed(`account:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`)) return false
  response.status(429).json({ error: 'Too many attempts. Try again later.' })
  return true
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

export function currentAccount(request: { headers: { cookie?: string } }) {
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
      if (await limited(request, response)) return
      const parsed = credentials.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
      const result = await registerAccount(parsed.data)
      const created = account.parse(result)
      setCookie(response, await createSession(created.id))
      return response.status(201).json({ account: created, recoveryCode: result.recoveryCode })
    } catch (error) {
      if (error instanceof AccountAlreadyExistsError) return response.status(409).json({ error: 'Account already exists' })
      if (error instanceof RegistrationDisabledError) return response.status(403).json({ error: 'Account registration is disabled' })
      return response.status(500).json({ error: 'Could not create account' })
    }
  })
  app.post('/api/account/login', async (request, response) => {
    try {
      if (await limited(request, response)) return
      const parsed = credentials.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: 'Invalid credentials' })
      const current = await authenticateAccount(parsed.data)
      if (!current) return response.status(401).json({ error: 'Invalid credentials' })
      setCookie(response, await createSession(current.id))
      return response.json({ account: current })
    } catch { return response.status(500).json({ error: 'Could not sign in' }) }
  })
  app.post('/api/account/recover', async (request, response) => {
    try {
      if (await limited(request, response)) return
      const parsed = recoveryRequest.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: 'Invalid recovery details' })
      const result = await recoverAccount(parsed.data)
      if (!result) return response.status(401).json({ error: 'Invalid recovery details' })
      const current = account.parse(result)
      setCookie(response, await createSession(current.id))
      return response.json({ account: current, recoveryCode: result.recoveryCode })
    } catch { return response.status(500).json({ error: 'Could not recover account' }) }
  })
  app.post('/api/account/recovery-code', async (request, response) => {
    try {
      const current = await requireAccount(request, response)
      if (!current) return
      return response.json({ recoveryCode: await rotateRecoveryCode(current.id) })
    } catch { return response.status(500).json({ error: 'Could not generate recovery code' }) }
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
  app.post('/api/account/logout', async (request, response) => {
    try { await endSession(token(request)) }
    finally { clearCookie(response) }
    return response.status(204).end()
  })
}

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { database } from '@astronote/db'
import type { Account, AccountPreferences, Credentials, RecoveryRequest } from '@astronote/schemas'

const N = 1 << 15, r = 8, p = 3
const maxmem = 64 * 1024 * 1024
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000
const authenticationWindowMs = 15 * 60 * 1000
let nextLimitPrune = 0

export class AccountAlreadyExistsError extends Error {}
export class RegistrationDisabledError extends Error {}

/** Counts account attempts atomically in PostgreSQL so every API instance shares the limit. */
export async function authenticationAttemptAllowed(source: string) {
  const now = Date.now()
  if (now >= nextLimitPrune) {
    nextLimitPrune = now + 60 * 60 * 1000
    await database()('authentication_limits').where('reset_at', '<', new Date(now - 24 * 60 * 60 * 1000)).delete()
  }
  const key = createHash('sha256').update(source).digest('hex')
  const result = await database().raw<{ rows: { attempts: number }[] }>(`
    INSERT INTO authentication_limits (key_hash, attempts, reset_at) VALUES (?, 1, ?)
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts = CASE WHEN authentication_limits.reset_at <= now() THEN 1
        ELSE authentication_limits.attempts + 1 END,
      reset_at = CASE WHEN authentication_limits.reset_at <= now() THEN EXCLUDED.reset_at
        ELSE authentication_limits.reset_at END
    RETURNING attempts`, [key, new Date(now + authenticationWindowMs)])
  return (result.rows[0]?.attempts ?? 21) <= 20
}

async function derive(password: string, salt: string) {
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, Buffer.from(salt, 'hex'), 64, { N, r, p, maxmem }, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}
async function hashPassword(password: string) {
  const salt = randomBytes(32).toString('hex')
  const hash = await derive(password, salt)
  return `scrypt:${N}:${r}:${p}:${salt}:${hash.toString('hex')}`
}
async function checkPassword(password: string, stored: string) {
  const [algorithm, n, block, parallel, salt, expected] = stored.split(':')
  if (algorithm !== 'scrypt' || !salt || !expected || Number(n) !== N || Number(block) !== r || Number(parallel) !== p) return false
  const actual = await derive(password, salt)
  const original = Buffer.from(expected, 'hex')
  return original.length === actual.length && timingSafeEqual(actual, original)
}

export async function registerAccount(credentials: Credentials): Promise<Account & { recoveryCode: string }> {
  const id = crypto.randomUUID()
  const password_hash = await hashPassword(credentials.password)
  const code = recoveryCode()
  try {
    return await database().transaction(async tx => {
      // Serialize the first-user decision with registration setting changes.
      await tx.raw('SELECT pg_advisory_xact_lock(918273646)')
      const setting = await tx('system_settings').where({ key: 'enable_account_registration' }).first<{ value: boolean }>()
      if (!setting?.value) throw new RegistrationDisabledError()
      const existing = await tx('users').first('id')
      const admin = !existing
      await tx('users').insert({ id, email: credentials.email, admin, password_hash,
        recovery_code_hash: recoveryHash(code), created_at: new Date() })
      return { id, email: credentials.email, admin, recoveryCode: code }
    })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new AccountAlreadyExistsError()
    throw error
  }
}

export async function authenticateAccount(credentials: Credentials): Promise<Account | null> {
  const row = await database()('users').where({ email: credentials.email }).first<{ id: string; email: string; admin: boolean; password_hash: string }>()
  if (!row) {
    // Do equivalent password work for unknown accounts.
    await hashPassword(credentials.password)
    return null
  }
  return await checkPassword(credentials.password, row.password_hash) ? { id: row.id, email: row.email, admin: row.admin } : null
}

function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex') }
function recoveryCode() { return randomBytes(24).toString('hex').match(/.{8}/g)!.join('-') }
function recoveryHash(code: string) { return tokenHash(code.replaceAll('-', '')) }

/** Replaces an account's recovery code; the returned code is never stored in plaintext. */
export async function rotateRecoveryCode(userId: string) {
  const code = recoveryCode()
  const changed = await database()('users').where({ id: userId }).update({ recovery_code_hash: recoveryHash(code) })
  if (!changed) throw new Error('Account not found')
  return code
}

/** Consumes a recovery code, changes the password, and revokes every old session. */
export async function recoverAccount(request: RecoveryRequest): Promise<(Account & { recoveryCode: string }) | null> {
  const password_hash = await hashPassword(request.password)
  const nextCode = recoveryCode()
  return await database().transaction(async tx => {
    const row = await tx('users').where({ email: request.email }).forUpdate()
      .first<{ id: string; email: string; admin: boolean; recovery_code_hash: string | null }>()
    if (!row?.recovery_code_hash) return null
    const expected = Buffer.from(row.recovery_code_hash, 'hex')
    const actual = Buffer.from(recoveryHash(request.recoveryCode), 'hex')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    await tx('users').where({ id: row.id }).update({ password_hash, recovery_code_hash: recoveryHash(nextCode) })
    await tx('sessions').where({ user_id: row.id }).delete()
    return { id: row.id, email: row.email, admin: row.admin, recoveryCode: nextCode }
  })
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex')
  await database()('sessions').insert({ token_hash: tokenHash(token), user_id: userId,
    expires_at: new Date(Date.now() + sessionLifetimeMs) })
  return token
}
export async function accountForSession(token: string): Promise<Account | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const row = await database()('sessions as sessions')
    .join('users as users', 'users.id', 'sessions.user_id')
    .where('sessions.token_hash', tokenHash(token))
    .andWhere('sessions.expires_at', '>', new Date())
    .select('users.id', 'users.email', 'users.admin').first<Account>()
  return row ?? null
}
export async function endSession(token: string) {
  if (/^[a-f0-9]{64}$/.test(token)) await database()('sessions').where({ token_hash: tokenHash(token) }).delete()
}

/** Account preferences roam across installations while each client retains its offline copy. */
export async function getAccountPreferences(userId: string): Promise<unknown | null> {
  const row = await database()('users').where({ id: userId }).first<{ preferences: unknown | null }>('preferences')
  return row?.preferences ?? null
}

export async function setAccountPreferences(userId: string, preferences: AccountPreferences) {
  const changed = await database()('users').where({ id: userId }).update({ preferences })
  if (!changed) throw new Error('Account not found')
}

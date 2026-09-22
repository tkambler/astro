import { createHash, randomBytes } from 'node:crypto'
import { database } from '@astronote/db'
import type { Account, ApiKey } from '@astronote/schemas'

const prefix = 'astronote_'
const maximumKeys = 20
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type ApiKeyRow = { id: string; name: string; created_at: Date; last_used_at: Date | null }

function publicKey(row: ApiKeyRow): ApiKey {
  return { id: row.id, name: row.name, createdAt: row.created_at.toISOString(), lastUsedAt: row.last_used_at?.toISOString() ?? null }
}

export class ApiKeyLimitError extends Error {}

export async function listApiKeys(userId: string) {
  const rows = await database()('api_keys').where({ user_id: userId })
    .select<ApiKeyRow[]>('id', 'name', 'created_at', 'last_used_at').orderBy('created_at', 'desc')
  return rows.map(publicKey)
}

/** Creates a key whose plaintext is returned once and never stored. */
export async function createApiKey(userId: string, name: string) {
  const key = `${prefix}${randomBytes(32).toString('hex')}`
  const row = await database().transaction(async tx => {
    await tx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`api-keys:${userId}`])
    const counts = await tx('api_keys').where({ user_id: userId }).count<{ count: string }[]>('* as count')
    if (Number(counts[0]?.count ?? maximumKeys) >= maximumKeys) throw new ApiKeyLimitError()
    const [created] = await tx('api_keys').insert({ id: crypto.randomUUID(), user_id: userId, name,
      token_hash: hash(key), created_at: new Date() }).returning<ApiKeyRow[]>(['id', 'name', 'created_at', 'last_used_at'])
    return created!
  })
  return { ...publicKey(row), key }
}

export async function deleteApiKey(userId: string, id: string) {
  return await database()('api_keys').where({ id, user_id: userId }).delete() > 0
}

export async function accountForApiKey(key: string): Promise<Account | null> {
  if (!new RegExp(`^${prefix}[a-f0-9]{64}$`).test(key)) return null
  const row = await database()('api_keys as keys').join('users', 'users.id', 'keys.user_id')
    .where('keys.token_hash', hash(key)).select<{ keyId: string; id: string; email: string; admin: boolean }>(
      'keys.id as keyId', 'users.id', 'users.email', 'users.admin').first()
  if (!row) return null
  void database()('api_keys').where({ id: row.keyId }).update({ last_used_at: new Date() }).catch(() => undefined)
  return { id: row.id, email: row.email, admin: row.admin }
}

import { database } from '@astronote/db'
import type { SystemSettings, SystemUser } from '@astronote/schemas'

export class SystemAccessDeniedError extends Error {}

/** Returns only public account metadata, ordered by creation time. */
export async function listSystemUsers(actorId: string): Promise<SystemUser[]> {
  const actor = await database()('users').where({ id: actorId }).first<{ admin: boolean }>('admin')
  if (!actor?.admin) throw new SystemAccessDeniedError()
  const rows = await database()('users').select('id', 'email', 'admin', 'created_at')
    .orderBy('created_at', 'asc').orderBy('id', 'asc') as {
      id: string; email: string; admin: boolean; created_at: Date
    }[]
  return rows.map(row => ({ id: row.id, email: row.email, admin: row.admin,
    createdAt: row.created_at.toISOString() }))
}

/** The system owns instance-wide settings; callers never write its table directly. */
export async function getSystemSettings(): Promise<SystemSettings> {
  const row = await database()('system_settings').where({ key: 'enable_account_registration' }).first<{ value: boolean }>()
  if (!row) throw new Error('Account registration setting is missing')
  return { enableAccountRegistration: row.value }
}

export async function setAccountRegistration(actorId: string, enabled: boolean): Promise<SystemSettings> {
  return database().transaction(async tx => {
    await tx.raw('SELECT pg_advisory_xact_lock(918273646)')
    const actor = await tx('users').where({ id: actorId }).first<{ admin: boolean }>('admin')
    if (!actor?.admin) throw new SystemAccessDeniedError()
    await tx('system_settings').where({ key: 'enable_account_registration' }).update({ value: enabled })
    return { enableAccountRegistration: enabled }
  })
}

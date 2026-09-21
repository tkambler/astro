import { accountKey, announceChange, db, owner, ready } from './database'
import { newIdentifier } from './identifiers'

/** Moves guest notes into a newly connected account as fresh pending mutations. */
export async function activateAccount(accountId: string) {
  await ready()
  if (owner() === accountId) return
  await db.transaction(async tx => {
    const guests = await tx.query<{ id: string }>(`SELECT id FROM notes WHERE owner_id='guest' AND deleted_at IS NULL`)
    for (const guest of guests.rows) {
      await tx.query(`UPDATE notes SET id=$1,owner_id=$2,revision=0,base_revision=0,synced_body='',synced_title='',
        dirty=true,mutation_id=$3 WHERE id=$4 AND owner_id='guest'`,
      [newIdentifier(), accountId, newIdentifier(), guest.id])
    }
  })
  localStorage.setItem(accountKey, accountId)
  announceChange()
}

export function deactivateAccount() {
  localStorage.removeItem(accountKey)
  announceChange()
}

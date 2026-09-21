import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.raw(`DELETE FROM note_shares WHERE id IN (
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY user_id, note_id ORDER BY created_at DESC, id DESC) AS position
      FROM note_shares
    ) duplicates WHERE position > 1
  )`)
  await db.schema.alterTable('note_shares', table => table.unique(['user_id', 'note_id']))
}

export async function down(db: Knex) {
  await db.schema.alterTable('note_shares', table => table.dropUnique(['user_id', 'note_id']))
}

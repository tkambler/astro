import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.raw('ALTER TABLE notes ADD COLUMN created_at timestamptz')
  await db.raw('UPDATE notes SET created_at = updated_at')
  await db.raw('ALTER TABLE notes ALTER COLUMN created_at SET NOT NULL')
}

export async function down(db: Knex) {
  await db.schema.alterTable('notes', table => table.dropColumn('created_at'))
}

import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.alterTable('notes', table => {
    table.boolean('purged').notNullable().defaultTo(false)
  })
}

export async function down(db: Knex) {
  await db.schema.alterTable('notes', table => table.dropColumn('purged'))
}

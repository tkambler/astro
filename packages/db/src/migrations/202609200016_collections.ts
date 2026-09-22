import type { Knex } from 'knex'

/** Notes always live in one single-level collection. Existing notes remain together. */
export async function up(db: Knex) {
  await db.schema.alterTable('notes', table => {
    table.string('collection', 80).notNullable().defaultTo('Notes')
    table.index(['user_id', 'collection'])
  })
}

export async function down(db: Knex) {
  await db.schema.alterTable('notes', table => {
    table.dropIndex(['user_id', 'collection'])
    table.dropColumn('collection')
  })
}

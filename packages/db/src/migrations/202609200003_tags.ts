import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.alterTable('notes', table => {
    table.specificType('tags', 'text[]').notNullable().defaultTo('{}')
  })
}
export async function down(db: Knex) {
  await db.schema.alterTable('notes', table => table.dropColumn('tags'))
}

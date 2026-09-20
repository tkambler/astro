import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.alterTable('users', table => {
    table.integer('note_generation').notNullable().defaultTo(0)
  })
}

export async function down(db: Knex) {
  await db.schema.alterTable('users', table => table.dropColumn('note_generation'))
}

import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.createTable('authentication_limits', table => {
    table.text('key_hash').primary()
    table.integer('attempts').notNullable()
    table.timestamp('reset_at', { useTz: true }).notNullable().index()
  })
}

export async function down(db: Knex) {
  await db.schema.dropTable('authentication_limits')
}

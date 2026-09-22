import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.createTable('api_keys', table => {
    table.uuid('id').primary()
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.text('name').notNullable()
    table.text('token_hash').notNullable().unique()
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.timestamp('last_used_at', { useTz: true }).nullable()
    table.index(['user_id'])
  })
}

export async function down(db: Knex) {
  await db.schema.dropTable('api_keys')
}

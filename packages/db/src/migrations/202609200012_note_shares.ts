import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.createTable('note_shares', table => {
    table.text('id').primary()
    table.uuid('note_id').notNullable().references('id').inTable('notes').onDelete('CASCADE')
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.index(['user_id', 'created_at'])
    table.index(['note_id'])
  })
}

export async function down(db: Knex) {
  await db.schema.dropTable('note_shares')
}

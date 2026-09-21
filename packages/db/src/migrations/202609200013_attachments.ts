import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.createTable('attachments', table => {
    table.uuid('id').primary()
    table.uuid('note_id').notNullable().references('id').inTable('notes').onDelete('CASCADE')
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.text('filename').notNullable()
    table.text('media_type').notNullable()
    table.integer('byte_size').notNullable()
    table.text('sha256').notNullable()
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.index(['note_id', 'created_at'])
    table.index(['user_id'])
  })
}

export async function down(db: Knex) {
  await db.schema.dropTable('attachments')
}

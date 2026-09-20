import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.createTable('users', table => {
    table.uuid('id').primary()
    table.text('email').notNullable().unique()
    table.text('password_hash').notNullable()
    table.timestamp('created_at', { useTz: true }).notNullable()
  })
  await db.schema.createTable('sessions', table => {
    table.text('token_hash').primary()
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.timestamp('expires_at', { useTz: true }).notNullable()
    table.index(['user_id'])
  })
  // Legacy rows remain unowned and inaccessible. Export/import can move them safely.
  await db.schema.alterTable('notes', table => {
    table.uuid('user_id').nullable().references('id').inTable('users')
    table.index(['user_id'])
  })
  await db.schema.alterTable('note_changes', table => {
    table.uuid('user_id').nullable().references('id').inTable('users')
    table.index(['user_id', 'sequence'])
  })
  await db.schema.alterTable('note_mutations', table => {
    table.uuid('user_id').nullable().references('id').inTable('users')
  })
}

export async function down(db: Knex) {
  await db.schema.alterTable('note_mutations', table => table.dropColumn('user_id'))
  await db.schema.alterTable('note_changes', table => table.dropColumn('user_id'))
  await db.schema.alterTable('notes', table => table.dropColumn('user_id'))
  await db.schema.dropTable('sessions')
  await db.schema.dropTable('users')
}

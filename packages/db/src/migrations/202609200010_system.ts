import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.alterTable('users', table => {
    table.boolean('admin').notNullable().defaultTo(false)
  })
  // Existing installations need an administrator after this migration.
  await db.raw(`UPDATE users SET admin=true WHERE id=(SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)`)
  await db.schema.createTable('system_settings', table => {
    table.text('key').primary()
    table.boolean('value').notNullable()
  })
  await db('system_settings').insert({ key: 'enable_account_registration', value: true })
}

export async function down(db: Knex) {
  await db.schema.dropTable('system_settings')
  await db.schema.alterTable('users', table => table.dropColumn('admin'))
}

import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.createTable('collections', table => {
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.string('name', 80).notNullable()
    table.string('name_key', 80).notNullable()
    table.timestamp('created_at', { useTz: true }).notNullable()
    table.primary(['user_id', 'name_key'])
  })
  await db.raw(`INSERT INTO collections (user_id, name, name_key, created_at)
    SELECT id, 'Notes', 'notes', NOW() FROM users`)
  await db.raw(`INSERT INTO collections (user_id, name, name_key, created_at)
    SELECT user_id, MIN(collection), LOWER(collection), NOW() FROM notes
    WHERE user_id IS NOT NULL GROUP BY user_id, LOWER(collection)
    ON CONFLICT (user_id, name_key) DO NOTHING`)
}

export async function down(db: Knex) {
  await db.schema.dropTable('collections')
}

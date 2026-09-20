import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.alterTable('users', table => {
    table.text('recovery_code_hash').nullable()
  })
}

export async function down(db: Knex) {
  await db.schema.alterTable('users', table => table.dropColumn('recovery_code_hash'))
}

import type { Knex } from 'knex'

export async function up(db: Knex) {
  await db.schema.createTable('notes', table => {
    table.uuid('id').primary()
    table.text('title').notNullable()
    table.text('body').notNullable()
    table.integer('revision').notNullable()
    table.timestamp('updated_at', { useTz: true }).notNullable()
    table.timestamp('deleted_at', { useTz: true }).nullable()
  })
  await db.schema.createTable('note_changes', table => {
    table.bigIncrements('sequence').primary()
    table.uuid('note_id').notNullable().references('id').inTable('notes')
    table.integer('revision').notNullable()
  })
  await db.schema.createTable('note_mutations', table => {
    table.uuid('id').primary()
    table.uuid('note_id').notNullable().references('id').inTable('notes')
  })
}

export async function down(db: Knex) {
  await db.schema.dropTable('note_mutations')
  await db.schema.dropTable('note_changes')
  await db.schema.dropTable('notes')
}

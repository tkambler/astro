import { z } from 'zod'
import { activeAccountId, importLocalNotes, listNotes } from '../local'
import { textNote } from './frontmatter'

const backup = z.object({
  format: z.literal('astronote-backup'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  notes: z.array(z.object({ title: z.string().max(500), body: z.string(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    createdAt: z.iso.datetime().optional(), updatedAt: z.iso.datetime().optional() })),
})

/** Downloads a portable JSON copy of the device's non-deleted notes. */
export async function exportNotes() {
  const notes = await listNotes()
  const data = backup.parse({ format: 'astronote-backup', version: 1,
    exportedAt: new Date().toISOString(), notes: notes.map(({ title, body, tags, createdAt, updatedAt }) =>
      ({ title, body, tags, createdAt, updatedAt })) })
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `astronote-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return notes.length
}

/** Imports backup notes as new local notes; sync can run later when online. */
export async function importNotes(file: File) {
  if (file.size > 50 * 1024 * 1024) throw new Error('Backup exceeds 50 MB')
  const data = backup.parse(JSON.parse(await file.text()))
  await importLocalNotes(data.notes)
  return data.notes.length
}

/** Imports Markdown and text files as new notes in one local transaction. */
export async function importTextFiles(files: FileList | File[]) {
  const selected = Array.from(files)
  if (!selected.length) return 0
  const accountId = activeAccountId()
  if (selected.some(file => !/\.(md|txt)$/i.test(file.name)))
    throw new Error('Select only .md or .txt files')
  if (selected.some(file => file.size > 50 * 1024 * 1024))
    throw new Error('Each file must be 50 MB or smaller')
  const notes = []
  for (const file of selected) {
    let body: string
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }
    catch { throw new Error(`${file.name}: file must be UTF-8 text`) }
    notes.push(textNote(file.name, body))
  }
  if (activeAccountId() !== accountId) throw new Error('Account changed during import; select the files again')
  await importLocalNotes(notes)
  return notes.length
}

import { z } from 'zod'
import { importLocalNotes, listNotes } from '../local'

const backup = z.object({
  format: z.literal('astronote-backup'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  notes: z.array(z.object({ title: z.string().max(500), body: z.string(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional() })),
})

/** Downloads a portable JSON copy of the device's non-deleted notes. */
export async function exportNotes() {
  const notes = await listNotes()
  const data = backup.parse({ format: 'astronote-backup', version: 1,
    exportedAt: new Date().toISOString(), notes: notes.map(({ title, body, tags }) => ({ title, body, tags })) })
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

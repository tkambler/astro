import { isMap, parseDocument } from 'yaml'

export type TextNote = { title: string; body: string; tags: string[]; createdAt?: string; updatedAt?: string }

/** Reads metadata from frontmatter while preserving the original file body. */
export function textNote(filename: string, body: string): TextNote {
  const titleFromFilename = filename.replace(/\.(md|txt)$/i, '').trim().slice(0, 500) || 'Untitled'
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/my.exec(body)
  if (!match) return { title: titleFromFilename, body, tags: [] }

  const document = parseDocument(match[1]!, { uniqueKeys: true })
  if (document.errors.length) throw new Error(`${filename}: invalid YAML frontmatter: ${document.errors[0]!.message}`)
  if (document.contents !== null && !isMap(document.contents))
    throw new Error(`${filename}: YAML frontmatter must be a mapping`)
  const metadata = (document.toJS({ maxAliasCount: 20 }) ?? {}) as Record<string, unknown>
  const title = typeof metadata.title === 'string' && metadata.title.trim()
    ? metadata.title.trim() : titleFromFilename
  if (title.length > 500) throw new Error(`${filename}: title exceeds 500 characters`)

  const rawTags = metadata.tags
  const values = rawTags == null ? [] : typeof rawTags === 'string' ? rawTags.split(',') : rawTags
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string'))
    throw new Error(`${filename}: tags must be a string or a list of strings`)
  const tags = [...new Set((values as string[]).map(value => value.trim()).filter(Boolean))]
  if (tags.length > 20 || tags.some(tag => tag.length > 50))
    throw new Error(`${filename}: notes support at most 20 tags of 50 characters each`)

  return { title, body, tags,
    createdAt: timestamp(metadata.createdAt, filename, 'createdAt'),
    updatedAt: timestamp(metadata.updatedAt, filename, 'updatedAt') }
}

function timestamp(value: unknown, filename: string, field: string): string | undefined {
  if (value == null) return undefined
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value !== 'string') throw new Error(`${filename}: ${field} must be a date or date-time string`)
  const input = value.trim()
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T00:00:00Z`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(input) ? `${input}Z` : input
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime()) || (/^\d{4}-\d{2}-\d{2}$/.test(input) && date.toISOString().slice(0, 10) !== input))
    throw new Error(`${filename}: invalid ${field} date`)
  return date.toISOString()
}

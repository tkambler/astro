import { parseDocument } from 'yaml'

/** Separates a leading YAML frontmatter block from the note's visible content. */
export function splitFrontmatter(body: string) {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/my.exec(body)
  return match ? { source: match[1]!, content: body.slice(match[0].length) } : null
}

/** Whether the rich editor can safely parse this note's YAML frontmatter. */
export function hasInvalidFrontmatter(body: string) {
  const frontmatter = splitFrontmatter(body)
  if (!frontmatter) return false
  try { return parseDocument(frontmatter.source).errors.length > 0 }
  catch { return true }
}

/** Plain text shown under a note title in the sidebar. */
export function notePreview(body: string) {
  const content = splitFrontmatter(body)?.content ?? body
  return content.trimStart().replace(/[#*_`>\[\]]/g, '').trimStart().slice(0, 115) || 'Empty note'
}

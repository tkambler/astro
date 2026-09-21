import { noteShare, publicNote, type NoteShare, type PublicNote } from '@astronote/schemas'

async function apiError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null
  return new Error(body?.error ?? fallback)
}

export async function createShare(noteId: string): Promise<NoteShare> {
  const response = await fetch('/api/shares', { method: 'POST', headers: {
    'content-type': 'application/json', 'x-astronote-request': '1' }, body: JSON.stringify({ noteId }) })
  if (!response.ok) throw await apiError(response, 'Could not share note')
  return noteShare.parse(await response.json())
}

export async function listShares(): Promise<NoteShare[]> {
  const response = await fetch('/api/shares', { cache: 'no-store' })
  if (!response.ok) throw await apiError(response, 'Could not load shared links')
  return noteShare.array().parse((await response.json() as { shares: unknown }).shares)
}

export async function revokeShare(id: string): Promise<void> {
  const response = await fetch(`/api/shares/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'x-astronote-request': '1' } })
  if (!response.ok) throw await apiError(response, 'Could not revoke shared link')
}

export async function loadPublicNote(id: string): Promise<PublicNote> {
  const response = await fetch(`/api/shared/${encodeURIComponent(id)}`, { cache: 'no-store' })
  if (!response.ok) throw await apiError(response, response.status === 404 ? 'This shared note is unavailable.' : 'Could not load shared note')
  return publicNote.parse(await response.json())
}

export function shareUrl(id: string) {
  return `${window.location.origin}/shared/${id}`
}

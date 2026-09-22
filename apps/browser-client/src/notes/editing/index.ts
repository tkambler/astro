type Draft = { title: string; body: string }
type IncomingNote = Draft & { revision: number; dirty: boolean }

/** Decides whether a stored snapshot may replace the live editor draft without discarding local input. */
export function shouldAdoptIncomingDraft(incoming: IncomingNote, draft: Draft, appliedRevision: number, pendingSaves: number) {
  if (incoming.dirty || pendingSaves > 0) return false
  const differs = incoming.title !== draft.title || incoming.body !== draft.body
  return !differs || incoming.revision > appliedRevision
}

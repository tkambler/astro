import { diffLines } from 'diff'

export type NoteChange = { kind: 'added' | 'removed' | 'same'; text: string }

/** Compares the current Markdown body with the last acknowledged server body. */
export function compareNote(previous: string, current: string): NoteChange[] {
  return diffLines(previous, current).map(change => ({
    kind: change.added ? 'added' : change.removed ? 'removed' : 'same',
    text: change.value,
  }))
}

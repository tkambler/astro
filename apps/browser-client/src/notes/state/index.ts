import { create } from 'zustand'
import type { LocalNote } from '../local'
import { activeAccountId, emptyTrash as emptyLocalTrash, listNotes, listTrash, newIdentifier, restoreNote,
  saveNote, setPinned as setLocalPinned } from '../local'
import { resetAllNotes, syncNotes, type SyncProgress } from '../sync'
import { usePreferences, type NoteSort, type SortDirection } from '../../preferences'
import { useAccount } from '../../account'
import { removeCachedAttachment } from '../../attachments'

let editSyncTimer: ReturnType<typeof setTimeout> | undefined

function visibleNotes(notes: LocalNote[], search: string, tagFilter: string | null,
  sort: NoteSort = usePreferences.getState().sort,
  direction: SortDirection = usePreferences.getState().sortDirection) {
  const term = search.toLocaleLowerCase()
  const filtered = notes.filter(note => (!tagFilter || note.tags.includes(tagFilter)) &&
    (!term || note.title.toLocaleLowerCase().includes(term) || note.body.toLocaleLowerCase().includes(term) ||
      note.tags.join(' ').toLocaleLowerCase().includes(term)))
  return filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const rank = term ? Number(!a.title.toLocaleLowerCase().includes(term)) -
      Number(!b.title.toLocaleLowerCase().includes(term)) : 0
    if (rank) return rank
    const order = sort === 'title' ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) :
      a.updatedAt.localeCompare(b.updatedAt)
    return (direction === 'asc' ? order : -order) || a.id.localeCompare(b.id)
  })
}

function selectVisible(notes: LocalNote[], selectedId: string | null, selectionCleared: boolean) {
  if (selectionCleared) return null
  return notes.some(note => note.id === selectedId) ? selectedId : notes[0]?.id ?? null
}

type State = {
  notes: LocalNote[]; allNotes: LocalNote[]; trash: LocalNote[]; tags: string[]; tagFilter: string | null; search: string;
  selectedId: string | null; selectionCleared: boolean;
  status: 'loading' | 'local' | 'offline' | 'auth-required' | 'syncing' | 'synced' | 'sync-error' | 'storage-error'; error: string | null;
  progress: SyncProgress | null;
  setSearch(search: string): Promise<void>; setTagFilter(tag: string | null): Promise<void>; refresh(): Promise<void>;
  resort(): void;
  select(id: string | null): void; create(title: string): Promise<boolean>;
  save(id: string, title: string, body: string, tags: string[]): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>; restore(id: string): Promise<boolean>; emptyTrash(): Promise<number>;
  reset(): Promise<void>; sync(): Promise<void>;
}

export const useNotes = create<State>((set, get) => ({
  notes: [], allNotes: [], trash: [], tags: [], tagFilter: null, search: '', selectedId: null, selectionCleared: false,
  status: 'loading', error: null, progress: null,
  async setSearch(search) { set(state => {
    const notes = visibleNotes(state.allNotes, search, state.tagFilter)
    return { search, notes, selectedId: selectVisible(notes, state.selectedId, state.selectionCleared) }
  }) },
  async setTagFilter(tagFilter) { set(state => {
    const notes = visibleNotes(state.allNotes, state.search, tagFilter)
    return { tagFilter, notes, selectedId: selectVisible(notes, state.selectedId, state.selectionCleared) }
  }) },
  resort() { set(state => ({ notes: visibleNotes(state.allNotes, state.search, state.tagFilter) })) },
  async refresh() {
    const sort = usePreferences.getState().sort
    const accountId = activeAccountId()
    try {
      const [allNotes, trash] = await Promise.all([listNotes('', sort), listTrash()])
      if (usePreferences.getState().sort !== sort || activeAccountId() !== accountId) return
      set(state => {
        const notes = visibleNotes(allNotes, state.search, state.tagFilter)
        const tags = [...new Set(allNotes.flatMap(note => note.tags))].sort()
        return { allNotes, notes, trash, tags, selectedId: selectVisible(notes, state.selectedId, state.selectionCleared),
        ...(state.status === 'storage-error' ? {
          status: (accountId ? 'offline' : 'local') as State['status'], error: null,
        } : {}) }
      })
    } catch (error) { set({ status: 'storage-error', error: String(error) }) }
  },
  select(selectedId) { set({ selectedId, selectionCleared: selectedId === null }) },
  async create(title) {
    const id = newIdentifier()
    try { await saveNote(id, title.trim().slice(0, 500) || 'Untitled', '') }
    catch (error) { set({ status: 'storage-error', error: String(error) }); return false }
    set({ search: '', tagFilter: null, selectedId: id, selectionCleared: false })
    await get().refresh()
    void get().sync()
    return get().status !== 'storage-error'
  },
  async save(id, title, body, tags) {
    let changed: boolean
    try { changed = await saveNote(id, title, body, false, undefined, tags) }
    catch (error) { set({ status: 'storage-error', error: String(error) }); throw error }
    if (!changed) return
    await get().refresh()
    clearTimeout(editSyncTimer)
    editSyncTimer = setTimeout(() => { void get().sync() }, 750)
  },
  async setPinned(id, pinned) {
    let changed: boolean
    try { changed = await setLocalPinned(id, pinned) }
    catch (error) { set({ status: 'storage-error', error: String(error) }); return false }
    if (!changed) return false
    await get().refresh()
    clearTimeout(editSyncTimer)
    editSyncTimer = setTimeout(() => { void get().sync() }, 750)
    return true
  },
  async remove(id) {
    const note = get().notes.find(item => item.id === id)
    if (!note) return false
    try { await saveNote(id, note.title, note.body, true, undefined, note.tags) }
    catch (error) { set({ status: 'storage-error', error: String(error) }); return false }
    set({ selectedId: null, selectionCleared: false })
    await get().refresh()
    void get().sync()
    return get().status !== 'storage-error'
  },
  async restore(id) {
    let changed: boolean
    try { changed = await restoreNote(id) }
    catch (error) { set({ status: 'storage-error', error: String(error) }); return false }
    if (!changed) return false
    await get().refresh()
    void get().sync()
    return true
  },
  async emptyTrash() {
    let result: { count: number; attachmentIds: string[] }
    try { result = await emptyLocalTrash() }
    catch (error) { set({ status: 'storage-error', error: String(error) }); throw error }
    await Promise.all(result.attachmentIds.map(removeCachedAttachment))
    await get().refresh()
    if (result.count) void get().sync()
    return result.count
  },
  async reset() {
    clearTimeout(editSyncTimer)
    await resetAllNotes()
    set({ notes: [], allNotes: [], trash: [], tags: [], selectedId: null, selectionCleared: false, search: '', tagFilter: null,
      status: activeAccountId() ? 'synced' : 'local', error: null, progress: null })
  },
  async sync() {
    if (get().status === 'storage-error') return
    if (!activeAccountId()) { set({ status: 'local', error: null }); return }
    if (useAccount.getState().status === 'signed-out') { set({ status: 'auth-required', error: null }); return }
    if (!navigator.onLine) { set({ status: 'offline' }); return }
    set({ status: 'syncing', error: null, progress: null })
    try {
      await syncNotes(async progress => { set({ progress }); await get().refresh() })
      await get().refresh()
      set({ status: 'synced', progress: null })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ status: message.includes('(401)') ? 'auth-required' : message.includes('too large to sync') ? 'sync-error' : 'offline',
        error: message.includes('(401)') ? null : message, progress: null })
    }
  },
}))

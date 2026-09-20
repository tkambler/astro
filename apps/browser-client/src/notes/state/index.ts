import { create } from 'zustand'
import type { LocalNote } from '../local'
import { activeAccountId, listNotes, listTags, saveNote } from '../local'
import { syncNotes, type SyncProgress } from '../sync'
import { usePreferences } from '../../preferences'
import { useAccount } from '../../account'

let editSyncTimer: ReturnType<typeof setTimeout> | undefined

type State = {
  notes: LocalNote[]; tags: string[]; tagFilter: string | null; search: string; selectedId: string | null;
  status: 'loading' | 'local' | 'offline' | 'auth-required' | 'syncing' | 'synced' | 'sync-error' | 'storage-error'; error: string | null;
  progress: SyncProgress | null;
  setSearch(search: string): Promise<void>; setTagFilter(tag: string | null): Promise<void>; refresh(): Promise<void>;
  select(id: string | null): void; create(title: string): Promise<void>;
  save(id: string, title: string, body: string, tags: string[]): Promise<void>;
  remove(id: string): Promise<void>; sync(): Promise<void>;
}

export const useNotes = create<State>((set, get) => ({
  notes: [], tags: [], tagFilter: null, search: '', selectedId: null, status: 'loading', error: null, progress: null,
  async setSearch(search) { set({ search }); await get().refresh() },
  async setTagFilter(tagFilter) { set({ tagFilter }); await get().refresh() },
  async refresh() {
    const search = get().search
    const tagFilter = get().tagFilter
    const sort = usePreferences.getState().sort
    const accountId = activeAccountId()
    try {
      const [notes, tags] = await Promise.all([listNotes(search, sort, tagFilter), listTags()])
      if (get().search !== search || get().tagFilter !== tagFilter || usePreferences.getState().sort !== sort || activeAccountId() !== accountId) return
      set(state => ({ notes, tags, selectedId: notes.some(note => note.id === state.selectedId)
        ? state.selectedId : notes[0]?.id ?? null,
        ...(state.status === 'storage-error' ? {
          status: (accountId ? 'offline' : 'local') as State['status'], error: null,
        } : {}) }))
    } catch (error) { set({ status: 'storage-error', error: String(error) }) }
  },
  select(selectedId) { set({ selectedId }) },
  async create(title) {
    const id = crypto.randomUUID()
    try { await saveNote(id, title.trim().slice(0, 500) || 'Untitled', '') }
    catch (error) { set({ status: 'storage-error', error: String(error) }); return }
    set({ search: '', tagFilter: null, selectedId: id })
    await get().refresh()
    void get().sync()
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
  async remove(id) {
    const note = get().notes.find(item => item.id === id)
    if (!note) return
    try { await saveNote(id, note.title, note.body, true, undefined, note.tags) }
    catch (error) { set({ status: 'storage-error', error: String(error) }); return }
    set({ selectedId: null })
    await get().refresh()
    void get().sync()
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

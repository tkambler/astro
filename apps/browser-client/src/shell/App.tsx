import { Component, createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { MDXEditor, type MDXEditorMethods, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect,
  ListsToggle, CreateLink, InsertCodeBlock, toolbarPlugin, headingsPlugin,
  listsPlugin, linkPlugin, codeBlockPlugin, codeMirrorPlugin, quotePlugin, frontmatterPlugin, tablePlugin } from '@mdxeditor/editor'
import { useNotes } from '../notes/state'
import { onNotesChanged, type LocalNote } from '../notes/local'
import { applyPreferences, usePreferences } from '../preferences'
import { Settings } from './Settings'
import { AccountPanel } from './Account'
import { SwipeableNoteRow } from './SwipeableNoteRow'
import { CommandPalette, type CommandAction } from './CommandPalette'
import { TagManager } from './TagManager'
import { useAccount } from '../account'
import { hasInvalidFrontmatter, notePreview } from '../notes/content'
import { watchRemoteChanges } from '../notes/sync'

const plugins = [headingsPlugin(), listsPlugin(), linkPlugin(), codeBlockPlugin(), codeMirrorPlugin({ codeBlockLanguages: { bash: 'Bash', sh: 'Shell', text: 'Plain text' } }), quotePlugin(), frontmatterPlugin(), tablePlugin(),
  toolbarPlugin({ toolbarContents: () => <><EditorToolbarHeading /><div className="editor-format-controls"><UndoRedo /><BlockTypeSelect /><BoldItalicUnderlineToggles /><ListsToggle /><CreateLink /><InsertCodeBlock /></div><EditorToolbarActions /></> })]

const EditorActionsContext = createContext<{
  mode: 'rich' | 'source'; invalidFrontmatter: boolean; heading: ReactNode;
  showRich: () => void; showSource: () => void; deleteNote: () => void
} | null>(null)

function EditorToolbarHeading() {
  return useContext(EditorActionsContext)?.heading ?? null
}

function EditorToolbarActions() {
  const actions = useContext(EditorActionsContext)
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])
  if (!actions) return null
  return <div className="editor-actions">
    <button type="button" className="editor-mode-button" disabled={actions.mode === 'source' && actions.invalidFrontmatter}
      aria-label={actions.mode === 'rich' ? 'Switch to Markdown Source' : 'Switch to Rich Text'}
      title={actions.mode === 'rich' ? 'Switch to Markdown Source' : 'Switch to Rich Text'}
      onClick={actions.mode === 'rich' ? actions.showSource : actions.showRich}>
      {actions.mode === 'rich'
        ? <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m7 5-5 5 5 5m6-10 5 5-5 5M12 3 8 17" /></svg>
        : <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h12M4 10h12M4 15h8" /></svg>}
    </button>
    <details ref={menu} className="editor-more" onKeyDown={event => { if (event.key === 'Escape') menu.current!.open = false }}><summary aria-label="More Note Actions" title="More Note Actions">⋯</summary><div className="editor-more-menu"><button type="button" onClick={actions.deleteNote}>Delete</button></div></details>
  </div>
}

class RichEditorBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch() { this.props.onError() }

  render() { return this.state.failed ? null : this.props.children }
}

export function App() {
  const { notes, allNotes, trash, tags, tagFilter, search, selectedId, status, error, progress, setSearch, setTagFilter,
    refresh, resort, select, create, save, setPinned, remove, restore, emptyTrash, reset, sync } = useNotes()
  const preferences = usePreferences()
  const account = useAccount(state => state.account)
  const accountStatus = useAccount(state => state.status)
  const [settings, setSettings] = useState(false)
  const [accountPanel, setAccountPanel] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(false)
  const [mobileLayout, setMobileLayout] = useState(() => matchMedia('(max-width: 700px)').matches)
  const [initialLoad, setInitialLoad] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [tagMenu, setTagMenu] = useState(false)
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null)
  const [noteMenu, setNoteMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const focusShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const sortMenu = useRef<HTMLDetailsElement>(null)
  const noteMenuRef = useRef<HTMLDivElement>(null)
  const loadAttempt = useRef(0)
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selected = notes.find(note => note.id === selectedId) ?? null
  const createAndOpen = async (title: string) => {
    if (await create(title)) setMobileEditor(true)
  }
  const loadNotes = () => {
    const attempt = ++loadAttempt.current
    if (loadTimer.current) clearTimeout(loadTimer.current)
    setInitialLoad('loading')
    loadTimer.current = setTimeout(() => {
      if (loadAttempt.current === attempt) setInitialLoad('unavailable')
    }, 10_000)
    void (async () => {
      let locallyReady = false
      try {
        await refresh()
        if (useNotes.getState().status === 'storage-error') {
          if (loadAttempt.current === attempt) setInitialLoad('unavailable')
          return
        }
        locallyReady = true
        if (loadAttempt.current === attempt) {
          setInitialLoad('ready')
          if (loadTimer.current) {
            clearTimeout(loadTimer.current)
            loadTimer.current = null
          }
        }
        await useAccount.getState().check()
        await refresh()
        await sync()
      } catch {
        if (!locallyReady && loadAttempt.current === attempt) setInitialLoad('unavailable')
      } finally {
        if (loadAttempt.current === attempt && loadTimer.current) {
          clearTimeout(loadTimer.current)
          loadTimer.current = null
        }
      }
    })()
  }
  useEffect(() => {
    loadNotes()
    const online = () => { void useAccount.getState().check().then(async () => { await refresh(); await sync() }) }
    const accountChanged = (event: StorageEvent) => {
      if (event.key === 'astronote-account-id') void useAccount.getState().check().then(async () => { await refresh(); await sync() })
    }
    const unsubscribe = onNotesChanged(() => { void refresh() })
    window.addEventListener('online', online)
    window.addEventListener('storage', accountChanged)
    return () => { ++loadAttempt.current; if (loadTimer.current) clearTimeout(loadTimer.current); unsubscribe(); window.removeEventListener('online', online); window.removeEventListener('storage', accountChanged) }
  }, [])
  useEffect(() => {
    if (!account || status === 'auth-required') return
    return watchRemoteChanges(() => { void useNotes.getState().sync() }, () => {
      void useAccount.getState().check().then(() => useNotes.getState().sync())
    })
  }, [account?.id, status === 'auth-required'])
  useEffect(() => {
    const apply = () => applyPreferences(preferences)
    apply()
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preferences])
  useEffect(() => {
    const media = matchMedia('(max-width: 700px)')
    const update = () => setMobileLayout(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => { resort() }, [preferences.sort, preferences.sortDirection])
  const setSort = (sort: 'title' | 'modified', sortDirection: 'asc' | 'desc') => {
    usePreferences.getState().update({ sort, sortDirection })
    if (sortMenu.current) sortMenu.current.open = false
  }
  useEffect(() => {
    const closeSortMenu = (event: PointerEvent) => {
      if (sortMenu.current && !sortMenu.current.contains(event.target as Node)) sortMenu.current.open = false
    }
    document.addEventListener('pointerdown', closeSortMenu)
    return () => document.removeEventListener('pointerdown', closeSortMenu)
  }, [])
  useEffect(() => {
    if (!tagMenu) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTagMenu(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [tagMenu])
  useEffect(() => {
    if (!noteMenu) return
    noteMenuRef.current?.querySelector('button')?.focus()
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!noteMenuRef.current?.contains(event.target as Node)) setNoteMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setNoteMenu(null) }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [noteMenu])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault(); setPaletteOpen(true); return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault(); setSettings(false); void createAndOpen('')
      }
      if (event.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false)
        else if (accountPanel) setAccountPanel(false)
        else if (settings) setSettings(false)
        else if (document.activeElement === input.current) { void setSearch(''); input.current?.blur() }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSearch, create, settings, accountPanel, paletteOpen])
  const moveSelection = (direction: number) => {
    if (!notes.length) return
    const index = notes.findIndex(note => note.id === selectedId)
    select(notes[Math.min(notes.length - 1, Math.max(0, index + direction))]!.id)
  }
  const openSelection = () => {
    const title = search.trim()
    if (title) {
      const match = allNotes.find(note => note.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase())
      if (match) {
        if (tagFilter) void setTagFilter(null)
        select(match.id)
        setMobileEditor(true)
        input.current?.blur()
      } else void createAndOpen(title)
    } else if (selected) { setMobileEditor(true); input.current?.blur() }
  }
  const mobileDetail = mobileEditor || settings || accountPanel
  const signedIn = !!account && status !== 'auth-required'
  const connected = !!account && accountStatus === 'signed-in'
  const commands: CommandAction[] = [
    ...(selected && (!mobileLayout || mobileEditor) ? [{ id: 'pin', label: selected.pinned ? 'Unpin Note' : 'Pin Note', description: selected.title || 'Untitled',
      run: () => { void setPinned(selected.id, !selected.pinned) } },
    ...(mobileLayout ? [{ id: 'tags', label: 'Manage Tags', description: selected.tags.length ? selected.tags.map(tag => `#${tag}`).join(' ') : 'No tags',
      run: () => setTagManagerOpen(true) }] : []),
    { id: 'delete', label: 'Delete Note', description: selected.title || 'Untitled',
      run: () => { if (confirm('Delete this note?')) void remove(selected.id).then(deleted => { if (deleted) setMobileEditor(false) }) } }] : []),
    { id: 'new', label: 'Create Note', run: () => { void createAndOpen('') } },
    { id: 'search', label: 'Focus Search', run: () => { setSettings(false); setAccountPanel(false); input.current?.focus() } },
    { id: 'settings', label: 'Open Settings', run: () => { setSettings(true); setAccountPanel(false) } },
    { id: 'account', label: signedIn ? 'Open Account' : 'Sign In', run: () => { setAccountPanel(true); setSettings(false) } },
  ]
  return <div className={`app ${mobileDetail ? 'mobile-detail' : 'mobile-list'}`}>
    <div className="mobile-list-heading">
      <button className="mobile-list-scroll" aria-label="Scroll notes to top"
        onClick={() => results.current?.scrollTo({ top: 0, behavior: 'smooth' })}><span>NOTES</span><span>{initialLoad === 'loading' ? '' : notes.length}</span></button>
      <button className={`mobile-connection ${connected ? 'connected' : ''}`}
        aria-label={connected ? 'Account Connected' : 'Account Disconnected'}
        title={connected ? 'Account Connected' : 'Account Disconnected'}
        onClick={() => { setAccountPanel(true); setSettings(false) }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h4M6 8v8h6V8H6M12 10h2M12 14h2" />
          {connected ? <path d="M14 10h2m-2 4h2M16 8v8h5V8h-5M21 12h1" />
            : <path d="M18 8v8h4V8h-4" />}
        </svg>
      </button>
      <button className="mobile-header-palette palette-trigger" aria-label="Open Command Palette"
        title="Command Palette" aria-pressed={paletteOpen} onClick={() => setPaletteOpen(value => !value)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M4 10h16M4 15h10M4 20h10" /><path d="m17 17 3 3m0-3-3 3" /></svg>
      </button>
    </div>
    <header className="omnibar">
      <span className="prompt" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 4 6 6-6 6" /></svg></span>
      <input ref={input} aria-label="Search or create a note" placeholder="Search or create a note…" value={search}
        onChange={event => { void setSearch(event.target.value) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1) }
          if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1) }
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); openSelection() }
        }} />
      <kbd className="omnibar-shortcut">{focusShortcut}</kbd>
      {search && <button className="chip" onClick={() => void setSearch('')}>ESC to clear</button>}
      {tagFilter && <button className="chip" onClick={() => void setTagFilter(null)}>#{tagFilter} ×</button>}
      {search && <button className="mobile-clear" aria-label="Clear search" onClick={() => void setSearch('')}>×</button>}
      <button className="icon-button palette-trigger" aria-label="Open Command Palette" title={`Command Palette (${focusShortcut.startsWith('⌘') ? '⌘⇧O' : 'Ctrl Shift O'})`} aria-pressed={paletteOpen}
        onClick={() => setPaletteOpen(value => !value)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M4 10h16M4 15h10M4 20h10" /><path d="m17 17 3 3m0-3-3 3" /></svg></button>
    </header>
    <div className="workspace">
      <aside className={`sidebar ${mobileEditor || settings || accountPanel ? 'mobile-hidden' : ''}`}>
        <div className="sidebar-heading">
          <details ref={sortMenu} className="sort-menu" onKeyDown={event => { if (event.key === 'Escape') sortMenu.current!.open = false }}>
            <summary>Order By: {preferences.sort === 'title' ? 'Title' : 'Modified'} {preferences.sortDirection === 'asc' ? 'Asc' : 'Desc'}<svg aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m3 4.5 3 3 3-3" /></svg></summary>
            <div className="sort-options" role="group" aria-label="Sort notes">
              <button type="button" aria-pressed={preferences.sort === 'title' && preferences.sortDirection === 'asc'} onClick={() => setSort('title', 'asc')}>Title · Asc</button>
              <button type="button" aria-pressed={preferences.sort === 'title' && preferences.sortDirection === 'desc'} onClick={() => setSort('title', 'desc')}>Title · Desc</button>
              <button type="button" aria-pressed={preferences.sort === 'modified' && preferences.sortDirection === 'asc'} onClick={() => setSort('modified', 'asc')}>Modified · Asc</button>
              <button type="button" aria-pressed={preferences.sort === 'modified' && preferences.sortDirection === 'desc'} onClick={() => setSort('modified', 'desc')}>Modified · Desc</button>
            </div>
          </details>
          {mobileLayout && <>
            <button className="mobile-tags" aria-expanded={tagMenu} aria-label="Filter by tag"
              onClick={() => setTagMenu(value => !value)}>{tagFilter ? `#${tagFilter}` : 'TAGS'}</button>
            {tagMenu && <>
              <button type="button" className="tag-filter-dismiss" tabIndex={-1} aria-label="Close tag filter"
                onClick={() => setTagMenu(false)} />
              <div className="tag-filter-menu" role="group" aria-label="Filter notes by tag">
                <button aria-pressed={!tagFilter} onClick={() => { void setTagFilter(null); setTagMenu(false) }}>All Tags</button>
                {tags.map(tag => <button key={tag} aria-pressed={tagFilter === tag} onClick={() => { void setTagFilter(tag); setTagMenu(false) }}>#{tag}</button>)}
                {!tags.length && <span>No Tags Yet</span>}
              </div>
            </>}
          </>}
        </div>
        <div className="results" ref={results} aria-busy={initialLoad === 'loading'} onScroll={() => setNoteMenu(null)}>
          {notes.map(note => <SwipeableNoteRow key={note.id} mobile={mobileLayout} open={openSwipeId === note.id}
            onOpenChange={open => setOpenSwipeId(open ? note.id : null)}
            deleteLabel={`Delete ${note.title || 'Untitled'}`}
            onDelete={() => { setOpenSwipeId(null); void remove(note.id) }}>
            <button className={`result ${selectedId === note.id ? 'selected' : ''}`}
            onContextMenu={event => {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              const x = event.clientX || rect.left + 16
              const y = event.clientY || rect.top + 16
              setNoteMenu({ id: note.id, x: Math.max(8, Math.min(x, window.innerWidth - 168)),
                y: Math.max(8, Math.min(y, window.innerHeight - 56)) })
              setOpenSwipeId(null)
            }}
            onClick={event => {
              setOpenSwipeId(null)
              if (event.metaKey && selectedId === note.id) { select(null); setMobileEditor(false) }
              else { select(note.id); setMobileEditor(true) }
              setSettings(false)
            }}>
            <span className="result-line"><strong>{note.title || 'Untitled'}</strong>{note.pinned && <svg className="result-pin" role="img" aria-label="Pinned" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5-3 1-4 4v4l-2 2-3-5-5-3 2-2h4l4-4zM9 15l-6 6" /></svg>}{account && status !== 'auth-required' && note.dirty && <svg className="result-sync" role="img" aria-label="Sync pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18a5 5 0 0 1-.5-9.97A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 8.5" /><path d="M12 20V12m-3 3 3-3 3 3" /></svg>}</span>
            <span className="result-meta"><small>{new Date(note.updatedAt).toLocaleDateString()}</small>{preferences.showTags && !!note.tags.length && <span className="result-tags">{note.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}</span>
            {preferences.showPreviews && <span className="preview">{notePreview(note.body)}</span>}
            </button>
          </SwipeableNoteRow>)}
          {!notes.length && (initialLoad === 'loading'
            ? null
            : initialLoad === 'unavailable'
              ? <div className="empty-results" role="alert">Could not finish loading notes. <button className="loading-retry" onClick={() => window.location.reload()}>Retry</button></div>
              : <div className="empty-results">{search || tagFilter ? 'No matches yet.' : 'No notes yet. Type a title above to create one.'}</div>)}
        </div>
        <button className="create-row" onClick={() => void createAndOpen(search)}>＋ Create Note {search && `“${search}”`}</button>
      </aside>
      <main className={`main-pane ${!mobileEditor && !settings && !accountPanel ? 'mobile-hidden' : ''}`}>
        {accountPanel ? <AccountPanel onClose={() => setAccountPanel(false)} onAccountChanged={async () => { await refresh(); await sync() }} />
          : settings ? <Settings mobileLayout={mobileLayout} onClose={() => setSettings(false)} onNotesImported={async () => { await refresh(); void sync() }}
              onNotesReset={reset} trash={trash} onRestore={restore} onEmptyTrash={emptyTrash} />
          : selected && (!mobileLayout || mobileEditor) ? <NoteEditor key={selected.id} note={selected} mobileLayout={mobileLayout} onSave={save} onDelete={async id => { if (await remove(id)) setMobileEditor(false) }} onBack={() => setMobileEditor(false)} onOpenCommandPalette={() => setPaletteOpen(true)} />
          : <div className="empty-pane">Search or create a note to begin.</div>}
      </main>
    </div>
    {paletteOpen && <CommandPalette actions={commands} onClose={() => setPaletteOpen(false)} />}
    {tagManagerOpen && selected && <TagManager noteTitle={selected.title} initialTags={selected.tags}
      onClose={() => setTagManagerOpen(false)}
      onSave={async nextTags => { await save(selected.id, selected.title, selected.body, nextTags); setTagManagerOpen(false) }} />}
    {noteMenu && <div ref={noteMenuRef} className="sidebar-note-menu" role="menu" aria-label="Note Actions"
      style={{ left: noteMenu.x, top: noteMenu.y }}>
      <button type="button" role="menuitem" onClick={() => { const id = noteMenu.id; setNoteMenu(null); void remove(id) }}>Delete</button>
    </div>}
    <footer className="statusbar">
      <button className={`statusbar-account ${signedIn ? 'signed-in' : ''}`} title={signedIn ? account.email : 'Sign In'} onClick={() => { setAccountPanel(true); setSettings(false) }}>{signedIn ? account.email : 'Sign In'}</button>
      <div className="statusbar-right">
        {selected && !settings && !accountPanel && <span>{selected.dirty ? 'saved locally' : 'saved'}</span>}
        <span className="statusbar-state">{status === 'storage-error' ? '⚠ device save failed' : status === 'sync-error' ? '⚠ sync needs attention' : status === 'auth-required' ? '● sign in to sync' : status === 'local' ? '● local notes · connect an account to sync' : status === 'synced' ? '✓ synced' : status === 'syncing' ? `↻ syncing${progress ? ` ${progress.completed}/${progress.total}` : ''}` : status === 'loading' ? 'loading…' : '● offline · saved on this device'}{error && ` · ${error}`}</span>
        {signedIn && <button onClick={() => void sync()}>Sync Now</button>}
      </div>
    </footer>
    {(status === 'sync-error' || status === 'storage-error') && error && <div className="mobile-sync-error" role="alert">{error}</div>}
  </div>
}

function NoteEditor({ note, mobileLayout, onSave, onDelete, onBack, onOpenCommandPalette }: { note: LocalNote; mobileLayout: boolean;
  onSave: (id: string, title: string, body: string, tags: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onBack: () => void; onOpenCommandPalette: () => void }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const editorMode = usePreferences(state => state.editorMode)
  const spellcheck = usePreferences(state => state.spellcheck)
  const [mode, setMode] = useState<'rich' | 'source'>(editorMode)
  const [richFailed, setRichFailed] = useState(false)
  const invalidFrontmatter = hasInvalidFrontmatter(body)
  const displayMode = invalidFrontmatter || richFailed ? 'source' : mobileLayout ? 'rich' : mode
  const [saveError, setSaveError] = useState<string | null>(null)
  const editor = useRef<MDXEditorMethods>(null)
  const linkTouch = useRef<{ link: HTMLAnchorElement; x: number; y: number } | null>(null)
  const editorInteracted = useRef(false)
  const content = useRef({ title: note.title, body: note.body, tags: note.tags })
  useEffect(() => {
    if (note.tags.join('\0') !== content.current.tags.join('\0')) {
      content.current = { ...content.current, tags: note.tags }
    }
    if (note.dirty) return
    if (note.title !== content.current.title) setTitle(note.title)
    if (note.body !== content.current.body) {
      editorInteracted.current = false
      setBody(note.body)
      editor.current?.setMarkdown(note.body)
    }
    content.current = { title: note.title, body: note.body, tags: note.tags }
  }, [note.revision, note.updatedAt, note.dirty, note.tags])
  const save = (nextTitle: string, nextBody: string, nextTags = content.current.tags) => {
    content.current = { title: nextTitle, body: nextBody, tags: nextTags }
    void onSave(note.id, nextTitle, nextBody, nextTags).then(() => setSaveError(null))
      .catch(error => setSaveError(error instanceof Error ? error.message : String(error)))
  }
  const noteTitle = () => <input aria-label="Note title" maxLength={500} value={title} onChange={event => { setTitle(event.target.value); save(event.target.value, content.current.body) }} />
  const toolbarActions = {
    mode: displayMode, invalidFrontmatter, heading: <div className="editor-ribbon-heading">{noteTitle()}</div>,
    showRich: () => { setRichFailed(false); setMode('rich') },
    showSource: () => setMode('source'),
    deleteNote: () => { if (confirm('Delete this note?')) void onDelete(note.id) },
  }
  const markEditorInteraction = (target: EventTarget) => {
    if (!(target instanceof Element && target.closest('.editor-ribbon-heading'))) editorInteracted.current = true
  }
  return <>
    <div className="editor-heading"><button className="mobile-back" onClick={onBack}>‹ Notes</button><div className="mobile-title-field">{noteTitle()}</div>
      <button className="mobile-editor-palette palette-trigger" onClick={onOpenCommandPalette} aria-label="Open Command Palette">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M4 10h16M4 15h10M4 20h10" /><path d="m17 17 3 3m0-3-3 3" /></svg>
      </button></div>
    {saveError && <div className="save-error" role="alert">Could not save on this device: {saveError}</div>}
    {invalidFrontmatter && <div className="editor-warning" role="status">Invalid YAML frontmatter. Edit it in source mode to restore the rich editor.</div>}
    {displayMode === 'source' && <EditorActionsContext.Provider value={toolbarActions}><div className="editor-source-toolbar"><EditorToolbarHeading /><EditorToolbarActions /></div></EditorActionsContext.Provider>}
    <div className={`editor-body ${displayMode === 'source' ? 'source-editor' : ''}`}
      onPointerDownCapture={event => markEditorInteraction(event.target)}
      onKeyDownCapture={event => markEditorInteraction(event.target)}
      onBeforeInputCapture={event => markEditorInteraction(event.target)}
      onPasteCapture={event => markEditorInteraction(event.target)}
      onTouchCancelCapture={() => { linkTouch.current = null }} onTouchStartCapture={event => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      const touch = event.touches[0]
      linkTouch.current = link instanceof HTMLAnchorElement && touch ? { link, x: touch.clientX, y: touch.clientY } : null
    }} onTouchEndCapture={event => {
      const start = linkTouch.current
      linkTouch.current = null
      const touch = event.changedTouches[0]
      if (!start || !touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (link !== start.link) return
      let href: URL
      try { href = new URL(start.link.getAttribute('href')!, window.location.href) }
      catch { return }
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(href.protocol)) return
      event.preventDefault()
      event.stopPropagation()
      window.open(href.href, '_blank', 'noopener,noreferrer')
    }}>
      {displayMode === 'source' ? <textarea aria-label="Markdown source" spellCheck={spellcheck} value={body} onChange={event => { setBody(event.target.value); save(content.current.title, event.target.value) }} />
        : <EditorActionsContext.Provider value={toolbarActions}><RichEditorBoundary onError={() => { setRichFailed(true); setMode('source') }}><MDXEditor ref={editor} key={`${note.id}-${displayMode}`} markdown={body} plugins={plugins} spellCheck={spellcheck}
            onError={() => { setRichFailed(true); setMode('source') }}
            onChange={(value, initialMarkdownNormalize) => { if (editorInteracted.current && !initialMarkdownNormalize && value !== content.current.body) { setBody(value); save(content.current.title, value) } }} /></RichEditorBoundary></EditorActionsContext.Provider>}
    </div>
  </>
}

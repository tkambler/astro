import { Component, createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { MDXEditor, type MDXEditorMethods, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect,
  ListsToggle, CreateLink, InsertCodeBlock, toolbarPlugin, headingsPlugin,
  listsPlugin, linkPlugin, codeBlockPlugin, codeMirrorPlugin, quotePlugin, frontmatterPlugin, tablePlugin } from '@mdxeditor/editor'
import { useNotes } from '../notes/state'
import { onNotesChanged, type LocalNote } from '../notes/local'
import { applyPreferences, usePreferences } from '../preferences'
import { Settings } from './Settings'
import { AccountPanel } from './Account'
import { useAccount } from '../account'
import { hasInvalidFrontmatter, notePreview } from '../notes/content'
import { watchRemoteChanges } from '../notes/sync'

const plugins = [headingsPlugin(), listsPlugin(), linkPlugin(), codeBlockPlugin(), codeMirrorPlugin({ codeBlockLanguages: { bash: 'Bash', sh: 'Shell', text: 'Plain text' } }), quotePlugin(), frontmatterPlugin(), tablePlugin(),
  toolbarPlugin({ toolbarContents: () => <><UndoRedo /><BlockTypeSelect /><BoldItalicUnderlineToggles /><ListsToggle /><CreateLink /><InsertCodeBlock /><EditorToolbarActions /></> })]

const EditorActionsContext = createContext<{
  mode: 'rich' | 'source'; invalidFrontmatter: boolean; showRich: () => void; showSource: () => void; deleteNote: () => void
} | null>(null)

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
    <div className="editor-toggle"><button type="button" className={actions.mode === 'rich' ? 'active' : ''} disabled={actions.invalidFrontmatter} onClick={actions.showRich}>RICH</button><button type="button" className={actions.mode === 'source' ? 'active' : ''} onClick={actions.showSource}>SOURCE</button></div>
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
  const { notes, tags, tagFilter, search, selectedId, status, error, progress, setSearch, setTagFilter,
    refresh, resort, select, create, save, remove, reset, sync } = useNotes()
  const preferences = usePreferences()
  const account = useAccount(state => state.account)
  const [settings, setSettings] = useState(false)
  const [accountPanel, setAccountPanel] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(false)
  const [mobileLayout, setMobileLayout] = useState(() => matchMedia('(max-width: 700px)').matches)
  const [initialLoad, setInitialLoad] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [tagMenu, setTagMenu] = useState(false)
  const focusShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const sortMenu = useRef<HTMLDetailsElement>(null)
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
      try {
        await refresh()
        await useAccount.getState().check()
        await refresh()
        await sync()
        if (loadAttempt.current === attempt) setInitialLoad('ready')
      } catch {
        if (loadAttempt.current === attempt) setInitialLoad('unavailable')
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
    const timer = window.setInterval(() => { if (navigator.onLine) void sync() }, 30_000)
    return () => { ++loadAttempt.current; if (loadTimer.current) clearTimeout(loadTimer.current); unsubscribe(); window.removeEventListener('online', online); window.removeEventListener('storage', accountChanged); window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (!account || status === 'auth-required') return
    return watchRemoteChanges(() => { void useNotes.getState().sync() })
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
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault(); setSettings(false); void createAndOpen('')
      }
      if (event.key === 'Escape') {
        if (accountPanel) setAccountPanel(false)
        else if (settings) setSettings(false)
        else if (document.activeElement === input.current) { void setSearch(''); input.current?.blur() }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSearch, create, settings, accountPanel])
  const moveSelection = (direction: number) => {
    if (!notes.length) return
    const index = notes.findIndex(note => note.id === selectedId)
    select(notes[Math.min(notes.length - 1, Math.max(0, index + direction))]!.id)
  }
  const openSelection = () => {
    if (selected) { setMobileEditor(true); input.current?.blur() }
    else if (search.trim()) void createAndOpen(search)
  }
  const mobileDetail = mobileEditor || settings || accountPanel
  return <div className={`app ${mobileDetail ? 'mobile-detail' : 'mobile-list'}`}>
    <button className="mobile-list-heading" aria-label="Scroll notes to top" onClick={() => results.current?.scrollTo({ top: 0, behavior: 'smooth' })}><span>NOTES</span><span>{notes.length}</span></button>
    <header className="omnibar">
      <span className="prompt" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 4 6 6-6 6" /></svg></span>
      <input ref={input} aria-label="Search or create a note" placeholder="Search or create a note…" value={search}
        onChange={event => { void setSearch(event.target.value) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1) }
          if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1) }
          if (event.key === 'Enter') { event.preventDefault(); openSelection() }
        }} />
      <kbd className="omnibar-shortcut">{focusShortcut}</kbd>
      {search && <button className="chip" onClick={() => void setSearch('')}>ESC to clear</button>}
      {tagFilter && <button className="chip" onClick={() => void setTagFilter(null)}>#{tagFilter} ×</button>}
      {search && <button className="mobile-clear" aria-label="Clear search" onClick={() => void setSearch('')}>×</button>}
      <button className="account-button" onClick={() => { setAccountPanel(value => !value); setSettings(false) }}>{account ? account.email : 'Account'}</button>
      <button className="icon-button" aria-label="Settings" aria-pressed={settings} onClick={() => { setSettings(value => !value); setAccountPanel(false) }}>⚙</button>
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
        </div>
        <div className="results" ref={results}>
          {notes.map(note => <button key={note.id} className={`result ${selectedId === note.id ? 'selected' : ''}`}
            onClick={event => {
              if (event.metaKey && selectedId === note.id) { select(null); setMobileEditor(false) }
              else { select(note.id); setMobileEditor(true) }
              setSettings(false)
            }}>
            <span className="result-line"><strong>{note.title || 'Untitled'}</strong>{account && status !== 'auth-required' && note.dirty && <svg className="result-sync" role="img" aria-label="Sync pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18a5 5 0 0 1-.5-9.97A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 8.5" /><path d="M12 20V12m-3 3 3-3 3 3" /></svg>}</span>
            <span className="result-meta"><small>{new Date(note.updatedAt).toLocaleDateString()}</small>{preferences.showTags && !!note.tags.length && <span className="result-tags">{note.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}</span>
            {preferences.showPreviews && <span className="preview">{notePreview(note.body)}</span>}
          </button>)}
          {!notes.length && (initialLoad === 'loading'
            ? <div className="empty-results loading-results" role="status"><span className="loading-spinner" aria-hidden="true" />Loading notes…</div>
            : initialLoad === 'unavailable'
              ? <div className="empty-results" role="alert">Could not finish loading notes. <button className="loading-retry" onClick={() => window.location.reload()}>Retry</button></div>
              : <div className="empty-results">{search || tagFilter ? 'No matches yet.' : 'No notes yet. Type a title above to create one.'}</div>)}
        </div>
        <button className="create-row" onClick={() => void createAndOpen(search)}>＋ Create Note {search && `“${search}”`}</button>
        <div className="sidebar-footer"><span>{preferences.showPreviews ? 'previews on' : 'previews off'} &nbsp; · &nbsp; ⌘K omnibar</span><span>{notes.length} notes</span></div>
      </aside>
      <main className={`main-pane ${!mobileEditor && !settings && !accountPanel ? 'mobile-hidden' : ''}`}>
        {accountPanel ? <AccountPanel onClose={() => setAccountPanel(false)} onAccountChanged={async () => { await refresh(); await sync() }} />
          : settings ? <Settings mobileLayout={mobileLayout} onClose={() => setSettings(false)} onNotesImported={async () => { await refresh(); void sync() }}
              onNotesReset={reset} />
          : selected && (!mobileLayout || mobileEditor) ? <NoteEditor key={selected.id} note={selected} mobileLayout={mobileLayout} onSave={save} onDelete={async id => { if (await remove(id)) setMobileEditor(false) }} onBack={() => setMobileEditor(false)} />
          : <div className="empty-pane">Search or create a note to begin.</div>}
      </main>
    </div>
    <footer className="statusbar"><span>{status === 'storage-error' ? '⚠ device save failed' : status === 'sync-error' ? '⚠ sync needs attention' : status === 'auth-required' ? '● sign in to sync' : status === 'local' ? '● local notes · connect an account to sync' : status === 'synced' ? '✓ synced' : status === 'syncing' ? `↻ syncing${progress ? ` ${progress.completed}/${progress.total}` : ''}` : status === 'loading' ? 'loading…' : '● offline · saved on this device'}{error && ` · ${error}`}</span><div className="statusbar-right">{selected && !settings && !accountPanel && <span>{selected.dirty ? 'saved locally' : 'saved'}</span>}<button onClick={() => { if (status === 'auth-required' || status === 'local') setAccountPanel(true); else void sync() }}>{status === 'auth-required' || status === 'local' ? 'Connect Account' : 'Sync Now'}</button></div></footer>
    {(status === 'sync-error' || status === 'storage-error') && error && <div className="mobile-sync-error" role="alert">{error}</div>}
    {!mobileDetail && <div className="mobile-list-actions">
      {tagMenu && <div className="tag-filter-menu" role="group" aria-label="Filter notes by tag">
        <button aria-pressed={!tagFilter} onClick={() => { void setTagFilter(null); setTagMenu(false) }}>All Tags</button>
        {tags.map(tag => <button key={tag} aria-pressed={tagFilter === tag} onClick={() => { void setTagFilter(tag); setTagMenu(false) }}>#{tag}</button>)}
        {!tags.length && <span>No tags yet</span>}
      </div>}
      <button className="mobile-tags" aria-expanded={tagMenu} aria-label="Filter by tag" onClick={() => setTagMenu(value => !value)}>{tagFilter ? `#${tagFilter}` : 'TAGS'}</button>
      <button className="mobile-account" onClick={() => { setAccountPanel(true); setSettings(false) }} aria-label="Account">◉</button>
      <button className="mobile-settings" onClick={() => setSettings(true)} aria-label="Settings">⚙</button>
      <button className="mobile-new" onClick={() => void createAndOpen('')}>NEW ›</button>
    </div>}
  </div>
}

function NoteEditor({ note, mobileLayout, onSave, onDelete, onBack }: { note: LocalNote; mobileLayout: boolean;
  onSave: (id: string, title: string, body: string, tags: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onBack: () => void }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [tags, setTags] = useState(note.tags)
  const [tagInput, setTagInput] = useState('')
  const editorMode = usePreferences(state => state.editorMode)
  const spellcheck = usePreferences(state => state.spellcheck)
  const [mode, setMode] = useState<'rich' | 'source'>(editorMode)
  const [richFailed, setRichFailed] = useState(false)
  const invalidFrontmatter = hasInvalidFrontmatter(body)
  const displayMode = invalidFrontmatter || richFailed ? 'source' : mobileLayout ? 'rich' : mode
  const [moreMenu, setMoreMenu] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const editor = useRef<MDXEditorMethods>(null)
  const mobileMoreButton = useRef<HTMLButtonElement>(null)
  const mobileMorePopup = useRef<HTMLDivElement>(null)
  const linkTouch = useRef<{ link: HTMLAnchorElement; x: number; y: number } | null>(null)
  const content = useRef({ title: note.title, body: note.body, tags: note.tags })
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node
      if (!mobileMoreButton.current?.contains(target) && !mobileMorePopup.current?.contains(target)) setMoreMenu(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])
  useEffect(() => {
    if (note.dirty) return
    if (note.title !== content.current.title) setTitle(note.title)
    if (note.body !== content.current.body) {
      setBody(note.body)
      editor.current?.setMarkdown(note.body)
    }
    if (note.tags.join('\0') !== content.current.tags.join('\0')) setTags(note.tags)
    content.current = { title: note.title, body: note.body, tags: note.tags }
  }, [note.revision, note.updatedAt, note.dirty])
  const save = (nextTitle: string, nextBody: string, nextTags = content.current.tags) => {
    content.current = { title: nextTitle, body: nextBody, tags: nextTags }
    void onSave(note.id, nextTitle, nextBody, nextTags).then(() => setSaveError(null))
      .catch(error => setSaveError(error instanceof Error ? error.message : String(error)))
  }
  const addTag = () => {
    const tag = tagInput.trim().replace(/^#/, '').toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(tag) || tags.includes(tag) || tags.length >= 20) return
    const next = [...tags, tag]
    setTags(next); setTagInput(''); save(content.current.title, content.current.body, next)
  }
  const toolbarActions = {
    mode: displayMode, invalidFrontmatter,
    showRich: () => { setRichFailed(false); setMode('rich') },
    showSource: () => setMode('source'),
    deleteNote: () => { if (confirm('Delete this note?')) void onDelete(note.id) },
  }
  return <>
    <div className="editor-heading"><button className="mobile-back" onClick={onBack}>‹ results</button><input aria-label="Note title" maxLength={500} value={title} onChange={event => { setTitle(event.target.value); save(event.target.value, content.current.body) }} />
      <div className="note-tags">{tags.map(tag => <span key={tag}>{tag}<button aria-label={`Remove ${tag} tag`} onClick={() => { const next = tags.filter(item => item !== tag); setTags(next); save(content.current.title, content.current.body, next) }}>×</button></span>)}
        <input aria-label="Add tag" placeholder="+ tag" value={tagInput} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} onBlur={() => { if (tagInput.trim()) addTag() }} /></div>
      <button ref={mobileMoreButton} className="mobile-more" onClick={() => setMoreMenu(value => !value)} aria-label="More Note Actions" aria-expanded={moreMenu}>⋯</button>
      {moreMenu && <div ref={mobileMorePopup} className="mobile-more-menu" role="menu"><button role="menuitem" className="danger" onClick={() => { setMoreMenu(false); if (confirm('Delete this note?')) void onDelete(note.id) }}>Delete</button></div>}</div>
    {saveError && <div className="save-error" role="alert">Could not save on this device: {saveError}</div>}
    {invalidFrontmatter && <div className="editor-warning" role="status">Invalid YAML frontmatter. Edit it in source mode to restore the rich editor.</div>}
    {displayMode === 'source' && <EditorActionsContext.Provider value={toolbarActions}><div className="editor-source-toolbar"><EditorToolbarActions /></div></EditorActionsContext.Provider>}
    <div className={`editor-body ${displayMode === 'source' ? 'source-editor' : ''}`} onTouchCancelCapture={() => { linkTouch.current = null }} onTouchStartCapture={event => {
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
            onChange={(value, initialMarkdownNormalize) => { if (!initialMarkdownNormalize && value !== content.current.body) { setBody(value); save(content.current.title, value) } }} /></RichEditorBoundary></EditorActionsContext.Provider>}
    </div>
    <div className="mobile-editor-actions"><span>{note.dirty ? 'saved locally' : 'saved'}{richFailed ? ' · source fallback' : ''}</span><button className="done" onClick={onBack}>DONE</button></div>
  </>
}

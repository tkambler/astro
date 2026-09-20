import { useEffect, useRef, useState } from 'react'
import { MDXEditor, type MDXEditorMethods, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect,
  ListsToggle, CreateLink, InsertCodeBlock, toolbarPlugin, headingsPlugin,
  listsPlugin, linkPlugin, codeBlockPlugin, quotePlugin, frontmatterPlugin } from '@mdxeditor/editor'
import { useNotes } from '../notes/state'
import { onNotesChanged, type LocalNote } from '../notes/local'
import { applyPreferences, usePreferences } from '../preferences'
import { Settings } from './Settings'
import { AccountPanel } from './Account'
import { useAccount } from '../account'
import { compareNote } from '../notes/diff'
import { notePreview } from '../notes/content'
import { watchRemoteChanges } from '../notes/sync'

const plugins = [headingsPlugin(), listsPlugin(), linkPlugin(), codeBlockPlugin(), quotePlugin(), frontmatterPlugin(),
  toolbarPlugin({ toolbarContents: () => <><UndoRedo /><BlockTypeSelect /><BoldItalicUnderlineToggles /><ListsToggle /><CreateLink /><InsertCodeBlock /></> })]

export function App() {
  const { notes, tags, tagFilter, search, selectedId, status, error, progress, setSearch, setTagFilter,
    refresh, select, create, save, remove, reset, sync } = useNotes()
  const preferences = usePreferences()
  const account = useAccount(state => state.account)
  const [settings, setSettings] = useState(false)
  const [accountPanel, setAccountPanel] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(false)
  const [mobileLayout, setMobileLayout] = useState(() => matchMedia('(max-width: 700px)').matches)
  const [initialLoading, setInitialLoading] = useState(true)
  const [tagMenu, setTagMenu] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const selected = notes.find(note => note.id === selectedId) ?? null
  useEffect(() => {
    let mounted = true
    void (async () => {
      try { await refresh(); await useAccount.getState().check(); await refresh(); await sync() }
      finally { if (mounted) setInitialLoading(false) }
    })()
    const online = () => { void useAccount.getState().check().then(async () => { await refresh(); await sync() }) }
    const accountChanged = (event: StorageEvent) => {
      if (event.key === 'astronote-account-id') void useAccount.getState().check().then(async () => { await refresh(); await sync() })
    }
    const unsubscribe = onNotesChanged(() => { void refresh() })
    window.addEventListener('online', online)
    window.addEventListener('storage', accountChanged)
    const timer = window.setInterval(() => { if (navigator.onLine) void sync() }, 30_000)
    return () => { mounted = false; unsubscribe(); window.removeEventListener('online', online); window.removeEventListener('storage', accountChanged); window.clearInterval(timer) }
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
  useEffect(() => { void refresh() }, [preferences.sort])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault(); setSettings(false); void create(''); setMobileEditor(true)
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
    else if (search.trim()) { void create(search); setMobileEditor(true) }
  }
  const mobileDetail = mobileEditor || settings || accountPanel
  return <div className={`app ${mobileDetail ? 'mobile-detail' : 'mobile-list'}`}>
    <button className="mobile-list-heading" aria-label="Scroll notes to top" onClick={() => results.current?.scrollTo({ top: 0, behavior: 'smooth' })}><span>NOTES</span><span>{notes.length}</span></button>
    <header className="omnibar">
      <span className="prompt">❯</span>
      <input ref={input} aria-label="Search or create a note" placeholder="Search or create a note…" value={search}
        onChange={event => { void setSearch(event.target.value) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1) }
          if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1) }
          if (event.key === 'Enter') { event.preventDefault(); openSelection() }
        }} />
      <span className="matches">{notes.length} {notes.length === 1 ? 'MATCH' : 'MATCHES'}</span>
      {search && <button className="chip" onClick={() => void setSearch('')}>ESC to clear</button>}
      {tagFilter && <button className="chip" onClick={() => void setTagFilter(null)}>#{tagFilter} ×</button>}
      {search && <button className="mobile-clear" aria-label="Clear search" onClick={() => void setSearch('')}>×</button>}
      <button className="account-button" onClick={() => { setAccountPanel(value => !value); setSettings(false) }}>{account ? account.email : 'Account'}</button>
      <button className="icon-button" aria-label="Settings" aria-pressed={settings} onClick={() => { setSettings(value => !value); setAccountPanel(false) }}>⚙</button>
    </header>
    <div className="workspace">
      <aside className={`sidebar ${mobileEditor || settings || accountPanel ? 'mobile-hidden' : ''}`}>
        <div className="sidebar-heading"><span>{tagFilter ? `TAG · ${tagFilter}` : search ? 'RESULTS · RANKED' : 'ALL NOTES'}</span><span>{preferences.sort === 'modified' ? 'MODIFIED ↓' : 'TITLE ↓'}</span></div>
        <div className="results" ref={results}>
          {notes.map(note => <button key={note.id} className={`result ${selectedId === note.id ? 'selected' : ''}`}
            onClick={() => { select(note.id); setMobileEditor(true); setSettings(false) }}>
            <span className="result-line"><strong>{note.title || 'Untitled'}</strong><small>{new Date(note.updatedAt).toLocaleDateString()}</small></span>
            {preferences.showPreviews && <span className="preview">{notePreview(note.body)}</span>}
            {preferences.showTags && !!note.tags.length && <span className="result-tags">{note.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}
            {note.dirty && <span className="pending">● pending sync</span>}
          </button>)}
          {!notes.length && (initialLoading
            ? <div className="empty-results loading-results" role="status"><span className="loading-spinner" aria-hidden="true" />Loading notes…</div>
            : <div className="empty-results">{search || tagFilter ? 'No matches yet.' : 'No notes yet. Type a title above to create one.'}</div>)}
        </div>
        <button className="create-row" onClick={() => void create(search)}>＋ Create note {search && `“${search}”`}</button>
        <div className="sidebar-footer"><span>{preferences.showPreviews ? 'previews on' : 'previews off'} &nbsp; · &nbsp; ⌘K omnibar</span><span>{notes.length} notes</span></div>
      </aside>
      <main className={`main-pane ${!mobileEditor && !settings && !accountPanel ? 'mobile-hidden' : ''}`}>
        {accountPanel ? <AccountPanel onClose={() => setAccountPanel(false)} onAccountChanged={async () => { await refresh(); await sync() }} />
          : settings ? <Settings onClose={() => setSettings(false)} onNotesImported={async () => { await refresh(); void sync() }}
              onNotesReset={reset} />
          : selected && (!mobileLayout || mobileEditor) ? <NoteEditor key={selected.id} note={selected} onSave={save} onDelete={async id => { await remove(id); setMobileEditor(false) }} onBack={() => setMobileEditor(false)} />
          : <div className="empty-pane">Search or create a note to begin.</div>}
      </main>
    </div>
    <footer className="statusbar"><span>{status === 'storage-error' ? '⚠ device save failed' : status === 'sync-error' ? '⚠ sync needs attention' : status === 'auth-required' ? '● sign in to sync' : status === 'local' ? '● local notes · connect an account to sync' : status === 'synced' ? '✓ synced' : status === 'syncing' ? `↻ syncing${progress ? ` ${progress.completed}/${progress.total}` : ''}` : status === 'loading' ? 'loading…' : '● offline · saved on this device'}{error && ` · ${error}`}</span><button onClick={() => { if (status === 'auth-required' || status === 'local') setAccountPanel(true); else void sync() }}>{status === 'auth-required' || status === 'local' ? 'Connect account' : 'Sync now'}</button></footer>
    {status === 'sync-error' && error && <div className="mobile-sync-error" role="alert">{error}</div>}
    {!mobileDetail && <div className="mobile-list-actions">
      {tagMenu && <div className="tag-filter-menu" role="group" aria-label="Filter notes by tag">
        <button aria-pressed={!tagFilter} onClick={() => { void setTagFilter(null); setTagMenu(false) }}>All tags</button>
        {tags.map(tag => <button key={tag} aria-pressed={tagFilter === tag} onClick={() => { void setTagFilter(tag); setTagMenu(false) }}>#{tag}</button>)}
        {!tags.length && <span>No tags yet</span>}
      </div>}
      <button className="mobile-tags" aria-expanded={tagMenu} aria-label="Filter by tag" onClick={() => setTagMenu(value => !value)}>{tagFilter ? `#${tagFilter}` : 'TAGS'}</button>
      <button className="mobile-account" onClick={() => { setAccountPanel(true); setSettings(false) }} aria-label="Account">◉</button>
      <button className="mobile-settings" onClick={() => setSettings(true)} aria-label="Settings">⚙</button>
      <button className="mobile-new" onClick={() => { void create(''); setMobileEditor(true) }}>NEW ›</button>
    </div>}
  </div>
}

function NoteEditor({ note, onSave, onDelete, onBack }: { note: LocalNote;
  onSave: (id: string, title: string, body: string, tags: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onBack: () => void }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [tags, setTags] = useState(note.tags)
  const [tagInput, setTagInput] = useState('')
  const editorMode = usePreferences(state => state.editorMode)
  const spellcheck = usePreferences(state => state.spellcheck)
  const [mode, setMode] = useState<'rich' | 'source' | 'diff'>(editorMode)
  const [moreMenu, setMoreMenu] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const editor = useRef<MDXEditorMethods>(null)
  const linkTouch = useRef<{ link: HTMLAnchorElement; x: number; y: number } | null>(null)
  const content = useRef({ title: note.title, body: note.body, tags: note.tags })
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
  return <>
    <div className="note-meta"><button className="mobile-back" onClick={onBack}>‹ results</button><span>~/notes/{note.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md</span><span className="meta-right">{note.dirty ? 'saved locally' : 'saved'}</span><button className="mobile-more" onClick={() => setMoreMenu(value => !value)} aria-label="More note actions" aria-expanded={moreMenu}>⋯</button>
      {moreMenu && <div className="mobile-more-menu" role="menu"><button role="menuitem" onClick={() => { setMode('diff'); setMoreMenu(false) }}>View changes</button><button role="menuitem" className="danger" onClick={() => { setMoreMenu(false); if (confirm('Delete this note?')) void onDelete(note.id) }}>Delete note</button></div>}</div>
    <div className="editor-heading"><input aria-label="Note title" maxLength={500} value={title} onChange={event => { setTitle(event.target.value); save(event.target.value, content.current.body) }} /><button onClick={() => { if (confirm('Delete this note?')) void onDelete(note.id) }}>Delete</button></div>
    <div className="note-tags">{tags.map(tag => <span key={tag}>{tag}<button aria-label={`Remove ${tag} tag`} onClick={() => { const next = tags.filter(item => item !== tag); setTags(next); save(content.current.title, content.current.body, next) }}>×</button></span>)}
      <input aria-label="Add tag" placeholder="+ tag" value={tagInput} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} onBlur={() => { if (tagInput.trim()) addTag() }} /></div>
    {saveError && <div className="save-error" role="alert">Could not save on this device: {saveError}</div>}
    <div className="editor-toggle"><button className={mode === 'rich' ? 'active' : ''} onClick={() => setMode('rich')}>RICH</button><button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>SOURCE</button><button className={mode === 'diff' ? 'active' : ''} onClick={() => setMode('diff')}>DIFF</button></div>
    <div className="editor-body" onTouchCancelCapture={() => { linkTouch.current = null }} onTouchStartCapture={event => {
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
      {mode === 'diff' ? <NoteDiff previousTitle={note.syncedTitle} title={title} previousBody={note.syncedBody} body={body} />
        : mode === 'source' ? <textarea aria-label="Markdown source" spellCheck={spellcheck} value={body} onChange={event => { setBody(event.target.value); save(content.current.title, event.target.value) }} />
        : <MDXEditor ref={editor} key={`${note.id}-${mode}`} markdown={body} plugins={plugins} spellCheck={spellcheck}
            onError={() => setMode('source')}
            onChange={(value, initialMarkdownNormalize) => { if (!initialMarkdownNormalize && value !== content.current.body) { setBody(value); save(content.current.title, value) } }} />}
    </div>
    <div className="mobile-editor-actions"><span>{mode === 'rich' ? 'MDXEditor · rich text' : mode === 'source' ? 'Markdown · source' : 'Changes · diff'}</span><button onClick={() => setMode(mode === 'rich' ? 'source' : 'rich')}>{mode === 'rich' ? 'SOURCE' : 'RICH'}</button><button className="done" onClick={onBack}>DONE</button></div>
  </>
}

function NoteDiff({ previousTitle, title, previousBody, body }: { previousTitle: string; title: string; previousBody: string; body: string }) {
  const changes = compareNote(previousBody, body)
  const changed = previousTitle !== title || previousBody !== body
  return <section className="note-diff" aria-label="Changes since last sync">
    <h2>CHANGES SINCE LAST SYNC</h2>
    {!changed && <p>No text changes to show.</p>}
    {previousTitle !== title && <div className="diff-title"><div className="removed">− {previousTitle || '(new note)'}</div><div className="added">+ {title}</div></div>}
    {changed && changes.map((change, index) => <pre key={index} className={change.kind}>{change.text.split('\n').map((line, lineIndex, lines) =>
      lineIndex === lines.length - 1 && !line ? null : <div key={lineIndex}>{change.kind === 'added' ? '+ ' : change.kind === 'removed' ? '− ' : '  '}{line}</div>)}</pre>)}
  </section>
}

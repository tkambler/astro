import { Component, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MDXEditor, type MDXEditorMethods, BoldItalicUnderlineToggles, BlockTypeSelect,
  ListsToggle, CreateLink, InsertCodeBlock, InsertImage, toolbarPlugin, headingsPlugin,
  listsPlugin, linkPlugin, codeBlockPlugin, codeMirrorPlugin, quotePlugin, frontmatterPlugin, tablePlugin,
  thematicBreakPlugin, imagePlugin } from '@mdxeditor/editor'
import { useNotes } from '../notes/state'
import { onNotesChanged, type LocalNote } from '../notes/local'
import { applyPreferences, syncAccountPreferences, usePreferences } from '../preferences'
import { Settings } from './Settings'
import { AccountPanel } from './Account'
import { SwipeableNoteRow } from './SwipeableNoteRow'
import { CommandPalette, type CommandAction } from './CommandPalette'
import { TagManager } from './TagManager'
import { useAccount } from '../account'
import { hasInvalidFrontmatter, notePreview } from '../notes/content'
import { watchRemoteChanges } from '../notes/sync'
import { createShare, shareUrl } from '../shares'
import type { NoteShare } from '@astronote/schemas'
import { AttachmentShelf } from '../attachments/AttachmentShelf'
import { embeddedImages } from '../attachments'
import { shouldAdoptIncomingDraft } from '../notes/editing'

function editorPlugins(images: ReturnType<typeof embeddedImages>) {
  return [headingsPlugin(), listsPlugin(), linkPlugin(), codeBlockPlugin(), codeMirrorPlugin({ codeBlockLanguages: { bash: 'Bash', sh: 'Shell', text: 'Plain text' } }), quotePlugin(), frontmatterPlugin(), tablePlugin(), thematicBreakPlugin(),
    imagePlugin({ imageUploadHandler: images.upload, imagePreviewHandler: images.preview, disableImageResize: true, allowSetImageDimensions: false }),
    toolbarPlugin({ toolbarContents: () => <><EditorToolbarHeading /><div className="editor-format-controls"><BlockTypeSelect /><BoldItalicUnderlineToggles /><ListsToggle /><CreateLink /><InsertCodeBlock /><InsertImage /></div><EditorToolbarActions /></> })]
}

const mobileLayoutQuery = '(max-width: 700px), ((hover: none) and (pointer: coarse))'

function caretIsAtStartOfFirstEditorBlock(target: EventTarget) {
  if (!(target instanceof Element)) return false
  const editable = target.closest<HTMLElement>('[contenteditable="true"]')
  const selection = window.getSelection()
  if (!editable || !selection?.isCollapsed || selection.rangeCount === 0 || !selection.anchorNode || !editable.contains(selection.anchorNode)) return false

  const contentBeforeCaret = document.createRange()
  contentBeforeCaret.selectNodeContents(editable)
  contentBeforeCaret.setEnd(selection.anchorNode, selection.anchorOffset)
  return contentBeforeCaret.toString().length === 0
}

const EditorActionsContext = createContext<{
  mode: 'rich' | 'source'; invalidFrontmatter: boolean; heading: ReactNode;
  showRich: () => void; showSource: () => void; moveNote: () => void; deleteNote: () => void
} | null>(null)

function EditorToolbarHeading() {
  return useContext(EditorActionsContext)?.heading ?? null
}

function CommandPaletteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round"><path d="m5 7 5 5-5 5" /><path d="M13 17h6" /></svg>
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
    <details ref={menu} className="editor-more" onKeyDown={event => { if (event.key === 'Escape') menu.current!.open = false }}><summary aria-label="More Note Actions" title="More Note Actions">⋯</summary><div className="editor-more-menu"><button type="button" onClick={actions.moveNote}>Move to Collection…</button><button type="button" className="destructive" onClick={actions.deleteNote}>Delete</button></div></details>
  </div>
}

class RichEditorBoundary extends Component<{ children: ReactNode; onError: (error: unknown) => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error: unknown) { this.props.onError(error) }

  render() { return this.state.failed ? null : this.props.children }
}

function CollectionPicker({ className, collections, active, onSelect, onCreate, onDelete }: {
  className: string; collections: string[]; active: string; onSelect(value: string): void; onCreate(value: string): boolean;
  onDelete(value: string): string | null
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (creating) input.current?.focus() }, [creating])
  const create = () => {
    if (!onCreate(name)) return
    setName(''); setCreating(false); setOpen(false)
  }
  const remove = (collection: string) => {
    if (!confirm(`Delete the empty collection “${collection}”?`)) return
    const error = onDelete(collection)
    if (error) alert(error)
  }
  return <div className={`collection-picker ${className}`}>
    <button type="button" className="collection-trigger" aria-haspopup="menu" aria-expanded={open}
      onClick={() => { setOpen(value => !value); setCreating(false); setName('') }}>
      <span>{active}</span><svg aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m3 4.5 3 3 3-3" /></svg>
    </button>
    {open && <>
      <button type="button" className="collection-dismiss" tabIndex={-1} aria-label="Close collection selector" onClick={() => setOpen(false)} />
      <div className="collection-menu" role="menu" aria-label="Collections">
        <div className="collection-menu-label">COLLECTIONS</div>
        {collections.map(collection => <div className="collection-menu-row" role="none" key={collection}>
          <button type="button" role="menuitemradio" aria-checked={collection === active}
            onClick={() => { onSelect(collection); setOpen(false) }}>
            <span>{collection}</span>{collection === active && <span aria-hidden="true">✓</span>}
          </button>
          {collection.toLocaleLowerCase() !== 'notes' && <button type="button" className="collection-delete" role="menuitem"
            aria-label={`Delete ${collection} collection`} title={`Delete ${collection}`} onClick={() => remove(collection)}>×</button>}
        </div>)}
        {creating ? <form className="collection-create" onSubmit={event => { event.preventDefault(); create() }}>
          <input ref={input} value={name} maxLength={80} aria-label="Collection name" placeholder="Collection name"
            onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setCreating(false) } }} />
          <button type="submit" disabled={!name.trim()}>Add</button>
        </form> : <button type="button" className="collection-new" onClick={() => setCreating(true)}>+ New collection</button>}
      </div>
    </>}
  </div>
}

function MoveNoteDialog({ note, collections, onMove, onClose }: { note: LocalNote; collections: string[];
  onMove(collection: string): void; onClose(): void }) {
  return <><button className="move-dialog-backdrop" aria-label="Close move dialog" onClick={onClose} />
    <section className="move-dialog" role="dialog" aria-modal="true" aria-labelledby="move-dialog-title">
      <h2 id="move-dialog-title">MOVE TO COLLECTION</h2>
      <p>{note.title || 'Untitled'}</p>
      <div role="listbox" aria-label="Destination collection">
        {collections.filter(collection => collection !== note.collection).map(collection =>
          <button type="button" role="option" aria-selected="false" key={collection} onClick={() => onMove(collection)}>{collection}</button>)}
      </div>
      {collections.length === 1 && <span className="move-dialog-empty">Create another collection before moving this note.</span>}
      <button className="move-dialog-cancel" onClick={onClose}>Cancel</button>
    </section></>
}

export function App() {
  const { notes, allNotes, trash, tags, collections, activeCollection, tagFilter, search, selectedId, status, error, progress,
    setSearch, setTagFilter, setActiveCollection, createCollection, deleteCollection,
    refresh, resort, select, create, save, move, setPinned, remove, restore, emptyTrash, reset, sync } = useNotes()
  const preferences = usePreferences()
  const account = useAccount(state => state.account)
  const accountStatus = useAccount(state => state.status)
  const [settings, setSettings] = useState(false)
  const [accountPanel, setAccountPanel] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(false)
  const [mobileLayout, setMobileLayout] = useState(() => matchMedia(mobileLayoutQuery).matches)
  const [initialLoad, setInitialLoad] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [tagMenu, setTagMenu] = useState(false)
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null)
  const [noteMenu, setNoteMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [shareDialog, setShareDialog] = useState<{ share: NoteShare | null; error: string } | null>(null)
  const [moveNoteId, setMoveNoteId] = useState<string | null>(null)
  const focusShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const sortMenu = useRef<HTMLDetailsElement>(null)
  const noteMenuRef = useRef<HTMLDivElement>(null)
  const loadAttempt = useRef(0)
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mobileListScroll = useRef<{ top: number; restore: boolean }>({ top: 0, restore: false })
  const selected = notes.find(note => note.id === selectedId) ?? null
  const showMobileEditor = () => {
    if (mobileLayout && !mobileEditor) mobileListScroll.current = { top: results.current?.scrollTop ?? 0, restore: true }
    setMobileEditor(true)
  }
  const returnToMobileList = () => setMobileEditor(false)
  useLayoutEffect(() => {
    if (!mobileLayout || mobileEditor || !mobileListScroll.current.restore) return
    const { top } = mobileListScroll.current
    mobileListScroll.current.restore = false
    results.current?.scrollTo(0, top)
  }, [mobileLayout, mobileEditor])
  const createAndOpen = async (title: string) => {
    if (await create(title)) showMobileEditor()
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
        if (useAccount.getState().status === 'signed-in') await syncAccountPreferences()
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
    return watchRemoteChanges(() => { window.dispatchEvent(new Event('astronote-remote-change')); void useNotes.getState().sync() }, () => {
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
    const media = matchMedia(mobileLayoutQuery)
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
        showMobileEditor()
        input.current?.blur()
      } else void createAndOpen(title)
    } else if (selected) { showMobileEditor(); input.current?.blur() }
  }
  const mobileDetail = mobileEditor || settings || accountPanel
  const signedIn = !!account && status !== 'auth-required'
  const connected = !!account && accountStatus === 'signed-in'
  const shareSelected = async (note: LocalNote) => {
    setShareDialog({ share: null, error: '' })
    if (!connected) { setShareDialog({ share: null, error: 'Connect and sign in before sharing a note.' }); return }
    await sync()
    if (useNotes.getState().status !== 'synced') {
      setShareDialog({ share: null, error: 'The note could not be synced. Reconnect and try again.' }); return
    }
    try { setShareDialog({ share: await createShare(note.id), error: '' }) }
    catch (error) { setShareDialog({ share: null, error: error instanceof Error ? error.message : String(error) }) }
  }
  const commands: CommandAction[] = [
    ...(selected && (!mobileLayout || mobileEditor) ? [{ id: 'pin', label: selected.pinned ? 'Unpin Note' : 'Pin Note', description: selected.title || 'Untitled',
      run: () => { void setPinned(selected.id, !selected.pinned) } },
    ...(mobileLayout ? [{ id: 'tags', label: 'Manage Tags', description: selected.tags.length ? selected.tags.map(tag => `#${tag}`).join(' ') : 'No tags',
      run: () => setTagManagerOpen(true) }] : []),
    { id: 'move', label: 'Move to Collection', description: selected.collection, run: () => setMoveNoteId(selected.id) },
    { id: 'share', label: 'Share Note', description: selected.title || 'Untitled', run: () => { void shareSelected(selected) } },
    { id: 'delete', label: 'Delete Note', description: selected.title || 'Untitled',
      run: () => { if (confirm('Delete this note?')) void remove(selected.id).then(deleted => { if (deleted) returnToMobileList() }) } }] : []),
    { id: 'new', label: 'Create Note', run: () => { void createAndOpen('') } },
    { id: 'settings', label: 'Open Settings', run: () => { setSettings(true); setAccountPanel(false) } },
    { id: 'account', label: signedIn ? 'Open Account' : 'Sign In', run: () => { setAccountPanel(true); setSettings(false) } },
  ]
  return <div className={`app ${mobileDetail ? 'mobile-detail' : 'mobile-list'}`}>
    <div className="landscape-blocker" role="status"><span aria-hidden="true">↻</span>Rotate your device to portrait</div>
    <div className="mobile-list-heading">
      <CollectionPicker className="mobile-collection-picker" collections={collections} active={activeCollection}
        onSelect={setActiveCollection} onCreate={createCollection} onDelete={deleteCollection} />
      <span className="mobile-note-count">{initialLoad === 'loading' ? '' : notes.length}</span>
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
        <CommandPaletteIcon />
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
      <CollectionPicker className="desktop-collection-picker" collections={collections} active={activeCollection}
        onSelect={setActiveCollection} onCreate={createCollection} onDelete={deleteCollection} />
      <kbd className="omnibar-shortcut">{focusShortcut}</kbd>
      {search && <button className="chip" onClick={() => void setSearch('')}>ESC to clear</button>}
      {tagFilter && <button className="chip" onClick={() => void setTagFilter(null)}>#{tagFilter} ×</button>}
      {search && <button className="mobile-clear" aria-label="Clear search" onClick={() => void setSearch('')}>×</button>}
      <button className="icon-button palette-trigger" aria-label="Open Command Palette" title={`Command Palette (${focusShortcut.startsWith('⌘') ? '⌘⇧O' : 'Ctrl Shift O'})`} aria-pressed={paletteOpen}
        onClick={() => setPaletteOpen(value => !value)}><CommandPaletteIcon /></button>
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
        <div className="results" ref={results} aria-busy={initialLoad === 'loading' || (status === 'syncing' && !notes.length)} onScroll={() => setNoteMenu(null)}>
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
              if (event.metaKey && selectedId === note.id) { select(null); returnToMobileList() }
              else { select(note.id); showMobileEditor() }
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
              : status === 'syncing'
                ? <div className="empty-results" role="status">Syncing notes…</div>
                : <div className="empty-results">{search || tagFilter ? 'No matches yet.' : 'No notes yet. Type a title above to create one.'}</div>)}
        </div>
        <button className="create-row" onClick={() => void createAndOpen(search)}>＋ Create Note {search && `“${search}”`}</button>
      </aside>
      <main className={`main-pane ${!mobileEditor && !settings && !accountPanel ? 'mobile-hidden' : ''}`}>
        {accountPanel ? <AccountPanel onClose={() => setAccountPanel(false)} onAccountChanged={async () => {
          await useNotes.getState().refresh()
          if (useAccount.getState().status === 'signed-in') void syncAccountPreferences()
          void useNotes.getState().sync()
        }} />
          : settings ? <Settings mobileLayout={mobileLayout} onClose={() => setSettings(false)} onNotesImported={async () => { await refresh(); void sync() }}
              onNotesReset={reset} trash={trash} onRestore={restore} onEmptyTrash={emptyTrash} />
          : selected && (!mobileLayout || mobileEditor) ? <NoteEditor key={selected.id} note={selected} mobileLayout={mobileLayout} connected={connected} onSave={save} onMove={() => setMoveNoteId(selected.id)} onDelete={async id => { if (await remove(id)) returnToMobileList() }} onBack={returnToMobileList} onOpenCommandPalette={() => setPaletteOpen(true)} />
          : <div className="empty-pane">Search or create a note to begin.</div>}
      </main>
    </div>
    {paletteOpen && <CommandPalette actions={commands} onClose={() => setPaletteOpen(false)} />}
    {tagManagerOpen && selected && <TagManager noteTitle={selected.title} initialTags={selected.tags}
      onClose={() => setTagManagerOpen(false)}
      onSave={async nextTags => { await save(selected.id, selected.title, selected.body, nextTags); setTagManagerOpen(false) }} />}
    {shareDialog && <><button className="share-dialog-backdrop" aria-label="Close share dialog" onClick={() => setShareDialog(null)} />
      <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
        <h2 id="share-dialog-title">SHARE NOTE</h2>
        {!shareDialog.share && !shareDialog.error && <p>Syncing and creating a public link…</p>}
        {shareDialog.error && <p role="alert">{shareDialog.error}</p>}
        {shareDialog.share && <><p>Anyone with this link can read the latest synced version of the note.</p>
          <input readOnly aria-label="Shared note URL" value={shareUrl(shareDialog.share.id)} onFocus={event => event.currentTarget.select()} />
          <div><button onClick={() => { void navigator.clipboard.writeText(shareUrl(shareDialog.share!.id)) }}>Copy Link</button>
            {typeof navigator.share === 'function' && <button onClick={() => { void navigator.share({ title: shareDialog.share!.title || 'Untitled', url: shareUrl(shareDialog.share!.id) }) }}>Share…</button>}</div></>}
        <button className="share-dialog-close" onClick={() => setShareDialog(null)}>Close</button>
      </section></>}
    {moveNoteId && allNotes.find(note => note.id === moveNoteId) && (() => {
      const note = allNotes.find(item => item.id === moveNoteId)!
      return <MoveNoteDialog note={note} collections={collections} onClose={() => setMoveNoteId(null)} onMove={collection => {
        setMoveNoteId(null)
        void move(note.id, collection).then(moved => { if (moved && mobileLayout) returnToMobileList() })
      }} />
    })()}
    {noteMenu && <div ref={noteMenuRef} className="sidebar-note-menu" role="menu" aria-label="Note Actions"
      style={{ left: noteMenu.x, top: noteMenu.y }}>
      <button type="button" role="menuitem" onClick={() => { const id = noteMenu.id; setNoteMenu(null); setMoveNoteId(id) }}>Move to Collection…</button>
      <button type="button" className="destructive" role="menuitem" onClick={() => { const id = noteMenu.id; setNoteMenu(null); void remove(id) }}>Delete</button>
    </div>}
    {(status === 'sync-error' || status === 'storage-error') && error && <div className="mobile-sync-error" role="alert">{error}</div>}
    <footer className="statusbar">
      <button className={`statusbar-account ${signedIn ? 'signed-in' : ''}`} title={signedIn ? account.email : 'Sign In'} onClick={() => { setAccountPanel(true); setSettings(false) }}>{signedIn ? account.email : 'Sign In'}</button>
      <div className="statusbar-right">
        {selected && !settings && !accountPanel && <span>{selected.dirty ? 'saved locally' : 'saved'}</span>}
        <span className="statusbar-state">{status === 'storage-error' ? '⚠ device save failed' : status === 'sync-error' ? '⚠ sync needs attention' : status === 'auth-required' ? '● sign in to sync' : status === 'local' ? '● local notes · connect an account to sync' : status === 'synced' ? '✓ synced' : status === 'syncing' ? `↻ syncing${progress ? ` ${progress.completed}/${progress.total}` : ''}` : status === 'loading' ? 'loading…' : '● offline · saved on this device'}{error && ` · ${error}`}</span>
        {signedIn && <button onClick={() => void sync()}>Sync Now</button>}
      </div>
    </footer>
  </div>
}

function NoteEditor({ note, mobileLayout, connected, onSave, onMove, onDelete, onBack, onOpenCommandPalette }: { note: LocalNote; mobileLayout: boolean; connected: boolean;
  onSave: (id: string, title: string, body: string, tags: string[]) => Promise<void>;
  onMove: () => void; onDelete: (id: string) => Promise<void>; onBack: () => void; onOpenCommandPalette: () => void }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const editorMode = usePreferences(state => state.editorMode)
  const spellcheck = usePreferences(state => state.spellcheck)
  const [mode, setMode] = useState<'rich' | 'source'>(editorMode)
  const [richFailed, setRichFailed] = useState(false)
  const [richError, setRichError] = useState('')
  const invalidFrontmatter = hasInvalidFrontmatter(body)
  const displayMode = invalidFrontmatter || richFailed ? 'source' : mobileLayout ? 'rich' : mode
  const [saveError, setSaveError] = useState<string | null>(null)
  const editor = useRef<MDXEditorMethods>(null)
  const images = useMemo(() => embeddedImages(note.id), [note.id])
  const plugins = useMemo(() => editorPlugins(images), [images])
  useEffect(() => () => images.dispose(), [images])
  const linkTouch = useRef<{ link: HTMLAnchorElement; x: number; y: number } | null>(null)
  const editorInteracted = useRef(false)
  const pendingSaves = useRef(0)
  const appliedRevision = useRef(note.revision)
  const content = useRef({ title: note.title, body: note.body, tags: note.tags })
  useEffect(() => {
    if (note.tags.join('\0') !== content.current.tags.join('\0')) {
      content.current = { ...content.current, tags: note.tags }
    }
    // A refresh can race an IndexedDB write and briefly return the previous clean record. Only a newer
    // server revision may replace a live draft; reapplying same-revision Markdown rebuilds the editor and loses its selection.
    if (!shouldAdoptIncomingDraft(note, content.current, appliedRevision.current, pendingSaves.current)) return
    if (note.title !== content.current.title) setTitle(note.title)
    if (note.body !== content.current.body) {
      editorInteracted.current = false
      setBody(note.body)
      editor.current?.setMarkdown(note.body)
    }
    appliedRevision.current = note.revision
    content.current = { title: note.title, body: note.body, tags: note.tags }
  }, [note.revision, note.updatedAt, note.dirty, note.tags])
  const save = (nextTitle: string, nextBody: string, nextTags = content.current.tags) => {
    content.current = { title: nextTitle, body: nextBody, tags: nextTags }
    pendingSaves.current++
    void onSave(note.id, nextTitle, nextBody, nextTags).then(() => setSaveError(null))
      .catch(error => setSaveError(error instanceof Error ? error.message : String(error)))
      .finally(() => { pendingSaves.current-- })
  }
  const noteTitle = () => <input aria-label="Note title" maxLength={500} value={title} onChange={event => { setTitle(event.target.value); save(event.target.value, content.current.body) }} />
  const toolbarActions = {
    mode: displayMode, invalidFrontmatter, heading: <div className="editor-ribbon-heading">{noteTitle()}</div>,
    showRich: () => { setRichError(''); setRichFailed(false); setMode('rich') },
    showSource: () => setMode('source'),
    moveNote: onMove,
    deleteNote: () => { if (confirm('Delete this note?')) void onDelete(note.id) },
  }
  const markEditorInteraction = (target: EventTarget) => {
    if (!(target instanceof Element && target.closest('.editor-ribbon-heading'))) editorInteracted.current = true
  }
  return <div className="note-editor-layout"><section className="note-document">
    <div className="editor-heading"><button className="mobile-back" aria-label="Back to notes" onClick={onBack}>‹</button><div className="mobile-title-field">{noteTitle()}</div>
      <button className="mobile-editor-palette palette-trigger" onClick={onOpenCommandPalette} aria-label="Open Command Palette">
        <CommandPaletteIcon />
      </button></div>
    {saveError && <div className="save-error" role="alert">Could not save on this device: {saveError}</div>}
    {invalidFrontmatter && <div className="editor-warning" role="status">Invalid YAML frontmatter. Edit it in source mode to restore the rich editor.</div>}
    {!invalidFrontmatter && richFailed && <div className="editor-warning" role="alert">Rich text could not render this note: {richError || 'unsupported Markdown syntax'}. Edit it in source mode and try again.</div>}
    {displayMode === 'source' && <EditorActionsContext.Provider value={toolbarActions}><div className="editor-source-toolbar"><EditorToolbarHeading /><EditorToolbarActions /></div></EditorActionsContext.Provider>}
    <div className={`editor-body ${displayMode === 'source' ? 'source-editor' : ''}`}
      onPointerDownCapture={event => markEditorInteraction(event.target)}
      onKeyDownCapture={event => {
        markEditorInteraction(event.target)
        if (event.key === 'ArrowUp' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && caretIsAtStartOfFirstEditorBlock(event.target)) event.preventDefault()
      }}
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
        : <EditorActionsContext.Provider value={toolbarActions}><RichEditorBoundary onError={error => { setRichError(error instanceof Error ? error.message : String(error)); setRichFailed(true); setMode('source') }}><MDXEditor ref={editor} key={`${note.id}-${displayMode}`} markdown={body} plugins={plugins} spellCheck={spellcheck}
            onError={({ error }) => { setRichError(error); setRichFailed(true); setMode('source') }}
            onChange={(value, initialMarkdownNormalize) => { if (editorInteracted.current && !initialMarkdownNormalize && value !== content.current.body) { setBody(value); save(content.current.title, value) } }} /></RichEditorBoundary></EditorActionsContext.Provider>}
    </div>
  </section><AttachmentShelf noteId={note.id} noteBody={body} mobile={mobileLayout} connected={connected} /></div>
}

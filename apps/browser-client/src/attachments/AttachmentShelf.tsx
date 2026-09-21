import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { Attachment } from '@astronote/schemas'
import { cached, forgetAttachment, localAttachments, openAttachment, refreshAttachmentCatalog,
  rememberAttachment, removeCachedAttachment, upload } from './index'

type Transfer = { key: string; filename: string; progress: number; error: string }

function Paperclip() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 1 1-2.8-2.8l8.5-8.5" /></svg>
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AttachmentShelf({ noteId, noteBody, mobile, connected }: { noteId: string; noteBody: string; mobile: boolean; connected: boolean }) {
  const [items, setItems] = useState<Attachment[]>([])
  const [available, setAvailable] = useState<Set<string>>(new Set())
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [open, setOpen] = useState(() => !mobile && localStorage.getItem('astronote-attachment-rail-open') === '1')
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const dock = useRef<HTMLButtonElement>(null)

  const loadAvailability = async (next: Attachment[]) => {
    const states = await Promise.all(next.map(async item => [item.id, await cached(item.id)] as const))
    setAvailable(new Set(states.filter(([, value]) => value).map(([id]) => id)))
  }
  const loadLocal = async () => {
    const next = await localAttachments(noteId)
    setItems(next); await loadAvailability(next)
  }
  const refresh = async () => {
    const next = await refreshAttachmentCatalog(noteId)
    setItems(next); await loadAvailability(next)
  }

  useEffect(() => { setMessage(''); setTransfers([]); void loadLocal() }, [noteId])
  useEffect(() => { if (mobile) setOpen(false) }, [mobile])
  useEffect(() => { if (open && connected) void refresh().catch(error => setMessage(String(error))) }, [open, connected, noteId])
  useEffect(() => {
    const changed = () => { if (open && connected) void refresh().catch(error => setMessage(String(error))) }
    window.addEventListener('astronote-remote-change', changed)
    return () => window.removeEventListener('astronote-remote-change', changed)
  }, [open, connected, noteId])
  useEffect(() => {
    const created = (event: Event) => {
      const item = (event as CustomEvent<Attachment>).detail
      if (item.noteId === noteId) {
        setItems(current => current.some(value => value.id === item.id) ? current : [...current, item])
        setAvailable(current => new Set(current).add(item.id))
      }
    }
    window.addEventListener('astronote-attachment-created', created)
    return () => window.removeEventListener('astronote-attachment-created', created)
  }, [noteId])
  useEffect(() => {
    if (!mobile) { dialog.current?.close(); return }
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [mobile, open])
  useEffect(() => {
    if (!mobile || !window.visualViewport) return
    const viewport = window.visualViewport
    const initial = viewport.height
    const update = () => {
      const editing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      setKeyboardOpen(!!editing && viewport.height < initial * .78)
    }
    viewport.addEventListener('resize', update)
    return () => viewport.removeEventListener('resize', update)
  }, [mobile])

  const choose = () => {
    if (!connected) { setMessage('Connect to manage attachments.'); return }
    input.current?.click()
  }
  const addFiles = async (selected: File[]) => {
    if (!selected.length) return
    if (!connected) { setMessage('Connect to manage attachments.'); return }
    const room = Math.max(0, 20 - items.length - transfers.filter(item => !item.error).length)
    const files = selected.slice(0, room)
    if (!files.length) { setMessage('A note can have up to 20 attachments.'); return }
    if (selected.length > files.length) setMessage(`Only ${files.length} files fit on this note.`)
    const pending = files.map((file, index) => ({ key: `${Date.now()}-${index}-${file.name}`, filename: file.name, progress: 0, error: '' }))
    setTransfers(current => [...current, ...pending])
    let cursor = 0
    const worker = async () => {
      while (cursor < files.length) {
        const index = cursor++
        const file = files[index]!
        const transfer = pending[index]!
        try {
          const created = await upload(file, noteId, progress => setTransfers(current => current.map(item =>
            item.key === transfer.key ? { ...item, progress } : item)))
          await rememberAttachment(created)
          setItems(current => [...current, created])
          setTransfers(current => current.filter(item => item.key !== transfer.key))
        } catch (error) {
          setTransfers(current => current.map(item => item.key === transfer.key
            ? { ...item, error: error instanceof Error ? error.message : String(error) } : item))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker))
  }
  const drop = (event: DragEvent) => {
    event.preventDefault(); setDragging(false)
    void addFiles(Array.from(event.dataTransfer.files))
  }
  const download = async (item: Attachment) => {
    setMessage('')
    try {
      await openAttachment(item)
      setAvailable(current => new Set(current).add(item.id))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const remove = async (item: Attachment) => {
    if (!connected) { setMessage('Connect to manage attachments.'); return }
    const embedded = noteBody.includes(`attachment:${item.id}`)
    if (!confirm(embedded ? `Delete “${item.filename}”? It is displayed in this note and will become a broken image.`
      : `Delete “${item.filename}”? This cannot be undone.`)) return
    const response = await fetch(`/api/attachments/${item.id}`, { method: 'DELETE', headers: { 'x-astronote-request': '1' } })
    if (!response.ok) { setMessage(response.status === 401 ? 'Sign in to manage attachments.' : 'Could not delete attachment.'); return }
    await Promise.all([forgetAttachment(item.id), removeCachedAttachment(item.id)])
    setItems(current => current.filter(value => value.id !== item.id))
  }

  const content = <div className={`attachment-content ${dragging ? 'is-dragging' : ''}`}
    onDragEnter={event => { event.preventDefault(); setDragging(true) }} onDragOver={event => event.preventDefault()}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={drop}>
    <div className="attachment-heading"><div><strong>ATTACHMENTS</strong><span>{items.length + transfers.length} / 20</span></div>
      <button type="button" onClick={choose} disabled={!connected || items.length + transfers.length >= 20}>＋ Add files</button></div>
    {!connected && <p className="attachment-offline">Connect to manage attachments. Files already on this device remain available.</p>}
    <div className="attachment-list">
      {items.map(item => <div className="attachment-row" key={item.id}>
        <span className="attachment-file-icon" aria-hidden="true">{item.filename.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'}</span>
        <span className="attachment-details"><strong title={item.filename}>{item.filename}</strong><small>{formatSize(item.byteSize)} · {available.has(item.id) ? 'on this device' : connected ? 'download when opened' : 'connect to download'}</small></span>
        <button type="button" onClick={() => void download(item)} disabled={!connected && !available.has(item.id)}>{available.has(item.id) ? 'Open' : 'Download'}</button>
        <button type="button" className="attachment-delete" aria-label={`Delete ${item.filename}`} disabled={!connected} onClick={() => void remove(item)}>×</button>
      </div>)}
      {transfers.map(item => <div className="attachment-row attachment-transfer" key={item.key}>
        <span className="attachment-file-icon" aria-hidden="true">↑</span>
        <span className="attachment-details"><strong title={item.filename}>{item.filename}</strong>
          {item.error ? <small className="attachment-error">{item.error}</small> : <progress max={1} value={item.progress} aria-label={`Uploading ${item.filename}`} />}</span>
        {item.error && <button type="button" onClick={() => setTransfers(current => current.filter(value => value.key !== item.key))}>Dismiss</button>}
      </div>)}
      {!items.length && !transfers.length && <div className="attachment-empty"><Paperclip /><strong>No attachments</strong><span>Add files that belong beside this note.</span></div>}
    </div>
    {message && <p className="attachment-message" role="alert">{message}</p>}
    <input ref={input} type="file" multiple hidden onChange={event => {
      void addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''
    }} />
  </div>

  if (mobile) return <>
    {!keyboardOpen && <button ref={dock} type="button" className="attachment-dock" aria-expanded={open}
      onClick={() => setOpen(true)}><Paperclip /><span>Attachments</span><strong>{items.length}</strong></button>}
    <dialog ref={dialog} className="attachment-sheet" aria-labelledby="attachment-sheet-title"
      onClose={() => { setOpen(false); requestAnimationFrame(() => dock.current?.focus()) }}
      onCancel={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) dialog.current.close() }}>
      <div className="attachment-sheet-panel"><div className="attachment-sheet-grip" aria-hidden="true" />
        <div className="attachment-sheet-title"><span id="attachment-sheet-title">NOTE FILES</span><button type="button" onClick={() => dialog.current?.close()} aria-label="Close attachments">×</button></div>
        {content}</div>
    </dialog>
  </>

  return <aside className={`attachment-rail ${open ? 'is-open' : ''}`}>
    <button type="button" className="attachment-rail-toggle" aria-expanded={open} title={open ? 'Close attachments' : 'Open attachments'}
      onClick={() => { const next = !open; setOpen(next); localStorage.setItem('astronote-attachment-rail-open', next ? '1' : '0') }}>
      <Paperclip /><strong>{items.length}</strong><span>ATTACHMENTS</span>
    </button>
    {open && content}
  </aside>
}

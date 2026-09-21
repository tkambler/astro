import { useEffect, useRef, useState } from 'react'
import { accentSwatch, usePreferences, type Accent, type Theme } from '../preferences'
import { exportNotes, importNotes, importTextFiles } from '../notes/transfer'
import { deviceStorage, requestPersistentStorage, type DeviceStorage } from '../notes/storage'
import { Button, Switch } from '../design-system'
import { useAccount } from '../account'
import { activeAccountId } from '../notes/local'
import type { LocalNote } from '../notes/local'
import { systemSettings as systemSettingsSchema, systemUser as systemUserSchema,
  type NoteShare, type SystemSettings, type SystemUser } from '@astronote/schemas'
import { listShares, revokeShare, shareUrl } from '../shares'

type Section = 'Appearance' | 'Editor' | 'Files & Sync' | 'Shared Notes' | 'Trash' | 'System' | 'Shortcuts' | 'About'
const sections: Section[] = ['Appearance', 'Editor', 'Files & Sync', 'Shared Notes', 'Trash', 'System', 'Shortcuts', 'About']

export function Settings({ mobileLayout, onClose, onNotesImported, onNotesReset, trash, onRestore, onEmptyTrash }: {
  mobileLayout: boolean; onClose(): void; onNotesImported(): Promise<void>; onNotesReset(): Promise<void>;
  trash: LocalNote[]; onRestore(id: string): Promise<boolean>; onEmptyTrash(): Promise<number> }) {
  const [section, setSection] = useState<Section | null>(mobileLayout ? null : 'Appearance')
  const [message, setMessage] = useState('')
  const [importProgress, setImportProgress] = useState<{ label: string; completed: number; total: number } | null>(null)
  const [storage, setStorage] = useState<DeviceStorage | null>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const textInput = useRef<HTMLInputElement>(null)
  const resetDialog = useRef<HTMLDialogElement>(null)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')
  const [trashBusy, setTrashBusy] = useState(false)
  const [trashMessage, setTrashMessage] = useState('')
  const [system, setSystem] = useState<SystemSettings | null>(null)
  const [systemUsers, setSystemUsers] = useState<SystemUser[] | null>(null)
  const [systemBusy, setSystemBusy] = useState(false)
  const [systemError, setSystemError] = useState('')
  const [shares, setShares] = useState<NoteShare[] | null>(null)
  const [sharesBusy, setSharesBusy] = useState('')
  const [sharesError, setSharesError] = useState('')
  const account = useAccount(state => state.account)
  const accountStatus = useAccount(state => state.status)
  const hasAccountNotes = activeAccountId() !== null
  const preferences = usePreferences()
  const { update } = preferences
  useEffect(() => { setSection(mobileLayout ? null : 'Appearance') }, [mobileLayout])
  useEffect(() => { void deviceStorage().then(setStorage) }, [])
  useEffect(() => {
    if (section !== 'Shared Notes' || accountStatus !== 'signed-in') return
    let active = true
    setSharesError('')
    void listShares().then(value => { if (active) setShares(value) })
      .catch(error => { if (active) setSharesError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [section, accountStatus, account?.id])
  useEffect(() => {
    if (!account?.admin || accountStatus !== 'signed-in') { setSystem(null); setSystemUsers(null); return }
    let active = true
    void Promise.all([
      fetch('/api/system/settings', { cache: 'no-store' }),
      fetch('/api/system/users', { cache: 'no-store' }),
    ]).then(async ([settingsResponse, usersResponse]) => {
      if (!settingsResponse.ok || !usersResponse.ok) throw new Error('Could not load system information')
      const settings = systemSettingsSchema.parse(await settingsResponse.json())
      const users = systemUserSchema.array().parse((await usersResponse.json() as { users: unknown }).users)
      if (active) { setSystem(settings); setSystemUsers(users); setSystemError('') }
    }).catch(error => { if (active) setSystemError(String(error)) })
    return () => { active = false }
  }, [account?.id, account?.admin, accountStatus])
  const changeRegistration = async (enabled: boolean) => {
    setSystemBusy(true); setSystemError('')
    try {
      const response = await fetch('/api/system/settings', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-astronote-request': '1' },
        body: JSON.stringify({ enableAccountRegistration: enabled }) })
      if (!response.ok) throw new Error(response.status === 403 ? 'Administrator access required' : 'Could not update system settings')
      setSystem(systemSettingsSchema.parse(await response.json()))
    } catch (error) { setSystemError(String(error)) }
    finally { setSystemBusy(false) }
  }
  const handleImport = async (file: File | undefined) => {
    if (!file) return
    setMessage('')
    setImportProgress({ label: 'Reading Backup', completed: 0, total: 0 })
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const count = await importNotes(file, (completed, total) => setImportProgress({ label: 'Importing Notes', completed, total }))
      setImportProgress({ label: 'Loading Notes', completed: count, total: count })
      await onNotesImported()
      setMessage(`Imported ${count} ${count === 1 ? 'note' : 'notes'} on this device.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed') }
    finally { setImportProgress(null) }
    if (backupInput.current) backupInput.current.value = ''
  }
  const handleTextImport = async (files: FileList | null) => {
    if (!files?.length) return
    setMessage('')
    setImportProgress({ label: 'Reading Files', completed: 0, total: files.length })
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const count = await importTextFiles(files, (completed, total) => setImportProgress({ label: 'Importing Notes', completed, total }))
      setImportProgress({ label: 'Loading Notes', completed: count, total: count })
      await onNotesImported()
      setMessage(`Imported ${count} ${count === 1 ? 'note' : 'notes'} on this device.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed') }
    finally { setImportProgress(null) }
    if (textInput.current) textInput.current.value = ''
  }
  const handleReset = async () => {
    setResetting(true); setResetError('')
    try {
      await onNotesReset()
      resetDialog.current?.close()
      setMessage('All notes in this workspace were permanently deleted.')
      void deviceStorage().then(setStorage).catch(() => undefined)
    } catch (error) { setResetError(error instanceof Error ? error.message : String(error)) }
    finally { setResetting(false) }
  }
  return <div className="settings-view">
    <div className="settings-top"><button className="mobile-settings-back" onClick={() => { if (mobileLayout && section) setSection(null); else onClose() }}>{mobileLayout && section ? '‹ Settings' : '‹ Notes'}</button><span>{mobileLayout && section ? section.toUpperCase() : 'SETTINGS'}</span><span>changes save as you make them</span><button onClick={onClose}>ESC to close</button></div>
    <div className="settings-layout">
      <nav className={`settings-nav ${section === null ? 'mobile-section-list' : ''}`} aria-label="Settings sections">{sections.filter(item => item !== 'System' || (account?.admin && accountStatus === 'signed-in')).map(item =>
        <button key={item} className={section === item ? 'active' : ''} aria-current={section === item ? 'page' : undefined}
          onClick={event => setSection(event.metaKey && section === item ? null : item)}>{item}</button>)}</nav>
      <div className={`settings-content ${section !== null ? 'mobile-section-active' : ''}`}>
        {section === null && <div className="settings-unselected">Select a settings page.</div>}
        <section className={`settings-section ${section === 'Appearance' ? 'active' : ''}`}>
          <h2>THEME</h2><p>Applies to this device. System follows your operating system setting.</p>
          <div className="theme-cards">{(['light', 'dark', 'system'] as Theme[]).map(value =>
            <button key={value} className={`theme-card ${preferences.theme === value ? 'active' : ''}`} onClick={() => update({ theme: value })}>
              <span className={`theme-preview ${value}`}><i /><i /><i /></span><span>{preferences.theme === value ? '◉' : '◯'} &nbsp;{value[0]!.toUpperCase() + value.slice(1)}</span>
            </button>)}</div>
          <div className="accent-row"><span>Accent</span>{(['cobalt','sage','amber','rose'] as Accent[]).map(value =>
            <button key={value} className={`swatch ${preferences.accent === value ? 'active' : ''}`}
              aria-label={`${value} accent`} aria-pressed={preferences.accent === value}
              onClick={() => update({ accent: value })}><span style={{ background: accentSwatch(value) }} /></button>)}</div>
          <hr /><h2>SIDEBAR</h2>
          <label className="settings-check"><Switch aria-label="Show Note Previews" checked={preferences.showPreviews} onCheckedChange={checked => update({ showPreviews: checked })} /><span><strong>Show Note Previews</strong><small>Display body text beneath each note title.</small></span></label>
          <label className="setting-field">Preview Lines <select disabled={!preferences.showPreviews} value={preferences.previewLines}
            onChange={event => update({ previewLines: Number(event.target.value) as 1 | 2 | 3 })}>{[1,2,3].map(n => <option key={n} value={n}>{n} {n === 1 ? 'line' : 'lines'}</option>)}</select></label>
          <label className="setting-field">Sort Notes By <select value={preferences.sort}
            onChange={event => { const sort = event.target.value as 'modified' | 'title'; update({ sort, sortDirection: sort === 'title' ? 'asc' : 'desc' }) }}><option value="modified">Date Modified</option><option value="title">Title</option></select></label>
          <label className="settings-check"><Switch aria-label="Show Tags on Each Row" checked={preferences.showTags} onCheckedChange={checked => update({ showTags: checked })} /><span><strong>Show Tags on Each Row</strong></span></label>
          <hr /><h2>TYPOGRAPHY</h2>
          <label className="setting-field">Editor Text Size <select value={preferences.textSize} onChange={event => update({ textSize: Number(event.target.value) as 13 | 15 | 17 | 19 })}>{[13,15,17,19].map(n => <option key={n} value={n}>{n} px</option>)}</select></label>
          <label className="setting-field">Line Length <select value={preferences.lineLength} onChange={event => update({ lineLength: Number(event.target.value) as 600 | 720 | 840 })}>{[600,720,840].map(n => <option key={n} value={n}>{n} px</option>)}</select></label>
        </section>
        <section className={`settings-section ${section === 'Editor' ? 'active' : ''}`}><h2>EDITOR</h2><p>Write in rich text, or switch to Markdown source at any time. Edits save on this device as you type.</p>
          <label className="setting-field">Default Mode <select value={preferences.editorMode} onChange={event => update({ editorMode: event.target.value as 'rich' | 'source' })}><option value="rich">Rich Text</option><option value="source">Markdown Source</option></select></label>
          <label className="settings-check"><Switch aria-label="Spellcheck" checked={preferences.spellcheck} onCheckedChange={checked => update({ spellcheck: checked })} /><span><strong>Spellcheck</strong></span></label>
        </section>
        <section className={`settings-section ${section === 'Files & Sync' ? 'active' : ''}`}><h2>FILES &amp; SYNC</h2><p>Your notes are stored on this device and synced with the server when it is reachable. Export a backup before clearing browser data.</p>
          <div className="storage-row"><span>Device storage: {storage?.persistent === true ? 'protected from automatic eviction' : storage?.persistent === false ? 'best effort' : 'unavailable'}
            {storage?.usedBytes != null && ` · about ${(storage.usedBytes / 1024 / 1024).toFixed(1)} MB used`}</span>
            {storage?.persistent === false && <button onClick={() => { void requestPersistentStorage().then(async granted => {
              setStorage(await deviceStorage())
              setMessage(granted ? 'Device storage protection enabled.' : 'Browser did not grant persistent storage. Keep a backup of important notes.')
            }).catch(error => setMessage(String(error))) }}>Protect Device Storage</button>}</div>
          <div className="backup-actions"><Button onClick={() => { void exportNotes().then(count => setMessage(`Exported ${count} notes.`)).catch(error => setMessage(String(error))) }}>Export Backup</Button>
          <Button disabled={!!importProgress} onClick={() => backupInput.current?.click()}>Import Backup</Button><input ref={backupInput} type="file" accept="application/json,.json" hidden onChange={event => { void handleImport(event.target.files?.[0]) }} />
          <Button disabled={!!importProgress} onClick={() => textInput.current?.click()}>Import Markdown/Text Files</Button><input ref={textInput} type="file" accept=".md,.MD,.txt,.TXT" multiple hidden onChange={event => { void handleTextImport(event.target.files) }} /></div>
          {importProgress && <div className="import-progress" role="status" aria-live="polite"><span>{importProgress.label}{importProgress.total ? ` · ${importProgress.completed} of ${importProgress.total}` : '…'}</span><progress max={importProgress.total || 1} value={importProgress.label === 'Loading Notes' ? undefined : importProgress.completed} /></div>}
          {message && <p className="settings-feedback" role="status">{message}</p>}
          <div className="notes-danger-zone"><h2>DANGER ZONE</h2>
            <div>Delete every note in {hasAccountNotes ? 'this account and on this device' : 'this guest workspace on this device'}. This cannot be undone.</div>
            {hasAccountNotes && accountStatus !== 'signed-in' && <div>Sign in and reconnect before resetting this account.</div>}
            <Button className="danger-action" disabled={hasAccountNotes && accountStatus !== 'signed-in'}
              onClick={() => { setResetError(''); resetDialog.current?.showModal() }}>Reset All Notes</Button>
          </div>
          <dialog ref={resetDialog} className="reset-dialog" role="alertdialog" aria-labelledby="reset-notes-title" aria-describedby="reset-notes-description"
            onCancel={event => { if (resetting) event.preventDefault() }}>
            <h2 id="reset-notes-title">Permanently Delete All Notes?</h2>
            <p id="reset-notes-description">{hasAccountNotes
              ? `Every note for ${account?.email ?? 'this account'} will be removed from the server and this device, including unsynced edits. Other devices will clear their copies when they reconnect.`
              : 'Every guest note on this device will be removed, including unsynced edits.'} This cannot be undone.</p>
            {resetError && <p className="reset-error" role="alert">{resetError}</p>}
            <div className="reset-dialog-actions"><Button disabled={resetting} onClick={() => resetDialog.current?.close()}>Cancel</Button>
              <Button className="danger-action" disabled={resetting} onClick={() => { void handleReset() }}>
                {resetting ? 'Deleting…' : 'Delete All Notes'}</Button></div>
          </dialog>
        </section>
        <section className={`settings-section ${section === 'Shared Notes' ? 'active' : ''}`}>
          <h2>SHARED NOTES</h2><p>Anyone with one of these links can read the latest synced version of its note. Revoke a link to disable access immediately.</p>
          {accountStatus !== 'signed-in' ? <p>Sign in and connect to manage shared links.</p>
            : shares === null && !sharesError ? <p>Loading Shared Links…</p>
            : shares?.length ? <div className="share-list">{shares.map(shared => <div className="share-row" key={shared.id}>
              <span><strong>{shared.title || 'Untitled'}</strong><small>Created {new Date(shared.createdAt).toLocaleDateString()}</small>
                <a href={shareUrl(shared.id)} target="_blank" rel="noreferrer">{shareUrl(shared.id)}</a></span>
              <div><Button onClick={() => { void navigator.clipboard.writeText(shareUrl(shared.id)).catch(() => undefined) }}>Copy</Button>
                <Button className="danger-action" disabled={sharesBusy === shared.id} onClick={() => {
                  if (!confirm(`Revoke the shared link for “${shared.title || 'Untitled'}”?`)) return
                  setSharesBusy(shared.id); setSharesError('')
                  void revokeShare(shared.id).then(() => setShares(current => current?.filter(item => item.id !== shared.id) ?? []))
                    .catch(error => setSharesError(error instanceof Error ? error.message : String(error))).finally(() => setSharesBusy(''))
                }}>{sharesBusy === shared.id ? 'Revoking…' : 'Revoke'}</Button></div>
            </div>)}</div> : !sharesError && <p>No notes are currently shared.</p>}
          {sharesError && <p className="settings-feedback" role="alert">{sharesError}</p>}
        </section>
        <section className={`settings-section ${section === 'Trash' ? 'active' : ''}`}>
          <h2>TRASH</h2><p>Deleted notes stay here until you restore them or empty the trash.</p>
          {trash.length ? <>
            <div className="trash-list">{trash.map(note => <div className="trash-row" key={note.id}>
              <span><strong>{note.title || 'Untitled'}</strong><small>Deleted {new Date(note.deletedAt!).toLocaleDateString()}</small></span>
              <Button disabled={trashBusy} onClick={() => { void onRestore(note.id).then(restored => {
                setTrashMessage(restored ? 'Note restored.' : 'Could not restore note.')
              }).catch(error => setTrashMessage(String(error))) }}>Restore</Button>
            </div>)}</div>
            <Button className="danger-action" disabled={trashBusy} onClick={() => {
              if (!confirm(`Permanently delete ${trash.length} ${trash.length === 1 ? 'note' : 'notes'} from Trash?`)) return
              setTrashBusy(true); setTrashMessage('')
              void onEmptyTrash().then(count => setTrashMessage(`Permanently deleted ${count} ${count === 1 ? 'note' : 'notes'}.`))
                .catch(error => setTrashMessage(String(error))).finally(() => setTrashBusy(false))
            }}>Empty Trash</Button>
          </> : <p>Trash is empty.</p>}
          {trashMessage && <p className="settings-feedback" role="status">{trashMessage}</p>}
        </section>
        {account?.admin && accountStatus === 'signed-in' && <section className={`settings-section ${section === 'System' ? 'active' : ''}`}>
          <h2>SYSTEM</h2><p>These settings apply to everyone using this Astronote server.</p>
          <label className="settings-check"><Switch aria-label="Enable Account Registration"
            checked={system?.enableAccountRegistration ?? false} disabled={!system || systemBusy}
            onCheckedChange={checked => { void changeRegistration(checked) }} />
            <span><strong>Enable Account Registration</strong><small>Allow new users to create accounts.</small></span></label>
          <hr /><h2>USERS{systemUsers && ` · ${systemUsers.length}`}</h2>
          {systemUsers ? <div className="system-users">{systemUsers.map(user => <div className="system-user" key={user.id}>
            <span className="system-user-email">{user.email}</span>
            <span className="system-user-role">{user.admin ? 'Admin' : 'User'}</span>
            <small>Joined {new Date(user.createdAt).toLocaleDateString()}</small>
          </div>)}</div> : !systemError && <p>Loading Users…</p>}
          {systemError && <p className="settings-feedback" role="alert">{systemError}</p>}
        </section>}
        <section className={`settings-section ${section === 'Shortcuts' ? 'active' : ''}`}><h2>SHORTCUTS</h2><dl className="shortcuts"><dt>Search or Create</dt><dd>⌘K / Ctrl K</dd><dt>Command Palette</dt><dd>⌘⇧O / Ctrl Shift O</dd><dt>New Note</dt><dd>⌘N / Ctrl N</dd><dt>Move Through Results</dt><dd>↑ / ↓</dd><dt>Open or Create Note</dt><dd>Enter</dd><dt>Close Settings or Clear Search</dt><dd>Escape</dd></dl></section>
        <section className={`settings-section ${section === 'About' ? 'active' : ''}`}><h2>ABOUT ASTRONOTE</h2><p>An offline-first place for quickly creating, finding, and editing notes.</p></section>
      </div>
    </div>
  </div>
}

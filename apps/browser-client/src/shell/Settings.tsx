import { useEffect, useRef, useState } from 'react'
import { accentSwatch, usePreferences, type Accent, type Theme } from '../preferences'
import { exportNotes, importNotes, importTextFiles } from '../notes/transfer'
import { deviceStorage, requestPersistentStorage, type DeviceStorage } from '../notes/storage'
import { Button, Switch } from '../design-system'
import { useAccount } from '../account'
import { activeAccountId } from '../notes/local'

type Section = 'Appearance' | 'Editor' | 'Files & Sync' | 'Shortcuts' | 'About'
const sections: Section[] = ['Appearance', 'Editor', 'Files & Sync', 'Shortcuts', 'About']

export function Settings({ mobileLayout, onClose, onNotesImported, onNotesReset }: {
  mobileLayout: boolean; onClose(): void; onNotesImported(): Promise<void>; onNotesReset(): Promise<void> }) {
  const [section, setSection] = useState<Section | null>(mobileLayout ? null : 'Appearance')
  const [message, setMessage] = useState('')
  const [storage, setStorage] = useState<DeviceStorage | null>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const textInput = useRef<HTMLInputElement>(null)
  const resetDialog = useRef<HTMLDialogElement>(null)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')
  const account = useAccount(state => state.account)
  const accountStatus = useAccount(state => state.status)
  const hasAccountNotes = activeAccountId() !== null
  const preferences = usePreferences()
  const { update } = preferences
  useEffect(() => { setSection(mobileLayout ? null : 'Appearance') }, [mobileLayout])
  useEffect(() => { void deviceStorage().then(setStorage) }, [])
  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const count = await importNotes(file)
      await onNotesImported()
      setMessage(`Imported ${count} ${count === 1 ? 'note' : 'notes'} on this device.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed') }
    if (backupInput.current) backupInput.current.value = ''
  }
  const handleTextImport = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      const count = await importTextFiles(files)
      await onNotesImported()
      setMessage(`Imported ${count} ${count === 1 ? 'note' : 'notes'} on this device.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed') }
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
      <nav className={`settings-nav ${section === null ? 'mobile-section-list' : ''}`} aria-label="Settings sections">{sections.map(item =>
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
          <Button onClick={() => backupInput.current?.click()}>Import Backup</Button><input ref={backupInput} type="file" accept="application/json,.json" hidden onChange={event => { void handleImport(event.target.files?.[0]) }} />
          <Button onClick={() => textInput.current?.click()}>Import Markdown/Text Files</Button><input ref={textInput} type="file" accept=".md,.MD,.txt,.TXT" multiple hidden onChange={event => { void handleTextImport(event.target.files) }} /></div>
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
        <section className={`settings-section ${section === 'Shortcuts' ? 'active' : ''}`}><h2>SHORTCUTS</h2><dl className="shortcuts"><dt>Search or Create</dt><dd>⌘K / Ctrl K</dd><dt>New Note</dt><dd>⌘N / Ctrl N</dd><dt>Move Through Results</dt><dd>↑ / ↓</dd><dt>Open Result</dt><dd>Enter</dd><dt>Close Settings or Clear Search</dt><dd>Escape</dd></dl></section>
        <section className={`settings-section ${section === 'About' ? 'active' : ''}`}><h2>ABOUT ASTRONOTE</h2><p>An offline-first place for quickly creating, finding, and editing notes.</p></section>
      </div>
    </div>
  </div>
}

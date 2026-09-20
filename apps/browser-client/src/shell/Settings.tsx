import { useEffect, useRef, useState } from 'react'
import { accentSwatch, usePreferences, type Accent, type Theme } from '../preferences'
import { exportNotes, importNotes } from '../notes/transfer'
import { deviceStorage, requestPersistentStorage, type DeviceStorage } from '../notes/storage'
import { Button, Switch } from '../design-system'

type Section = 'Appearance' | 'Editor' | 'Omnibar' | 'Files & sync' | 'Shortcuts' | 'About'
const sections: Section[] = ['Appearance', 'Editor', 'Omnibar', 'Files & sync', 'Shortcuts', 'About']

export function Settings({ onClose, onNotesImported }: { onClose(): void; onNotesImported(): Promise<void> }) {
  const [section, setSection] = useState<Section>('Appearance')
  const [message, setMessage] = useState('')
  const [storage, setStorage] = useState<DeviceStorage | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const preferences = usePreferences()
  const { update } = preferences
  useEffect(() => { void deviceStorage().then(setStorage) }, [])
  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const count = await importNotes(file)
      await onNotesImported()
      setMessage(`Imported ${count} ${count === 1 ? 'note' : 'notes'} on this device.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed') }
    if (fileInput.current) fileInput.current.value = ''
  }
  return <div className="settings-view">
    <div className="settings-top"><button className="mobile-settings-back" onClick={onClose}>‹ notes</button><span>SETTINGS</span><span>changes save as you make them</span><button onClick={onClose}>ESC to close</button></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{sections.map(item =>
        <button key={item} className={section === item ? 'active' : ''} onClick={() => setSection(item)}>{item}</button>)}</nav>
      <div className="settings-content">
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
          <label className="settings-check"><Switch aria-label="Show note previews" checked={preferences.showPreviews} onCheckedChange={checked => update({ showPreviews: checked })} /><span><strong>Show note previews</strong><small>Display body text beneath each note title.</small></span></label>
          <label className="setting-field">Preview lines <select disabled={!preferences.showPreviews} value={preferences.previewLines}
            onChange={event => update({ previewLines: Number(event.target.value) as 1 | 2 | 3 })}>{[1,2,3].map(n => <option key={n} value={n}>{n} {n === 1 ? 'line' : 'lines'}</option>)}</select></label>
          <label className="setting-field">Sort notes by <select value={preferences.sort}
            onChange={event => update({ sort: event.target.value as 'modified' | 'title' })}><option value="modified">Date modified</option><option value="title">Title</option></select></label>
          <label className="settings-check"><Switch aria-label="Show tags on each row" checked={preferences.showTags} onCheckedChange={checked => update({ showTags: checked })} /><span><strong>Show tags on each row</strong></span></label>
          <hr /><h2>TYPOGRAPHY</h2>
          <label className="setting-field">Editor text size <select value={preferences.textSize} onChange={event => update({ textSize: Number(event.target.value) as 13 | 15 | 17 | 19 })}>{[13,15,17,19].map(n => <option key={n} value={n}>{n} px</option>)}</select></label>
          <label className="setting-field">Line length <select value={preferences.lineLength} onChange={event => update({ lineLength: Number(event.target.value) as 600 | 720 | 840 })}>{[600,720,840].map(n => <option key={n} value={n}>{n} px</option>)}</select></label>
        </section>
        <section className={`settings-section ${section === 'Editor' ? 'active' : ''}`}><h2>EDITOR</h2><p>Write in rich text, or switch to Markdown source at any time. Edits save on this device as you type.</p>
          <label className="setting-field">Default mode <select value={preferences.editorMode} onChange={event => update({ editorMode: event.target.value as 'rich' | 'source' })}><option value="rich">Rich text</option><option value="source">Markdown source</option></select></label>
          <label className="settings-check"><Switch aria-label="Spellcheck" checked={preferences.spellcheck} onCheckedChange={checked => update({ spellcheck: checked })} /><span><strong>Spellcheck</strong></span></label>
        </section>
        <section className={`settings-section ${section === 'Omnibar' ? 'active' : ''}`}><h2>OMNIBAR</h2><p>Search note titles and bodies. Title matches appear first. Press Enter to open a result or create a note.</p></section>
        <section className={`settings-section ${section === 'Files & sync' ? 'active' : ''}`}><h2>FILES &amp; SYNC</h2><p>Your notes are stored on this device and synced with the server when it is reachable. Export a backup before clearing browser data.</p>
          <div className="storage-row"><span>Device storage: {storage?.persistent === true ? 'protected from automatic eviction' : storage?.persistent === false ? 'best effort' : 'unavailable'}
            {storage?.usedBytes != null && ` · about ${(storage.usedBytes / 1024 / 1024).toFixed(1)} MB used`}</span>
            {storage?.persistent === false && <button onClick={() => { void requestPersistentStorage().then(async granted => {
              setStorage(await deviceStorage())
              setMessage(granted ? 'Device storage protection enabled.' : 'Browser did not grant persistent storage. Keep a backup of important notes.')
            }).catch(error => setMessage(String(error))) }}>Protect device storage</button>}</div>
          <div className="backup-actions"><Button onClick={() => { void exportNotes().then(count => setMessage(`Exported ${count} notes.`)).catch(error => setMessage(String(error))) }}>Export backup</Button>
          <Button onClick={() => fileInput.current?.click()}>Import backup</Button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => { void handleImport(event.target.files?.[0]) }} /></div>
          {message && <p role="status">{message}</p>}
        </section>
        <section className={`settings-section ${section === 'Shortcuts' ? 'active' : ''}`}><h2>SHORTCUTS</h2><dl className="shortcuts"><dt>Search or create</dt><dd>⌘K / Ctrl K</dd><dt>New note</dt><dd>⌘N / Ctrl N</dd><dt>Move through results</dt><dd>↑ / ↓</dd><dt>Open result</dt><dd>Enter</dd><dt>Close settings or clear search</dt><dd>Escape</dd></dl></section>
        <section className={`settings-section ${section === 'About' ? 'active' : ''}`}><h2>ABOUT ASTRONOTE</h2><p>An offline-first place for quickly creating, finding, and editing notes.</p></section>
      </div>
    </div>
  </div>
}

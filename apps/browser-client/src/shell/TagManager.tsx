import { useEffect, useRef, useState, type CSSProperties } from 'react'

type TagManagerProps = {
  noteTitle: string
  initialTags: string[]
  onClose: () => void
  onSave: (tags: string[]) => Promise<void>
}

export function TagManager({ noteTitle, initialTags, onClose, onSave }: TagManagerProps) {
  const [tags, setTags] = useState(initialTags)
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [viewport, setViewport] = useState({ top: 0, height: window.innerHeight })
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const visualViewport = window.visualViewport
    const updateViewport = () => setViewport({
      top: visualViewport?.offsetTop ?? 0,
      height: visualViewport?.height ?? window.innerHeight,
    })
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.documentElement.classList.add('tag-manager-open')
    updateViewport()
    input.current?.focus()
    visualViewport?.addEventListener('resize', updateViewport)
    visualViewport?.addEventListener('scroll', updateViewport)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.documentElement.classList.remove('tag-manager-open')
      visualViewport?.removeEventListener('resize', updateViewport)
      visualViewport?.removeEventListener('scroll', updateViewport)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, saving])

  const addTag = () => {
    const tag = tagInput.trim().replace(/^#/, '').toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(tag)) {
      setError('Use 1–50 letters, numbers, underscores, or hyphens.')
      return
    }
    if (tags.includes(tag)) {
      setError('That tag is already on this note.')
      return
    }
    if (tags.length >= 20) {
      setError('A note can have up to 20 tags.')
      return
    }
    setTags(current => [...current, tag])
    setTagInput('')
    setError(null)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(tags)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      setSaving(false)
    }
  }

  const viewportStyle = { top: viewport.top, height: viewport.height } satisfies CSSProperties
  return <>
    <button type="button" className="tag-manager-backdrop" tabIndex={-1} aria-label="Close tag manager"
      onClick={() => { if (!saving) onClose() }} />
    <div className="tag-manager-viewport" style={viewportStyle}>
      <div className="tag-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
        <div className="tag-manager-heading">
          <div><h2 id="tag-manager-title">Manage Tags</h2><small>{noteTitle || 'Untitled'}</small></div>
          <button type="button" aria-label="Close tag manager" disabled={saving} onClick={onClose}>×</button>
        </div>
        <div className="tag-manager-content">
          <div className="tag-manager-tags" aria-label="Tags on this note">
            {tags.map(tag => <span key={tag}>#{tag}<button type="button" aria-label={`Remove ${tag} tag`}
              onClick={() => setTags(current => current.filter(item => item !== tag))}>×</button></span>)}
            {!tags.length && <p>No tags on this note.</p>}
          </div>
          <div className="tag-manager-add">
            <input ref={input} aria-label="Add tag" placeholder="Tag name" value={tagInput}
              onChange={event => { setTagInput(event.target.value); setError(null) }}
              onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTag() } }} />
            <button type="button" disabled={!tagInput.trim()} onClick={addTag}>Add</button>
          </div>
          {error && <p className="tag-manager-error" role="alert">{error}</p>}
        </div>
        <div className="tag-manager-actions">
          <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" className="tag-manager-save" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  </>
}

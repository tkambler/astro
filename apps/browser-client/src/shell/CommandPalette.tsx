import { useEffect, useRef, useState } from 'react'

export type CommandAction = { id: string; label: string; description?: string; run(): void }

/** Searchable keyboard action surface; the shell supplies actions for the current context. */
export function CommandPalette({ actions, onClose }: { actions: CommandAction[]; onClose(): void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const matches = actions.filter(action => `${action.label} ${action.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  useEffect(() => { input.current?.focus() }, [])
  const run = (action: CommandAction) => { onClose(); action.run() }

  return <div className="command-overlay" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command Palette" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(Math.max(0, matches.length - 1), index + 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)) }
      if (event.key === 'Enter' && matches[active]) { event.preventDefault(); run(matches[active]) }
    }}>
      <input ref={input} aria-label="Search commands" placeholder="Search Commands…" value={query}
        onChange={event => { setQuery(event.target.value); setActive(0) }} />
      <div className="command-results" role="listbox" aria-label="Commands">
        {matches.map((action, index) => <button key={action.id} type="button" role="option" aria-selected={index === active}
          onMouseEnter={() => setActive(index)} onClick={() => run(action)}>
          <span>{action.label}</span>{action.description && <small>{action.description}</small>}
        </button>)}
        {!matches.length && <div className="command-empty">No Matching Commands</div>}
      </div>
    </div>
  </div>
}

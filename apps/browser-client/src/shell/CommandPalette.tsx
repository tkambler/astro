import { useEffect, useRef, useState } from 'react'

export type CommandAction = { id: string; label: string; description?: string; run(): void }

/** Searchable keyboard action surface; the shell supplies actions for the current context. */
export function CommandPalette({ actions, onClose }: { actions: CommandAction[]; onClose(): void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [viewport, setViewport] = useState(() => ({ top: window.visualViewport?.offsetTop ?? 0,
    height: window.visualViewport?.height ?? window.innerHeight }))
  const input = useRef<HTMLInputElement>(null)
  const matches = actions.filter(action => `${action.label} ${action.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const visualViewport = window.visualViewport
    if (!visualViewport) return
    const update = () => setViewport({ top: visualViewport.offsetTop, height: visualViewport.height })
    visualViewport.addEventListener('resize', update)
    visualViewport.addEventListener('scroll', update)
    update()
    return () => {
      visualViewport.removeEventListener('resize', update)
      visualViewport.removeEventListener('scroll', update)
    }
  }, [])
  useEffect(() => {
    const preventBackgroundScroll = (event: TouchEvent) => {
      if (!(event.target instanceof Element && event.target.closest('.command-results'))) event.preventDefault()
    }
    document.documentElement.classList.add('command-palette-open')
    document.addEventListener('touchmove', preventBackgroundScroll, { passive: false })
    return () => {
      document.documentElement.classList.remove('command-palette-open')
      document.removeEventListener('touchmove', preventBackgroundScroll)
    }
  }, [])
  const run = (action: CommandAction) => { onClose(); action.run() }

  return <div className="command-overlay" style={{ top: viewport.top, height: viewport.height }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
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

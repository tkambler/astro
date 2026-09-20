import { create } from 'zustand'

export type Theme = 'system' | 'light' | 'dark'
export type Accent = 'cobalt' | 'sage' | 'amber' | 'rose'
export type NoteSort = 'modified' | 'title'
export type SortDirection = 'asc' | 'desc'
export type Preferences = {
  theme: Theme
  accent: Accent
  showPreviews: boolean
  showTags: boolean
  previewLines: 1 | 2 | 3
  sort: NoteSort
  sortDirection: SortDirection
  textSize: 13 | 15 | 17 | 19
  lineLength: 600 | 720 | 840
  editorMode: 'rich' | 'source'
  spellcheck: boolean
}
type Store = Preferences & { update(patch: Partial<Preferences>): void }
const defaults: Preferences = {
  theme: 'system', accent: 'cobalt', showPreviews: true, showTags: true, previewLines: 2,
  sort: 'modified', sortDirection: 'desc', textSize: 15, lineLength: 720, editorMode: 'rich', spellcheck: true,
}
const key = 'astronote-preferences-v1'

function read(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Preferences>
    return { ...defaults, ...saved }
  } catch { return defaults }
}

export const usePreferences = create<Store>(set => ({
  ...read(),
  update(patch) {
    set(state => {
      const next = { ...state, ...patch }
      const { update: _update, ...values } = next
      localStorage.setItem(key, JSON.stringify(values))
      return next
    })
  },
}))

const colors = {
  cobalt: { light: '#1f5fd0', dark: '#86b2ff', swatch: '#2f6ee0' },
  sage: { light: '#338469', dark: '#86c8a8', swatch: '#7fc3a4' },
  amber: { light: '#9b650e', dark: '#e7b752', swatch: '#e0a02f' },
  rose: { light: '#aa493d', dark: '#e49b8e', swatch: '#d2705f' },
} satisfies Record<Accent, { light: string; dark: string; swatch: string }>

/** Applies device preferences to CSS variables without requiring a network connection. */
export function applyPreferences(preferences: Preferences) {
  const root = document.documentElement
  if (preferences.theme === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = preferences.theme
  const dark = preferences.theme === 'dark' ||
    (preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const color = colors[preferences.accent][dark ? 'dark' : 'light']
  root.style.setProperty('--accent', color)
  root.style.setProperty('--accent-hover', color)
  root.style.setProperty('--accent-tint', `color-mix(in srgb, ${color} 8%, transparent)`)
  root.style.setProperty('--accent-tint-strong', `color-mix(in srgb, ${color} 14%, transparent)`)
  root.style.setProperty('--accent-selection', `color-mix(in srgb, ${color} 22%, transparent)`)
  root.style.setProperty('--accent-border', `color-mix(in srgb, ${color} 28%, transparent)`)
  root.style.setProperty('--editor-size', `${preferences.textSize}px`)
  root.style.setProperty('--editor-length', `${preferences.lineLength}px`)
  root.style.setProperty('--preview-lines', String(preferences.previewLines))
}

export function accentSwatch(accent: Accent) { return colors[accent].swatch }

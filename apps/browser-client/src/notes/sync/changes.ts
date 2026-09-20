/** The stream only signals that a normal cursor pull should run. */
export function watchRemoteChanges(onChange: () => void) {
  const source = new EventSource('/api/notes/stream')
  source.addEventListener('changed', onChange)
  source.addEventListener('open', onChange)
  return () => source.close()
}

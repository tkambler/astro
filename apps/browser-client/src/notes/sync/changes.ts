/** A socket hint runs the normal cursor sync. Reconnecting also catches missed changes. */
export function watchRemoteChanges(onChange: () => void, onSessionExpired: () => void) {
  let socket: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let delay = 1_000
  let stopped = false
  let checkedFailedHandshake = false
  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/notes/socket`

  const connect = () => {
    if (stopped || !navigator.onLine || socket) return
    const next = new WebSocket(url)
    let connected = false
    socket = next
    next.onmessage = event => {
      try {
        const message = JSON.parse(event.data) as { type?: string }
        if (message.type === 'ready') {
          connected = true
          checkedFailedHandshake = false
          delay = 1_000
          onChange()
        }
        else if (message.type === 'changed') onChange()
      } catch { /* Ignore unexpected messages. */ }
    }
    next.onclose = event => {
      if (socket !== next) return
      socket = null
      if (stopped) return
      if (event.code === 4001 || (!connected && !checkedFailedHandshake && navigator.onLine)) {
        checkedFailedHandshake = true
        onSessionExpired()
        if (event.code === 4001) return
      }
      if (navigator.onLine) {
        retry = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30_000)
      }
    }
  }
  const online = () => { clearTimeout(retry); connect() }
  const offline = () => { clearTimeout(retry); socket?.close(); socket = null }
  const visible = () => {
    if (document.visibilityState !== 'visible') return
    if (socket?.readyState === WebSocket.OPEN) onChange()
    else { clearTimeout(retry); connect() }
  }
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  document.addEventListener('visibilitychange', visible)
  connect()
  return () => {
    stopped = true
    clearTimeout(retry)
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
    document.removeEventListener('visibilitychange', visible)
    socket?.close()
    socket = null
  }
}

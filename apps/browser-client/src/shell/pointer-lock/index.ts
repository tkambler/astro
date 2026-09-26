const activeModalSurface = ':modal, [data-state="open"][role="dialog"], [data-state="open"][role="listbox"], [data-state="open"][role="menu"]'

/** Restores app input if a third-party modal surface leaves its global body lock behind. */
export function installPointerLockRecovery() {
  const recover = () => {
    if (document.body.style.pointerEvents !== 'none' || document.querySelector(activeModalSurface)) return
    document.body.style.removeProperty('pointer-events')
  }
  const scheduleRecovery = () => queueMicrotask(recover)
  const observer = new MutationObserver(scheduleRecovery)
  observer.observe(document.body, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true })
  const visible = () => { if (document.visibilityState === 'visible') recover() }
  window.addEventListener('pageshow', recover)
  document.addEventListener('visibilitychange', visible)
  recover()
  return () => {
    observer.disconnect()
    window.removeEventListener('pageshow', recover)
    document.removeEventListener('visibilitychange', visible)
  }
}

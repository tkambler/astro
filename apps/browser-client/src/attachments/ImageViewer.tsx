import { useEffect, useRef, useState } from 'react'
import type { Attachment } from '@astronote/schemas'
import { attachmentResponse } from './content'

/** Displays verified attachment content without exposing cache or object-URL details to consumers. */
export function ImageViewer({ attachment, onClose, onAvailable }: {
  attachment: Attachment | null
  onClose: () => void
  onAvailable: (id: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!attachment) return
    let active = true
    let objectUrl = ''
    setSource('')
    setError('')
    dialog.current?.showModal()
    void attachmentResponse(attachment).then(async response => {
      objectUrl = URL.createObjectURL(await response.blob())
      if (!active) { URL.revokeObjectURL(objectUrl); return }
      setSource(objectUrl)
      onAvailable(attachment.id)
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment, onAvailable])

  if (!attachment) return null
  return <dialog ref={dialog} className="attachment-viewer" aria-labelledby="attachment-viewer-title"
    onClose={onClose} onCancel={onClose}
    onClick={event => { if (event.target === dialog.current) dialog.current.close() }}>
    <div className="attachment-viewer-frame">
      <header><strong id="attachment-viewer-title" title={attachment.filename}>{attachment.filename}</strong>
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close image viewer">×</button></header>
      <div className="attachment-viewer-canvas">
        {!source && !error && <span role="status">Loading image…</span>}
        {error && <span className="attachment-viewer-error" role="alert">{error}</span>}
        {source && <img src={source} alt={attachment.filename} />}
      </div>
    </div>
  </dialog>
}

import { useEffect, useMemo, useState } from 'react'
import { MDXEditor, headingsPlugin, listsPlugin, linkPlugin, codeBlockPlugin, codeMirrorPlugin,
  quotePlugin, frontmatterPlugin, tablePlugin, thematicBreakPlugin, imagePlugin } from '@mdxeditor/editor'
import type { PublicNote } from '@astronote/schemas'
import { loadPublicNote } from './index'
import { embeddedImageId } from '../attachments'

function sharedPlugins(shareId: string) {
  return [headingsPlugin(), listsPlugin(), linkPlugin(), codeBlockPlugin(),
    codeMirrorPlugin({ codeBlockLanguages: { bash: 'Bash', sh: 'Shell', text: 'Plain text' } }), quotePlugin(), frontmatterPlugin(), tablePlugin(), thematicBreakPlugin(),
    imagePlugin({ disableImageResize: true, disableImageSettingsButton: true,
      imagePreviewHandler: async source => {
        const attachmentId = embeddedImageId(source)
        if (!attachmentId) throw new Error('External images are not displayed.')
        return `/api/shared/${encodeURIComponent(shareId)}/attachments/${encodeURIComponent(attachmentId)}/content`
      } })]
}

/** Anonymous, read-only presentation for a single shared note. */
export function SharedNote({ id }: { id: string }) {
  const [note, setNote] = useState<PublicNote | null>(null)
  const [error, setError] = useState('')
  const plugins = useMemo(() => sharedPlugins(id), [id])
  useEffect(() => {
    let active = true
    void loadPublicNote(id).then(value => { if (active) setNote(value) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load shared note') })
    return () => { active = false }
  }, [id])
  return <main className="shared-note">
    <header><a href="/">ASTRONOTE</a></header>
    {error ? <div className="shared-note-state" role="alert">{error}</div>
      : note ? <article><h1>{note.title || 'Untitled'}</h1><div className="shared-note-content">
        <MDXEditor markdown={note.body} plugins={plugins} readOnly
          onError={({ error: markdownError }) => setError(`Could not render shared note: ${markdownError}`)} />
      </div></article>
      : <div className="shared-note-state">Loading shared note…</div>}
  </main>
}

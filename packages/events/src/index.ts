import Emittery from 'emittery'

export type ApplicationEvents = {
  'sync.completed': { pushed: number; pulled: number }
  'sync.failed': { message: string }
  'attachment.created': { accountId: string; noteId: string; attachmentId: string; byteSize: number }
  'attachment.deleted': { accountId: string; attachmentId: string }
  'attachment.failed': { accountId?: string; message: string }
}
export const events = new Emittery<ApplicationEvents>()

import Emittery from 'emittery'

export type ApplicationEvents = {
  'sync.completed': { pushed: number; pulled: number }
  'sync.failed': { message: string }
  'notes.changed': { accountId: string }
}
export const events = new Emittery<ApplicationEvents>()

import type { Express } from 'express'
import { getSystemSettings, setAccountRegistration, listSystemUsers, SystemAccessDeniedError } from '@astronote/domain'
import { systemSettings } from '@astronote/schemas'
import { requireAccount } from '../account/index.js'

/** Server routes expose settings only to administrators; the domain checks again on writes. */
export function mountSystemRoutes(app: Express) {
  app.use('/api/system', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
  app.get('/api/system/settings', async (request, response) => {
    try {
      const actor = await requireAccount(request, response)
      if (!actor) return
      if (!actor.admin) return response.status(403).json({ error: 'Administrator access required' })
      return response.json(await getSystemSettings())
    } catch { return response.status(500).json({ error: 'Could not load system settings' }) }
  })
  app.get('/api/system/users', async (request, response) => {
    try {
      const actor = await requireAccount(request, response)
      if (!actor) return
      return response.json({ users: await listSystemUsers(actor.id) })
    } catch (error) {
      if (error instanceof SystemAccessDeniedError) return response.status(403).json({ error: 'Administrator access required' })
      return response.status(500).json({ error: 'Could not load users' })
    }
  })
  app.put('/api/system/settings', async (request, response) => {
    try {
      const actor = await requireAccount(request, response)
      if (!actor) return
      const parsed = systemSettings.safeParse(request.body)
      if (!parsed.success) return response.status(400).json({ error: 'Invalid system settings' })
      return response.json(await setAccountRegistration(actor.id, parsed.data.enableAccountRegistration))
    } catch (error) {
      if (error instanceof SystemAccessDeniedError) return response.status(403).json({ error: 'Administrator access required' })
      return response.status(500).json({ error: 'Could not update system settings' })
    }
  })
}

import express, { type Express } from 'express'
import { createCollection, listCollections } from '@astronote/domain'
import { collection, collectionList } from '@astronote/schemas'
import { requireAccount } from '../account/index.js'

/** Mounts the explicit collection catalog used to sync empty collections. */
export function mountCollectionRoutes(app: Express) {
  app.get('/api/collections', async (request, response) => {
    const current = await requireAccount(request, response)
    if (!current) return
    try { return response.json(collectionList.parse(await listCollections(current.id))) }
    catch { return response.status(500).json({ error: 'Could not load collections' }) }
  })
  app.post('/api/collections', express.json({ limit: '2kb' }), async (request, response) => {
    const current = await requireAccount(request, response)
    if (!current) return
    const parsed = collection.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'Invalid collection' })
    try { return response.status(201).json(collection.parse(await createCollection(current.id, parsed.data.name))) }
    catch { return response.status(500).json({ error: 'Could not create collection' }) }
  })
}

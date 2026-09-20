import express, { type Express } from 'express'
import { fileURLToPath } from 'node:url'

const assetsUrl = new URL(import.meta.url.endsWith('.ts')
  ? '../../../browser-client/dist/'
  : '../../browser-client/dist/', import.meta.url)
const assets = fileURLToPath(assetsUrl)
const index = fileURLToPath(new URL('index.html', assetsUrl))

export function mountFrontend(app: Express) {
  app.use(express.static(assets, {
    index: false,
    setHeaders(response, path) {
      if (path.includes('/assets/')) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      else response.setHeader('Cache-Control', 'no-cache')
    },
  }))
  app.get(/.*/, (request, response, next) => {
    if (!request.accepts('html')) return next()
    response.setHeader('Cache-Control', 'no-cache')
    response.sendFile(index)
  })
}

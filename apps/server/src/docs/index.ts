import type { Express } from 'express'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createOpenApiDocument } from './openapi.js'
export { createOpenApiDocument } from './openapi.js'

const swaggerUi = dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'))
const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Astronote API</title>
  <link rel="stylesheet" href="/api/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/swagger-ui-bundle.js"></script>
  <script src="/api/docs/initializer.js"></script>
</body>
</html>`
// "Try it out" runs same-origin, so the session cookie rides along; the interceptor adds the CSRF header writes need.
const initializer = `window.ui = SwaggerUIBundle({
  url: '/api/openapi.json', dom_id: '#swagger-ui', deepLinking: true,
  requestInterceptor: request => { request.headers['x-astronote-request'] = '1'; return request },
})`

/** Serves the OpenAPI document at /api/openapi.json and a self-hosted Swagger UI at /api/docs. */
export function mountApiDocs(app: Express, options: { sessionCookie: string }) {
  const document = createOpenApiDocument(options)
  app.get('/api/openapi.json', (_request, response) => response.json(document))
  app.get('/api/docs', (_request, response) => response.type('html').set('Cache-Control', 'no-cache').send(page))
  app.get('/api/docs/initializer.js', (_request, response) => response.type('js').set('Cache-Control', 'no-cache').send(initializer))
  for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js'])
    app.get(`/api/docs/${asset}`, (_request, response) => response.sendFile(join(swaggerUi, asset), { maxAge: '1d' }))
}

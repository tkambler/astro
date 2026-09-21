import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createOpenApiDocument } from '../src/docs/index.js'

const source = new URL('../src/', import.meta.url)
const document = createOpenApiDocument({ sessionCookie: 'astronote_dev' })
const documented = new Set(Object.entries(document.paths).flatMap(([path, operations]) =>
  Object.keys(operations).map(method => `${method.toUpperCase()} ${path}`)))
// The docs module's own routes, and the WebSocket upgrade handled outside Express, are listed here by hand.
const undocumented = new Set(['GET /api/openapi.json', 'GET /api/docs', 'GET /api/docs/initializer.js', 'GET /api/docs/${asset}'])
const upgrades = new Set(['GET /api/notes/socket'])

function mountedRoutes() {
  const files = readdirSync(source, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.ts'))
  return files.flatMap(file => [...readFileSync(new URL(file, source), 'utf8')
    .matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*[`'"](\/api[^`'"]*)[`'"]/g)]
    .map(([, method, path]) => `${method!.toUpperCase()} ${path!.replaceAll(/:(\w+)/g, '{$1}')}`))
    .filter(route => !undocumented.has(route))
}

test('every mounted /api route is documented in the OpenAPI document', () => {
  const missing = mountedRoutes().filter(route => !documented.has(route))
  assert.deepEqual(missing, [], 'Document these routes in apps/server/src/docs/openapi.ts')
})

test('every documented operation is mounted', () => {
  const mounted = new Set([...mountedRoutes(), ...upgrades])
  assert.deepEqual([...documented].filter(route => !mounted.has(route)), [], 'Remove stale operations from apps/server/src/docs/openapi.ts')
})

test('every schema reference resolves', () => {
  const refs = JSON.stringify(document).matchAll(/"\$ref":"#\/components\/(\w+)\/(\w+)"/g)
  const components = document.components as Record<string, Record<string, unknown>>
  for (const [, kind, id] of refs) assert.ok(components[kind!]?.[id!], `Unresolved reference #/components/${kind}/${id}`)
})

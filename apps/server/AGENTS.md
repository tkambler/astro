# Server

Express app that serves the REST API under `/api` and the built browser client at `/`. Each business area mounts its own routes from a module (`account`, `notes`, `shares`, `system`); `src/index.ts` only composes them.

# API documentation

`src/docs` owns the API's public description:

- `src/docs/openapi.ts` builds the OpenAPI 3.1 document. Component schemas are generated from the Zod schemas in `@astronote/schemas` with `z.toJSONSchema`, so they cannot drift from validation. Request schemas go in `requestModels` (converted as Zod *input*, i.e. before transforms); response schemas go in `responseModels` (converted as Zod *output*).
- `src/docs/index.ts` serves the document at `GET /api/openapi.json` and a self-hosted Swagger UI (from `swagger-ui-dist`, no CDN) at `GET /api/docs`.

**Keep the document current.** Whenever you change the API, update `src/docs/openapi.ts` in the same change:

- New route: add an operation under `paths` with a unique `operationId`, a tag, a summary, its parameters, its request body, and every status code the handler can return. Express `:param` segments are written `{param}`.
- Non-GET routes: wrap the operation in `write(...)` so it declares the required `x-astronote-request` header and its 403 response.
- Anonymous routes: spread `anonymous` so they override the default session-cookie security.
- New request or response shape: define it in `@astronote/schemas` (per the root AGENTS.md conventions) and register it in `requestModels` or `responseModels`, then reference it with `ref('Name')`. Use hand-written JSON Schema only for small envelopes such as `{ shares: [...] }`.
- Removed or renamed route: remove or rename its operation.
- Changed status codes, headers, query parameters, or behaviour worth knowing: update the operation's responses, parameters, and description.

`test/openapi.test.ts` (run by `npm test` at the repo root) scans `src` for `app.get|post|put|patch|delete('/api/...')` and fails when a mounted route is undocumented, a documented operation is not mounted, or a `$ref` does not resolve. It cannot check response shapes or status codes; you are responsible for those. Routes registered some other way (for example the `/api/notes/socket` WebSocket upgrade) must be added to the test's `upgrades` or `undocumented` lists by hand.

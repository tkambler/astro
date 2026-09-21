import { z } from 'zod'
import { account, accountPreferences, credentials, note, noteMutation, noteShare, publicNote, pullResult,
  pushRequest, pushResult, recoveryRequest, shareId, systemSettings, systemUser } from '@astronote/schemas'

type Schema = Record<string, unknown>
type Operation = Schema & { responses: Record<string, Schema> }

// Request bodies describe what clients send (before Zod transforms); responses describe what the server returns.
const requestModels = z.registry<{ id: string }>()
requestModels.add(credentials, { id: 'Credentials' })
requestModels.add(recoveryRequest, { id: 'RecoveryRequest' })
requestModels.add(noteMutation, { id: 'NoteMutation' })
requestModels.add(pushRequest, { id: 'PushRequest' })
const responseModels = z.registry<{ id: string }>()
responseModels.add(note, { id: 'Note' })
responseModels.add(pullResult, { id: 'PullResult' })
responseModels.add(pushResult, { id: 'PushResult' })
responseModels.add(noteShare, { id: 'NoteShare' })
responseModels.add(publicNote, { id: 'PublicNote' })
responseModels.add(account, { id: 'Account' })
responseModels.add(accountPreferences, { id: 'AccountPreferences' })
responseModels.add(systemSettings, { id: 'SystemSettings' })
responseModels.add(systemUser, { id: 'SystemUser' })

const withoutDialect = ({ $schema: _, $id: __, ...schema }: Schema) => schema

function components(registry: typeof requestModels, io: 'input' | 'output') {
  const { schemas } = z.toJSONSchema(registry, { io, uri: id => `#/components/schemas/${id}` })
  return Object.fromEntries(Object.entries(schemas).map(([id, schema]) => [id, withoutDialect(schema)]))
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` })
const object = (properties: Record<string, Schema>) =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const json = (description: string, schema: Schema) => ({ description, content: { 'application/json': { schema } } })
const body = (schema: Schema) => ({ required: true, content: { 'application/json': { schema } } })
const error = (description: string) => json(description, ref('Error'))
const noContent = { description: 'No content' }
const parameter = (id: string) => ({ $ref: `#/components/parameters/${id}` })
const anonymous = { security: [] }
const signedIn = { 401: error('Not signed in') }
const failed = { 500: error('Unexpected server error') }
const generation = object({ generation: { type: 'integer', minimum: 0 } })
const recoveryCode = { type: 'string', description: 'Shown once; store it to recover the account.' }

/** Writes (non-GET) must carry the CSRF header; GET routes must not declare it. */
function write(operation: Operation): Operation {
  return { ...operation, parameters: [parameter('AstronoteRequest'), ...(operation.parameters as Schema[] ?? [])],
    responses: { 403: error('Missing x-astronote-request header, or the action is forbidden'), ...operation.responses } }
}

const paths: Record<string, Record<string, Operation>> = {
  '/api/health': {
    get: { operationId: 'getHealth', tags: ['System'], summary: 'Health check', ...anonymous,
      responses: { 200: json('Server is running', object({ ok: { const: true } })) } },
  },
  '/api/account': {
    get: { operationId: 'getAccount', tags: ['Account'], summary: 'Current account', ...anonymous,
      responses: { 200: json('The signed-in account, or null', object({ account: { anyOf: [ref('Account'), { type: 'null' }] } })), ...failed } },
  },
  '/api/account/registration': {
    get: { operationId: 'getRegistration', tags: ['Account'], summary: 'Whether new accounts may register', ...anonymous,
      responses: { 200: json('Registration settings', ref('SystemSettings')), ...failed } },
  },
  '/api/account/register': {
    post: write({ operationId: 'register', tags: ['Account'], summary: 'Register and sign in', ...anonymous, requestBody: body(ref('Credentials')),
      responses: { 201: json('Account created; the session cookie is set', object({ account: ref('Account'), recoveryCode })),
        400: error('Invalid credentials'), 409: error('Account already exists'), 429: error('Too many attempts'), ...failed } }),
  },
  '/api/account/login': {
    post: write({ operationId: 'login', tags: ['Account'], summary: 'Sign in', ...anonymous, requestBody: body(ref('Credentials')),
      responses: { 200: json('Signed in; the session cookie is set', object({ account: ref('Account') })),
        400: error('Invalid credentials'), 401: error('Invalid credentials'), 429: error('Too many attempts'), ...failed } }),
  },
  '/api/account/recover': {
    post: write({ operationId: 'recoverAccount', tags: ['Account'], summary: 'Reset the password with a recovery code', ...anonymous, requestBody: body(ref('RecoveryRequest')),
      responses: { 200: json('Recovered and signed in; a new recovery code replaces the used one', object({ account: ref('Account'), recoveryCode })),
        400: error('Invalid recovery details'), 401: error('Invalid recovery details'), 429: error('Too many attempts'), ...failed } }),
  },
  '/api/account/recovery-code': {
    post: write({ operationId: 'rotateRecoveryCode', tags: ['Account'], summary: 'Replace the recovery code',
      responses: { 200: json('New recovery code', object({ recoveryCode })), ...signedIn, ...failed } }),
  },
  '/api/account/preferences': {
    get: { operationId: 'getPreferences', tags: ['Account'], summary: 'Synced preferences',
      responses: { 200: json('Saved preferences, or null when none are saved', object({ preferences: { anyOf: [ref('AccountPreferences'), { type: 'null' }] } })),
        ...signedIn, ...failed } },
    put: write({ operationId: 'setPreferences', tags: ['Account'], summary: 'Save synced preferences', requestBody: body(ref('AccountPreferences')),
      responses: { 204: noContent, 400: error('Invalid preferences'), ...signedIn, ...failed } }),
  },
  '/api/account/logout': {
    post: write({ operationId: 'logout', tags: ['Account'], summary: 'Sign out', ...anonymous, responses: { 204: noContent } }),
  },
  '/api/notes': {
    delete: write({ operationId: 'resetNotes', tags: ['Notes'], summary: 'Delete every note and start a new generation',
      description: 'Other devices receive 409 from the sync endpoints until they adopt the new generation.',
      responses: { 200: json('The new note generation', generation), ...signedIn, ...failed } }),
  },
  '/api/notes/state': {
    get: { operationId: 'getNoteState', tags: ['Notes'], summary: 'Current note generation',
      responses: { 200: json('The current note generation', generation), ...signedIn, ...failed } },
  },
  '/api/notes/changes': {
    get: { operationId: 'pullNotes', tags: ['Notes'], summary: 'Pull changes after a cursor',
      parameters: [{ name: 'cursor', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }, parameter('AstronoteGeneration')],
      responses: { 200: json('A page of changed notes; repeat with the returned cursor while hasMore is true', ref('PullResult')),
        400: error('Invalid cursor or note generation'), 409: error('Notes were reset on another device'), ...signedIn, ...failed } },
  },
  '/api/notes/push': {
    post: write({ operationId: 'pushNotes', tags: ['Notes'], summary: 'Push a batch of note mutations', parameters: [parameter('AstronoteGeneration')],
      requestBody: body(ref('PushRequest')),
      responses: { 200: json('One result per mutation: applied, or conflict with the server copy', ref('PushResult')),
        400: error('Invalid note generation or mutations'), 409: error('Notes were reset on another device'),
        413: error('Request exceeds the size limit'), ...signedIn, ...failed } }),
  },
  '/api/notes/socket': {
    get: { operationId: 'watchNotes', tags: ['Notes'], summary: 'Realtime change hints (WebSocket)',
      description: 'Upgrade to a same-origin WebSocket. The server sends `{"type":"ready"}` once connected and `{"type":"changed"}` when '
        + 'this account\'s notes change; clients then pull `/api/notes/changes`. The socket is read-only: any client message closes it.',
      responses: { 101: { description: 'Switching protocols' }, 401: { description: 'Not signed in' },
        403: { description: 'Cross-origin request' }, 503: { description: 'Change feed unavailable' } } },
  },
  '/api/shares': {
    get: { operationId: 'listShares', tags: ['Shares'], summary: 'List shared links',
      responses: { 200: json('Shared links for this account', object({ shares: { type: 'array', items: ref('NoteShare') } })), ...signedIn, ...failed } },
    post: write({ operationId: 'createShare', tags: ['Shares'], summary: 'Share a note publicly', requestBody: body(object({ noteId: { type: 'string', format: 'uuid' } })),
      responses: { 201: json('The shared link', ref('NoteShare')), 404: error('Note not found'), ...signedIn, ...failed } }),
  },
  '/api/shares/{id}': {
    delete: write({ operationId: 'deleteShare', tags: ['Shares'], summary: 'Revoke a shared link', parameters: [parameter('ShareId')],
      responses: { 204: noContent, 404: error('Shared link not found'), ...signedIn, ...failed } }),
  },
  '/api/shared/{id}': {
    get: { operationId: 'getSharedNote', tags: ['Shares'], summary: 'Read a shared note', ...anonymous, parameters: [parameter('ShareId')],
      responses: { 200: json('The shared note', ref('PublicNote')), 404: error('Shared note not found'), ...failed } },
  },
  '/api/system/settings': {
    get: { operationId: 'getSystemSettings', tags: ['System'], summary: 'System settings (administrators)',
      responses: { 200: json('System settings', ref('SystemSettings')), ...signedIn, 403: error('Administrator access required'), ...failed } },
    put: write({ operationId: 'setSystemSettings', tags: ['System'], summary: 'Update system settings (administrators)', requestBody: body(ref('SystemSettings')),
      responses: { 200: json('Updated system settings', ref('SystemSettings')), 400: error('Invalid system settings'), ...signedIn, ...failed } }),
  },
  '/api/system/users': {
    get: { operationId: 'listUsers', tags: ['System'], summary: 'List accounts (administrators)',
      responses: { 200: json('Every account', object({ users: { type: 'array', items: ref('SystemUser') } })),
        ...signedIn, 403: error('Administrator access required'), ...failed } },
  },
}

/** Builds the OpenAPI description of every `/api` route. The session cookie name differs between environments. */
export function createOpenApiDocument(options: { sessionCookie: string }) {
  return {
    openapi: '3.1.0',
    info: { title: 'Astronote API', version: '1.0.0',
      description: 'REST API behind the Astronote browser client. Authentication uses an HttpOnly session cookie set by the '
        + 'register, login, and recover endpoints. Every non-GET request must send `x-astronote-request: 1`.' },
    servers: [{ url: '/' }],
    tags: [
      { name: 'Account', description: 'Registration, sessions, recovery, and synced preferences' },
      { name: 'Notes', description: 'Offline-first note sync: pull changes by cursor, push batched mutations' },
      { name: 'Shares', description: 'Public read-only links to individual notes' },
      { name: 'System', description: 'Health and administrator settings' },
    ],
    security: [{ session: [] }],
    paths,
    components: {
      securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: options.sessionCookie } },
      parameters: {
        AstronoteRequest: { name: 'x-astronote-request', in: 'header', required: true,
          description: 'Required on every non-GET request (CSRF protection).', schema: { type: 'string', enum: ['1'], default: '1' } },
        AstronoteGeneration: { name: 'x-astronote-generation', in: 'header',
          description: 'The note generation the client last synced; see `GET /api/notes/state`.', schema: { type: 'integer', minimum: 0, default: 0 } },
        ShareId: { name: 'id', in: 'path', required: true, schema: withoutDialect(z.toJSONSchema(shareId)) },
      },
      schemas: {
        ...components(requestModels, 'input'),
        ...components(responseModels, 'output'),
        Error: object({ error: { description: 'A message, or flattened validation issues', anyOf: [{ type: 'string' }, { type: 'object' }] } }),
      },
    },
  }
}

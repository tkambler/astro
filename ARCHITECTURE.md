# Astronote Architecture

Astronote is an offline-first monorepo. The React browser client owns the live working copy of a user's notes, while the Express API, domain packages, and PostgreSQL provide authenticated synchronization, sharing, and durable remote storage. The server also serves the production frontend so the application and API share one origin.

The browser stores notes and pending edits directly in IndexedDB. A service worker precaches the app shell, one-time legacy migration assets, and local font files so the app can reopen offline after its first successful load. The open app retries synchronization after edits, on reconnect, and when the server signals a change through an authenticated WebSocket. Reopening the socket reconciles changes missed while disconnected.

## Development

1. Use Node 24 or newer, and install Docker.
2. Run `npm install` and `npm run dev`. The command starts an isolated PostgreSQL container on a free localhost port and applies migrations. To use an existing PostgreSQL database instead, set `DATABASE_URL` before running it.
3. Open `http://localhost:3001`. The API server serves the built frontend and `/api/...` on this port. Interactive API documentation is at `http://localhost:3001/api/docs`; the raw OpenAPI document is at `/api/openapi.json`.

Stop the local database with `docker compose -f docker-compose.dev.yml down`. Its notes remain in a dedicated Docker volume for the next run.

`npm run dev` builds the frontend once, then starts the API server in watch mode. Frontend changes require `npm run build` and a browser refresh; the API server serves the updated files without a restart. The offline service worker may need one more refresh to activate the new build.

For a production build, run `npm run build`, apply migrations with `npm run migrate -w @astronote/db`, then start the server with `NODE_ENV=production npm run start -w @astronote/server`.

## Testing

Run `npm test` for package typechecks, API documentation coverage, frontmatter parsing, local storage behavior, and sync batch selection tests.

With `DATABASE_URL` pointed at a disposable PostgreSQL database, run `npm run test:integration` to migrate it and verify account isolation, sync revisions, attachments, batches, retries, tags, timestamps, and tombstones.

To test realtime delivery, start two API instances against the same disposable database on separate ports. Set `TEST_SERVER_A` and `TEST_SERVER_B` to their origins, then run `node --test apps/server/test/realtime.test.ts`. The test checks authenticated, account-scoped WebSocket hints across instances and cursor catch-up on reconnect.

## Production containers

Build the production image with `docker build -t astronote .`. Provide an external PostgreSQL database and start the container with:

```sh
docker run --rm -p 3001:3001 \
  -v astronote_attachments:/data/attachments \
  -e DATABASE_URL='postgres://user:password@database-host:5432/astronote' \
  astronote
```

The container applies database migrations before starting the server. It serves the frontend and REST API from port 3001. Put an HTTPS reverse proxy in front of that port for PWA installation, offline caching, and secure session cookies. If that proxy is trusted, set `TRUST_PROXY_HOPS` to its hop count so login rate limiting uses the client IP. Leave it at the default `0` when the container receives requests directly.

For a single-host deployment, `docker-compose.yml` includes PostgreSQL, the app, and Caddy. Copy `.env.example` to `.env`, set `APP_DOMAIN` to a public DNS name pointing at the host, and set a long URL-safe `POSTGRES_PASSWORD`. Open ports 80 and 443, then run `docker compose up --build -d`. Caddy obtains and renews the HTTPS certificate. Only Caddy publishes ports.

PostgreSQL data, attached files, and Caddy certificates are stored in named volumes. Back up the PostgreSQL and attachment volumes together. The app's startup command applies migrations before it accepts requests.

The service worker is installed in a production build. Test offline reload from `http://localhost:3001` after loading the page once while online.

The hosted instance has a separate procedure in [DEPLOYMENT.md](DEPLOYMENT.md).

## Modules

| Module | Owns | Public API | Private details |
| --- | --- | --- | --- |
| `packages/schemas` | Wire contracts | Validated note, push, and pull schemas and inferred types | Zod declarations |
| `packages/db` | PostgreSQL connection, migrations, and change notifications | `database()`, `publishNoteChange()`, `watchNoteChanges()` | Tables, migration runner, notification channel, and reconnecting listener; only `domain` consumes this package |
| `packages/domain/notes` | Server note revisions, change feed, account reset generation, and change notifications | `pushNotes`, `pullNotes`, `noteGeneration`, `resetNotes`, `watchNoteChanges` through `domain` root | Transaction locking, idempotency, deletion, notifications, and row mapping |
| `packages/domain/attachments` | Note-owned file metadata and immutable content | Attachment catalog, upload, download, deletion, and storage preparation through `domain` root | Filesystem paths, streaming, hashing, limits, and orphan cleanup |
| `packages/domain/accounts` | Account credentials, recovery, sessions, and attempt limits | Registration, authentication, recovery code rotation, password recovery, session lookup and revocation through `domain` root | Password and code hashing, PostgreSQL counters, and session token hashes |
| `apps/browser-client/src/notes/local` | Device note database and pending edits | `listNotes`, `saveNote`, `pendingMutations`, `receiveNote`, acknowledgements | IndexedDB stores, transactions, and legacy PGlite migration |
| `apps/browser-client/src/notes/content` | Structure and sidebar text for note bodies | `splitFrontmatter(body)`, `notePreview(body)` | Frontmatter delimiters and preview cleanup |
| `apps/browser-client/src/notes/sync` | Transfer of pending edits, server changes, and account resets | `syncNotes()`, `watchRemoteChanges()`, `resetAllNotes()` | Batch sizing, reset coordination, HTTP, WebSocket reconnection, and cursor traversal |
| `apps/server/src/notes` | Authenticated note API and change notification | `mountNoteRoutes()`, `mountNoteSockets()` | Routes, request limits, reset generation checks, and account-scoped sockets |
| `apps/browser-client/src/notes/transfer` | Portable note transfers | `exportNotes()`, `importNotes(file)`, `importTextFiles(files)` | Backup validation, frontmatter parsing, and downloads |
| `apps/browser-client/src/notes/storage` | Device storage retention | `deviceStorage()`, `requestPersistentStorage()` | Browser StorageManager calls |
| `apps/browser-client/src/notes/state` | UI note state | `useNotes` | Refresh and connectivity triggers |
| `apps/browser-client/src/attachments` | Adjacent note files, embedded note images, and device cache | Attachment catalog, stable `attachment:` image references, verified content resolution, and responsive shelf | Cache keys, temporary object URLs, transfer progress, desktop rail, mobile bottom sheet, and image viewer |
| `apps/browser-client/src/preferences` | Device appearance and note list choices | `usePreferences`, `applyPreferences` | Storage key, accent palette, and defaults |
| `apps/browser-client/src/account` | Browser account connection | `useAccount` | Login requests and local workspace selection |
| `apps/server/src/account` | HTTP account boundary | `mountAccountRoutes`, `requireAccount` | Cookies, rate limiting, and account endpoint handling |
| `apps/server/src/frontend` | Built frontend delivery | `mountFrontend(app)` | Asset location, cache headers, and page fallback; consumers use its public entry point |
| `apps/browser-client/src/design-system` | Reusable controls styled with Astronote tokens | `Button`, `Input`, `Switch` | Radix primitives, variants, and focus styling |
| `apps/browser-client/src/shell` | Search, editing, settings, and responsive layout | `App` | MDXEditor, settings screens, and design styles |

Consumers should use each module's public entry point and avoid descending into its implementation. Within `notes/local`, `index.ts` is the public API; `documents.ts` owns local note reads and writes, `sync-state.ts` owns pending mutations and acknowledgements, and `workspace.ts` owns account selection. `database.ts` privately owns the IndexedDB schema and transactions, while `legacy-migration.ts` is a private, one-time worker for importing and then removing the former PGlite store. Consumers should never descend into either implementation.

The design-system module owns the source-controlled shadcn-style controls so screens share interaction and focus behavior without duplicating it. The service worker owns static application assets. This keeps note writes available without a network request.

## Offline storage and synchronization

Sync sends independent pending notes in batches of up to 25, within the request size limit, and shows batch progress in the status bar. Each mutation carries its client mutation ID and expected server revision. The server applies a batch in one transaction, records applied IDs for safe retries, and keeps tombstones in its change feed.

On revision conflict, the browser creates a local ` (conflict copy)` note containing the latest local text, then adopts the server version in one device transaction. PostgreSQL notifications reach every API instance; each forwards account-scoped WebSocket hints to its connected browsers. Note contents continue to travel over REST only when an edit, hint, reconnection, or explicit sync calls for it. There is no recurring 30-second pull.

Search and tag filtering run over the active workspace loaded from IndexedDB. Search covers titles, bodies, and tags, with title matches ranked first; the list can be sorted by modification time or title. Appearance, list, and editor preferences are stored on the device.

Browser storage may be evicted by the operating system. The Files & sync screen can request persistent storage, and JSON backups remain useful for important notes. Existing server notes created before the account migration have no owner and are not returned by the authenticated API; export them from a browser that still has a local copy, then import after signing in.

## Import, export, and note content

In Settings → Files & sync, users can import UTF-8 `.md` or `.txt` files as new notes. YAML frontmatter can supply `title`, `tags`, `createdAt`, and `updatedAt`; otherwise the filename supplies the title. The file contents, including frontmatter, remain in the note body. Imports are saved on the device first and sync when an account is connected and the server is reachable.

Sidebar previews omit a leading YAML frontmatter block while note bodies and exports preserve it. The content module owns this shared frontmatter boundary so the import parser and sidebar use the same definition; callers use its public functions without depending on the delimiter expression.

Files & sync settings can export and import a portable JSON backup, including tags, without contacting the server. An import creates new note IDs in one local transaction; those notes sync after a connection returns.

## Attachments

Signed-in users can attach up to 20 files of 25 MB each to a note while connected. Files sit beside the note in a desktop rail or a mobile bottom sheet. PNG, JPEG, GIF, WebP, and AVIF attachments can be viewed in the app or embedded through stable `attachment:<uuid>` Markdown references; temporary browser URLs never enter note content.

Opening or displaying a file verifies and caches it on that device, so cached files and images remain available offline while attachment changes require a connection. Shared notes resolve embedded images only through the owning share. Portable JSON backups include an attachment inventory but not the file bytes, so a complete server backup requires PostgreSQL and the attachment volume.

## Reset behavior

Files & sync has a dangerous Reset all notes action with a confirmation dialog. For a signed-in account it requires a server connection, permanently deletes that account's notes, attachments, and change history, then clears that account's notes and attachment cache on this device. Guest reset clears only this device's guest notes.

Other devices clear their cached copies when they next sync; a reset generation blocks stale offline devices from uploading old notes afterward. Export a backup first if the notes might be needed again.

## Editor and request limits

The editor offers rich text, Markdown source, and a read-only diff against the last server-acknowledged title and body. The diff baseline stays on the device, so it also works for unsynced offline edits.

A push request has a 52 MB JSON body limit; the client keeps batches below 51 MiB. A note above that limit remains on the device, stays pending, and displays a sync error until it is shortened.

## Accounts and security

Guest notes stay on the device until an account is connected. Registering or signing in moves guest notes into that account as new pending notes with new IDs in one device transaction. The server scopes all note reads and writes by account.

Sessions use an HttpOnly, SameSite=Strict cookie; production requires HTTPS and `NODE_ENV=production` for the Secure flag. The browser stores only the account ID locally, never the session token. Signing out hides that account's device notes while keeping them available after signing back in. An offline sign-out hides them immediately and queues server session revocation for the next connection; account checks wait for that revocation before resuming.

Registration displays a recovery code once. The user must save it outside Astronote. A signed-in user can rotate the code; the old code then stops working. Password recovery consumes the saved code, revokes every previous session, and displays a replacement code. Recovery does not require an email delivery service, but losing both the password and the current code leaves no account recovery path.

Authentication attempts are limited in PostgreSQL across API instances to 20 per client IP in 15 minutes.

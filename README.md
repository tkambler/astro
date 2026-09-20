# Astronote

An offline-first note app. The browser stores notes and pending edits in PGlite's IndexedDB-backed PostgreSQL database. The service worker precaches the app shell, bundled database assets, and local font files, so the app can reopen offline after its first successful load. The open app retries sync on reconnect, on a 30-second interval, and after edits.

## Run locally

1. Use Node 24 or newer. Start PostgreSQL and create an empty `astronote` database.
2. Set `DATABASE_URL`, for example `postgres://localhost:5432/astronote`.
3. Run `npm install`, `npm run migrate -w @astronote/db`, and `npm run dev`.
4. Open `http://localhost:3001`. The API server serves the built frontend and `/api/...` on this port.

`npm run dev` builds the frontend once, then starts the API server in watch mode. Frontend changes require `npm run build` and a browser refresh; the API server serves the updated files without a restart. The offline service worker may need one more refresh to activate the new build.

For a production build, run `npm run build`, then start the server with `NODE_ENV=production npm run start -w @astronote/server`. The server serves the built frontend at `/` and all REST endpoints at `/api/...` on the same port. Run database migrations first with `npm run migrate -w @astronote/db`.

## Docker production image

Build with `docker build -t astronote .`. Provide an external PostgreSQL database and start the container with `docker run --rm -p 3001:3001 -e DATABASE_URL='postgres://user:password@database-host:5432/astronote' astronote`. The container applies database migrations before starting the server. It serves the frontend and REST API from port 3001. Put an HTTPS reverse proxy in front of that port for PWA installation, offline caching, and secure session cookies. If that proxy is trusted, set `TRUST_PROXY_HOPS` to its hop count so login rate limiting uses the client IP. Leave it at the default `0` when the container receives requests directly.

For a single-host deployment, `docker-compose.yml` includes PostgreSQL, the app, and Caddy. Copy `.env.example` to `.env`, set `APP_DOMAIN` to a public DNS name pointing at the host, and set a long URL-safe `POSTGRES_PASSWORD`. Open ports 80 and 443, then run `docker compose up --build -d`. Visit `https://<APP_DOMAIN>`; Caddy obtains and renews its HTTPS certificate. Only Caddy publishes ports. PostgreSQL data and Caddy certificates are stored in named volumes. Back up the PostgreSQL volume regularly. The app's startup command applies migrations before it accepts requests.

The service worker is installed in a production build. Test offline reload from `http://localhost:3001` after loading the page once while online.

Run `npm test` for package typechecks. With `DATABASE_URL` pointed at a disposable PostgreSQL database, run `npm run test:integration` to migrate it and verify account isolation, sync revisions, retries, tags, and tombstones.

## Modules

| Module | Owns | Public API | Private details |
| --- | --- | --- | --- |
| `packages/schemas` | Wire contracts | Validated note, push, and pull schemas and inferred types | Zod declarations |
| `packages/db` | PostgreSQL connection and migrations | `database()` | Tables and migration runner; consumers should not descend into it except `domain` |
| `packages/domain/notes` | Server note revisions and change feed | `pushNotes`, `pullNotes` through `domain` root | Transaction locking, idempotency, and row mapping |
| `packages/domain/accounts` | Account credentials, recovery, sessions, and attempt limits | Registration, authentication, recovery code rotation, password recovery, session lookup and revocation through `domain` root | Password and code hashing, PostgreSQL counters, and session token hashes |
| `apps/browser-client/src/notes/local` | Device note database and pending edits | `listNotes`, `saveNote`, `pendingMutations`, `receiveNote`, acknowledgements | PGlite worker, SQL, and IndexedDB naming |
| `apps/browser-client/src/notes/sync` | Transfer of pending edits and server changes | `syncNotes()` | HTTP and cursor traversal |
| `apps/browser-client/src/notes/transfer` | Portable note backups | `exportNotes()`, `importNotes(file)` | Backup format validation and downloads |
| `apps/browser-client/src/notes/storage` | Device storage retention | `deviceStorage()`, `requestPersistentStorage()` | Browser StorageManager calls |
| `apps/browser-client/src/notes/state` | UI note state | `useNotes` | Refresh and connectivity triggers |
| `apps/browser-client/src/preferences` | Device appearance and note list choices | `usePreferences`, `applyPreferences` | Storage key, accent palette, and defaults |
| `apps/browser-client/src/account` | Browser account connection | `useAccount` | Login requests and local workspace selection |
| `apps/server/src/account` | HTTP account boundary | `mountAccountRoutes`, `requireAccount` | Cookies, rate limiting, and account endpoint handling |
| `apps/server/src/frontend` | Built frontend delivery | `mountFrontend(app)` | Asset location, cache headers, and page fallback; consumers use its public entry point |
| `apps/browser-client/src/design-system` | Reusable controls styled with Astronote tokens | `Button`, `Input`, `Switch` | Radix primitives, variants, and focus styling |
| `apps/browser-client/src/shell` | Search, editing, settings, and responsive layout | `App` | MDXEditor, settings screens, and design styles |

Consumers should use each module's public entry point and avoid descending into its implementation. Within `notes/local`, `index.ts` is the public API; `documents.ts` owns local note reads and writes, `sync-state.ts` owns pending mutations and acknowledgements, `workspace.ts` owns account selection, and `database.ts` and `worker.ts` keep the PGlite setup private. The design-system module owns the source-controlled shadcn-style controls so screens share interaction and focus behavior without duplicating it. The service worker owns static application assets; the PGlite worker owns note data. This keeps note writes available without a network request.

Sync applies mutations in order with a client mutation ID and expected server revision. The server records applied IDs for safe retries and keeps tombstones in its change feed. On revision conflict, the browser creates a local ` (conflict copy)` note containing the latest local text, then adopts the server version in one device transaction. The conflict copy syncs as a new note.

Search and tag filtering run in the local database. Search covers titles, bodies, and tags, with title matches ranked first; the list can be sorted by modification time or title. Appearance, list, and editor preferences are stored on the device. Files & sync settings can export and import a portable JSON backup, including tags, without contacting the server. An import creates new note IDs in one local transaction; those notes sync after a connection returns.

The editor offers rich text, Markdown source, and a read-only diff against the last server-acknowledged title and body. The diff baseline stays on the device, so it also works for unsynced offline edits. Each note syncs in its own request with a 52 MB JSON body limit. A note above that limit remains on the device, stays pending, and displays a sync error until it is shortened.

Guest notes stay on the device until an account is connected. Registering or signing in moves guest notes into that account as new pending notes with new IDs in one device transaction. The server scopes all note reads and writes by account. Sessions use an HttpOnly, SameSite=Strict cookie; production requires HTTPS and `NODE_ENV=production` for the Secure flag. The browser stores only the account ID locally, never the session token. Signing out hides that account's device notes while keeping them available after signing back in. An offline sign-out hides them immediately and queues server session revocation for the next connection; account checks wait for that revocation before resuming.

Registration displays a recovery code once. Save it outside Astronote. A signed-in user can rotate the code; the old code then stops working. Password recovery consumes the saved code, revokes every previous session, and displays a replacement code. Recovery does not require an email delivery service, but losing both the password and the current code leaves no account recovery path. Authentication attempts are limited in PostgreSQL across API instances to 20 per client IP in 15 minutes.

Browser storage may be evicted by the operating system. The Files & sync screen can request persistent storage, and JSON backups remain useful for important notes. Existing server notes created before the account migration have no owner and are not returned by the authenticated API; export them from a browser that still has a local copy, then import after signing in.

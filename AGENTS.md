# Project Overview

This project is "Astronote" - a web-based application for managing notes. It is, in many ways, reminiscent of Notational Velocity and nValt in that it prioritizes quick information creation, search, and retrieval.

This repository contains a monorepo (managed via
[Turborepo](https://turborepo.dev/docs)) that contains several packages
/ apps. Some important examples include:

- ./apps/browser-client - React app that provides the browser-based UI. It uses: React, TypeScript, Zustand, Shadcn/ui
- ./apps/server - Express-based REST API used by the React app.
- ./packages/db - All DB logic lives here (including migration scripts, seed data, etc...). We use PostgreSQL and the [knex](https://knexjs.org/) library.
- ./packages/domain - All server-side business logic lives here, grouped by business domain. This is the only package that uses ./packages/db.
- ./packages/schemas - All shared data validation lives here. We use [Zod](https://zod.dev), and export an inferred TypeScript type alongside every validation function. Validator function names always begin with a lower-case letter. The corresponding TypeScript type always uses Pascal case.
- ./packages/events - Server-side library responsible for emitting events whenever anything of interest occurs. It uses the "Emittery" library and is well-typed.
- ./packages/log - Shared pino instance for server-side logging. Nothing logs directly. Instead, events are emitted via. the `events` package. Logic lives there for logging (when appropriate). Logs are always printed to the console (not prettified). In development mode, logs are also saved to a git ignored `logs` folder.

This app prioritizes the ability to function off-line. The app should remain *fully functional* when used offline.

# Architectural Philosophy

The directory tree is **part of the architecture**, not merely storage.

Treat directories, modules, and package boundaries as first-class
architectural decisions.

Organize code so that important concepts are encapsulated within nested
modules or packages exposing small, intention-revealing APIs.

Readers should normally understand a module from its public API without
reading its implementation.

Internal complexity should remain private.

Prefer:

System → Domain → Sub-domain → Implementation

over flat collections of unrelated files.

The directory tree should communicate the mental model of the system.

Avoid organizing primarily by technical artifact (`utils`, `helpers`,
`services`, `models`, `types`) unless those are genuine architectural
concepts.

Prefer organization around responsibilities and bounded contexts.

Whenever proposing a module:

- explain why it exists
- describe the concept it owns
- define its public API
- identify what remains private
- explain whether consumers should ever descend into it

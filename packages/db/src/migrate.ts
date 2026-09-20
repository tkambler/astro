import { database } from './index.js'
import * as notes from './migrations/202609200001_notes.js'
import * as accounts from './migrations/202609200002_accounts.js'
import * as tags from './migrations/202609200003_tags.js'
import * as authenticationLimits from './migrations/202609200004_authentication_limits.js'
import * as recoveryCodes from './migrations/202609200005_recovery_codes.js'

const migrations = { '202609200001_notes': notes, '202609200002_accounts': accounts,
  '202609200003_tags': tags, '202609200004_authentication_limits': authenticationLimits,
  '202609200005_recovery_codes': recoveryCodes }

const db = database()
try {
  await db.migrate.latest({ migrationSource: {
    getMigrations: async () => Object.keys(migrations),
    getMigrationName: migration => migration as string,
    getMigration: async migration => migrations[migration as keyof typeof migrations],
  } })
} finally {
  await db.destroy()
}

import { database } from './index.js'
import * as notes from './migrations/202609200001_notes.js'
import * as accounts from './migrations/202609200002_accounts.js'
import * as tags from './migrations/202609200003_tags.js'
import * as authenticationLimits from './migrations/202609200004_authentication_limits.js'
import * as recoveryCodes from './migrations/202609200005_recovery_codes.js'
import * as noteCreatedAt from './migrations/202609200006_note_created_at.js'
import * as noteResetGeneration from './migrations/202609200007_note_reset_generation.js'
import * as pinned from './migrations/202609200008_pinned.js'
import * as purged from './migrations/202609200009_purged.js'
import * as system from './migrations/202609200010_system.js'
import * as accountPreferences from './migrations/202609200011_account_preferences.js'

const migrations = { '202609200001_notes': notes, '202609200002_accounts': accounts,
  '202609200003_tags': tags, '202609200004_authentication_limits': authenticationLimits,
  '202609200005_recovery_codes': recoveryCodes, '202609200006_note_created_at': noteCreatedAt,
  '202609200007_note_reset_generation': noteResetGeneration, '202609200008_pinned': pinned,
  '202609200009_purged': purged, '202609200010_system': system,
  '202609200011_account_preferences': accountPreferences }

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

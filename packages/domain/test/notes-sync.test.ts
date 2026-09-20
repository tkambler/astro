import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { database } from '@astronote/db'
import { accountForSession, authenticateAccount, createSession, endSession,
  authenticationAttemptAllowed, pullNotes, pushNotes, recoverAccount, registerAccount,
  rotateRecoveryCode } from '../src/index.js'
import { recoveryRequest } from '@astronote/schemas'

after(async () => { await database().destroy() })

test('notes sync is revisioned, idempotent, tagged, and account scoped', async () => {
  const suffix = crypto.randomUUID()
  const credentials = { email: `sync-${suffix}@example.test`, password: 'test-password-long-enough' }
  const first = await registerAccount(credentials)
  const second = await registerAccount({ ...credentials, email: `other-${suffix}@example.test` })
  assert.equal((await authenticateAccount(credentials))?.id, first.id)
  assert.equal(await authenticateAccount({ ...credentials, password: 'incorrect-password-123' }), null)
  const token = await createSession(first.id)
  assert.equal((await accountForSession(token))?.id, first.id)

  const noteId = crypto.randomUUID()
  const initial = { mutationId: crypto.randomUUID(), id: noteId, baseRevision: 0,
    title: 'Example', body: 'First body', tags: ['work'],
    createdAt: '2021-02-03T00:00:00.000Z', updatedAt: '2022-05-06T15:30:00.000Z', deleted: false }
  const created = (await pushNotes(first.id, [initial])).results[0]
  assert.equal(created?.status, 'applied')
  if (created?.status !== 'applied') return
  assert.equal(created.note.revision, 1)
  assert.deepEqual(created.note.tags, ['work'])
  assert.equal(created.note.createdAt, initial.createdAt)
  assert.equal(created.note.updatedAt, initial.updatedAt)

  const retried = (await pushNotes(first.id, [initial])).results[0]
  assert.equal(retried?.status, 'applied')
  assert.equal((await pullNotes(second.id, 0)).changes.length, 0)
  const stale = (await pushNotes(first.id, [{ ...initial, mutationId: crypto.randomUUID(), body: 'Stale body' }])).results[0]
  assert.equal(stale?.status, 'conflict')

  const updated = (await pushNotes(first.id, [{ ...initial, mutationId: crypto.randomUUID(),
    baseRevision: 1, body: 'Second body', tags: ['work', 'ideas'] }])).results[0]
  assert.equal(updated?.status, 'applied')
  if (updated?.status === 'applied') assert.equal(updated.note.createdAt, initial.createdAt)
  const lateRetry = (await pushNotes(first.id, [initial])).results[0]
  assert.equal(lateRetry?.status, 'conflict')
  const page = await pullNotes(first.id, 0)
  assert.equal(page.changes.length, 2)
  assert.deepEqual(page.changes[0]?.tags, ['work', 'ideas'])

  const deleted = (await pushNotes(first.id, [{ ...initial, mutationId: crypto.randomUUID(),
    baseRevision: 2, deleted: true }])).results[0]
  assert.equal(deleted?.status, 'applied')
  const tombstone = await pullNotes(first.id, page.cursor)
  assert.equal(tombstone.changes[0]?.id, noteId)
  assert.ok(tombstone.changes[0]?.deletedAt)

  await endSession(token)
  assert.equal(await accountForSession(token), null)
})

test('authentication limit is atomic across concurrent attempts and resets after its window', async () => {
  const source = `integration:${crypto.randomUUID()}`
  const decisions = await Promise.all(Array.from({ length: 25 }, () => authenticationAttemptAllowed(source)))
  assert.equal(decisions.filter(Boolean).length, 20)
  assert.equal(decisions.filter(value => !value).length, 5)
  await database()('authentication_limits').update({ reset_at: new Date(0) })
  assert.equal(await authenticationAttemptAllowed(source), true)
})

test('recovery codes are single use and password recovery revokes old sessions', async () => {
  const email = `recovery-${crypto.randomUUID()}@example.test`
  const oldPassword = 'original-password-long'
  const nextPassword = 'replacement-password-long'
  const registered = await registerAccount({ email, password: oldPassword })
  const previousSession = await createSession(registered.id)
  const request = recoveryRequest.parse({ email, recoveryCode: registered.recoveryCode, password: nextPassword })
  assert.equal(await recoverAccount({ ...request, recoveryCode: '0'.repeat(48) }), null)
  const attempts = await Promise.all([recoverAccount(request), recoverAccount(request)])
  const recovered = attempts.filter(result => result !== null)
  assert.equal(recovered.length, 1)
  assert.notEqual(recovered[0]!.recoveryCode, registered.recoveryCode)
  assert.equal(await accountForSession(previousSession), null)
  assert.equal(await authenticateAccount({ email, password: oldPassword }), null)
  assert.equal((await authenticateAccount({ email, password: nextPassword }))?.id, registered.id)
  assert.equal(await recoverAccount(request), null)
  const replacementCode = await rotateRecoveryCode(registered.id)
  assert.notEqual(replacementCode, recovered[0]!.recoveryCode)
  assert.equal(await recoverAccount(recoveryRequest.parse({ email,
    recoveryCode: recovered[0]!.recoveryCode, password: oldPassword })), null)
})

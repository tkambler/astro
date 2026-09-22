import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { database } from '@astronote/db'
import { accountForSession, authenticateAccount, createSession, endSession,
  authenticationAttemptAllowed, noteGeneration, NoteGenerationMismatchError, pullNotes, pushNotes,
  recoverAccount, registerAccount, resetNotes, rotateRecoveryCode, getSystemSettings,
  setAccountRegistration, listSystemUsers, RegistrationDisabledError, SystemAccessDeniedError,
  getAccountPreferences, setAccountPreferences } from '../src/index.js'
import { createNoteShare, deleteNoteShare, getPublicNote, listNoteShares } from '../src/index.js'
import { recoveryRequest } from '@astronote/schemas'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAttachment, attachmentContent, deleteAttachment, listAttachments,
  sharedAttachmentContent, AttachmentLimitError } from '../src/index.js'

after(async () => { await database().destroy() })

test('the first account is admin and controls registration', async () => {
  const registrations = await Promise.all(Array.from({ length: 2 }, () => registerAccount({
    email: `bootstrap-${crypto.randomUUID()}@example.test`, password: 'test-password-long-enough',
  })))
  assert.equal(registrations.filter(item => item.admin).length, 1)
  const admin = registrations.find(item => item.admin)!
  const member = registrations.find(item => !item.admin)!
  assert.equal((await authenticateAccount({ email: admin.email, password: 'test-password-long-enough' }))?.admin, true)
  const session = await createSession(admin.id)
  assert.equal((await accountForSession(session))?.admin, true)
  await assert.rejects(listSystemUsers(member.id), SystemAccessDeniedError)
  const users = await listSystemUsers(admin.id)
  assert.deepEqual(users.map(user => user.id).sort(), registrations.map(user => user.id).sort())
  assert.equal(users.find(user => user.id === admin.id)?.admin, true)
  assert.ok(users.every(user => !('password_hash' in user) && !('recovery_code_hash' in user)))
  assert.ok(users.every(user => Number.isFinite(Date.parse(user.createdAt))))
  assert.deepEqual(await getSystemSettings(), { enableAccountRegistration: true })
  await assert.rejects(setAccountRegistration(member.id, false), SystemAccessDeniedError)
  await setAccountRegistration(admin.id, false)
  assert.deepEqual(await getSystemSettings(), { enableAccountRegistration: false })
  await assert.rejects(registerAccount({ email: `blocked-${crypto.randomUUID()}@example.test`,
    password: 'test-password-long-enough' }), RegistrationDisabledError)
  await setAccountRegistration(admin.id, true)
  assert.equal((await registerAccount({ email: `allowed-${crypto.randomUUID()}@example.test`,
    password: 'test-password-long-enough' })).admin, false)
})

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
  const initial = { mutationId: crypto.randomUUID(), id: noteId, collection: 'Notes', baseRevision: 0,
    title: 'Example', body: 'First body', tags: ['work'],
    createdAt: '2021-02-03T00:00:00.000Z', updatedAt: '2022-05-06T15:30:00.000Z', deleted: false }
  const created = (await pushNotes(first.id, [initial])).results[0]
  assert.equal(created?.status, 'applied')
  if (created?.status !== 'applied') return
  assert.equal(created.note.revision, 1)
  assert.deepEqual(created.note.tags, ['work'])
  assert.equal(created.note.pinned, false)
  assert.equal(created.note.createdAt, initial.createdAt)
  assert.equal(created.note.updatedAt, initial.updatedAt)

  const retried = (await pushNotes(first.id, [initial])).results[0]
  assert.equal(retried?.status, 'applied')
  assert.equal((await pullNotes(second.id, 0)).changes.length, 0)
  const stale = (await pushNotes(first.id, [{ ...initial, mutationId: crypto.randomUUID(), body: 'Stale body' }])).results[0]
  assert.equal(stale?.status, 'conflict')

  const updated = (await pushNotes(first.id, [{ ...initial, mutationId: crypto.randomUUID(),
    baseRevision: 1, body: 'Second body', tags: ['work', 'ideas'], pinned: true }])).results[0]
  assert.equal(updated?.status, 'applied')
  if (updated?.status === 'applied') assert.equal(updated.note.pinned, true)
  if (updated?.status === 'applied') assert.equal(updated.note.createdAt, initial.createdAt)
  const lateRetry = (await pushNotes(first.id, [initial])).results[0]
  assert.equal(lateRetry?.status, 'conflict')
  const page = await pullNotes(first.id, 0)
  assert.equal(page.changes.length, 2)
  assert.deepEqual(page.changes[0]?.tags, ['work', 'ideas'])
  assert.equal(page.changes[0]?.pinned, true)

  const legacyUpdate = (await pushNotes(first.id, [{ ...initial, mutationId: crypto.randomUUID(),
    baseRevision: 2, body: 'Older client edit' }])).results[0]
  assert.equal(legacyUpdate?.status, 'applied')
  if (legacyUpdate?.status === 'applied') assert.equal(legacyUpdate.note.pinned, true)

  const deleted = (await pushNotes(first.id, [{ ...initial, mutationId: crypto.randomUUID(),
    baseRevision: 3, deleted: true }])).results[0]
  assert.equal(deleted?.status, 'applied')
  const tombstone = await pullNotes(first.id, page.cursor)
  assert.equal(tombstone.changes[0]?.id, noteId)
  assert.ok(tombstone.changes[0]?.deletedAt)

  await endSession(token)
  assert.equal(await accountForSession(token), null)
})

test('account preferences persist independently for each account', async () => {
  const first = await registerAccount({ email: `preferences-${crypto.randomUUID()}@example.test`,
    password: 'test-password-long-enough' })
  const second = await registerAccount({ email: `preferences-${crypto.randomUUID()}@example.test`,
    password: 'test-password-long-enough' })
  const preferences = { theme: 'dark' as const, accent: 'sage' as const, showPreviews: false,
    showTags: true, previewLines: 3 as const, sort: 'title' as const, sortDirection: 'asc' as const,
    textSize: 17 as const, lineLength: 840 as const, editorMode: 'source' as const, spellcheck: false }
  assert.equal(await getAccountPreferences(first.id), null)
  await setAccountPreferences(first.id, preferences)
  assert.deepEqual(await getAccountPreferences(first.id), preferences)
  assert.equal(await getAccountPreferences(second.id), null)
})

test('note shares are account scoped, public, current, and revocable', async () => {
  const owner = await registerAccount({ email: `shares-${crypto.randomUUID()}@example.test`,
    password: 'test-password-long-enough' })
  const stranger = await registerAccount({ email: `shares-${crypto.randomUUID()}@example.test`,
    password: 'test-password-long-enough' })
  const noteId = crypto.randomUUID()
  const initial = { mutationId: crypto.randomUUID(), id: noteId, collection: 'Notes', baseRevision: 0,
    title: 'Public title', body: 'First public body', tags: [], deleted: false }
  await pushNotes(owner.id, [initial])
  assert.equal(await createNoteShare(stranger.id, noteId), null)
  const shared = await createNoteShare(owner.id, noteId)
  assert.ok(shared)
  assert.match(shared.id, /^[A-Za-z0-9_-]{22}$/)
  assert.equal((await createNoteShare(owner.id, noteId))?.id, shared.id)
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => createNoteShare(owner.id, noteId)))
  assert.deepEqual(new Set(concurrent.map(item => item?.id)), new Set([shared.id]))
  assert.deepEqual((await listNoteShares(owner.id)).map(item => item.id), [shared.id])
  assert.deepEqual(await listNoteShares(stranger.id), [])
  assert.equal((await getPublicNote(shared.id))?.body, initial.body)
  await pushNotes(owner.id, [{ ...initial, mutationId: crypto.randomUUID(), baseRevision: 1, body: 'Updated public body' }])
  assert.equal((await getPublicNote(shared.id))?.body, 'Updated public body')
  assert.equal(await deleteNoteShare(stranger.id, shared.id), false)
  assert.ok(await getPublicNote(shared.id))
  assert.equal(await deleteNoteShare(owner.id, shared.id), true)
  assert.equal(await getPublicNote(shared.id), null)
})

test('attachments are immutable, account scoped, limited, and removed with a purged note', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astronote-attachments-'))
  const previous = process.env.ATTACHMENT_STORAGE_PATH
  process.env.ATTACHMENT_STORAGE_PATH = directory
  try {
    const owner = await registerAccount({ email: `attachments-${crypto.randomUUID()}@example.test`,
      password: 'test-password-long-enough' })
    const stranger = await registerAccount({ email: `attachments-${crypto.randomUUID()}@example.test`,
      password: 'test-password-long-enough' })
    const noteId = crypto.randomUUID()
    const original = { mutationId: crypto.randomUUID(), id: noteId, collection: 'Notes', baseRevision: 0,
      title: 'With files', body: '', tags: [], deleted: false }
    await pushNotes(owner.id, [original])
    async function * bytes(value: string) { yield new TextEncoder().encode(value) }
    const created = await createAttachment(owner.id, noteId, 'résumé.txt', 'text/plain', bytes('hello'))
    assert.equal(created.byteSize, 5)
    assert.equal(created.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    assert.deepEqual((await listAttachments(owner.id, noteId))?.map(item => item.id), [created.id])
    assert.equal(await listAttachments(stranger.id, noteId), null)
    assert.equal(await attachmentContent(stranger.id, created.id), null)
    const content = await attachmentContent(owner.id, created.id)
    assert.ok(content)
    let downloaded = ''
    for await (const chunk of content!.stream) downloaded += chunk.toString()
    assert.equal(downloaded, 'hello')
    const share = await createNoteShare(owner.id, noteId)
    assert.ok(share)
    const publicContent = await sharedAttachmentContent(share.id, created.id)
    assert.ok(publicContent)
    assert.equal((await sharedAttachmentContent(share.id, crypto.randomUUID())), null)
    assert.equal((await sharedAttachmentContent('not-a-share', created.id)), null)
    let publicDownload = ''
    for await (const chunk of publicContent!.stream) publicDownload += chunk.toString()
    assert.equal(publicDownload, 'hello')
    assert.equal(await deleteNoteShare(owner.id, share.id), true)
    assert.equal(await sharedAttachmentContent(share.id, created.id), null)
    for (let index = 1; index < 20; index++) await createAttachment(owner.id, noteId, `file-${index}.txt`, 'text/plain', bytes(''))
    await assert.rejects(createAttachment(owner.id, noteId, 'one-too-many.txt', 'text/plain', bytes('')), AttachmentLimitError)
    assert.equal(await deleteAttachment(stranger.id, created.id), false)
    await pushNotes(owner.id, [{ ...original, mutationId: crypto.randomUUID(), baseRevision: 1, deleted: true, purged: true }])
    assert.equal(await listAttachments(owner.id, noteId), null)
    await assert.rejects(access(join(directory, created.id)))
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENT_STORAGE_PATH
    else process.env.ATTACHMENT_STORAGE_PATH = previous
    await rm(directory, { recursive: true, force: true })
  }
})

test('a batch applies independent notes atomically and preserves mutation order', async () => {
  const registered = await registerAccount({ email: `batch-${crypto.randomUUID()}@example.test`,
    password: 'test-password-long-enough' })
  const mutations = Array.from({ length: 25 }, (_, index) => ({ mutationId: crypto.randomUUID(),
    id: crypto.randomUUID(), collection: 'Notes', baseRevision: 0, title: `Batch ${index}`, body: '', tags: [], deleted: false }))
  const result = await pushNotes(registered.id, mutations)
  assert.deepEqual(result.results.map(item => item.mutationId), mutations.map(item => item.mutationId))
  assert.ok(result.results.every(item => item.status === 'applied'))
  const page = await pullNotes(registered.id, 0)
  assert.equal(page.changes.length, mutations.length)
  assert.deepEqual(page.changes.map(note => note.id), mutations.map(item => item.id))
  assert.ok((await pushNotes(registered.id, mutations)).results.every(item => item.status === 'applied'))
  assert.equal((await pullNotes(registered.id, 0)).changes.length, mutations.length)
})

test('deleted notes can be restored and purged without allowing stale content to return', async () => {
  const user = await registerAccount({ email: `trash-${crypto.randomUUID()}@example.test`,
    password: 'test-password-long-enough' })
  const initial = { mutationId: crypto.randomUUID(), id: crypto.randomUUID(), collection: 'Notes', baseRevision: 0,
    title: 'To delete', body: 'Private content', tags: ['private'], deleted: false }
  const apply = async (baseRevision: number, changes: Partial<typeof initial> & { purged?: boolean }) => {
    const result = (await pushNotes(user.id, [{ ...initial, ...changes,
      mutationId: crypto.randomUUID(), baseRevision }])).results[0]
    assert.equal(result?.status, 'applied')
    if (result?.status !== 'applied') throw new Error('Expected applied mutation')
    return result.note
  }
  await apply(0, {})
  const deleted = await apply(1, { deleted: true })
  assert.ok(deleted.deletedAt)
  const restored = await apply(2, { deleted: false })
  assert.equal(restored.deletedAt, null)
  const deletedAgain = await apply(3, { deleted: true })
  assert.ok(deletedAgain.deletedAt)
  const purged = await apply(4, { deleted: true, purged: true })
  assert.equal(purged.purged, true)
  assert.equal(purged.title, '')
  assert.equal(purged.body, '')
  assert.deepEqual(purged.tags, [])
  const pulled = (await pullNotes(user.id, 0)).changes.at(-1)
  assert.equal(pulled?.purged, true)
  assert.equal(pulled?.body, '')
  const resurrection = (await pushNotes(user.id, [{ ...initial, mutationId: crypto.randomUUID(),
    baseRevision: 5 }])).results[0]
  assert.equal(resurrection?.status, 'conflict')
})

test('reset removes only one account and rejects stale device uploads', async () => {
  const first = await registerAccount({ email: `reset-${crypto.randomUUID()}@example.test`, password: 'test-password-long-enough' })
  const second = await registerAccount({ email: `keep-${crypto.randomUUID()}@example.test`, password: 'test-password-long-enough' })
  const mutation = () => ({ mutationId: crypto.randomUUID(), id: crypto.randomUUID(), collection: 'Notes', baseRevision: 0,
    title: 'Stored note', body: 'Private body', tags: [], deleted: false })
  const old = mutation()
  const other = mutation()
  await pushNotes(first.id, [old])
  await pushNotes(second.id, [other])
  assert.equal(await noteGeneration(first.id), 0)
  assert.equal(await resetNotes(first.id), 1)
  assert.equal(await noteGeneration(first.id), 1)
  assert.deepEqual((await pullNotes(first.id, 0)).changes, [])
  assert.equal((await pullNotes(second.id, 0)).changes.length, 1)
  for (const table of ['notes', 'note_changes', 'note_mutations']) {
    const rows = await database()(table).where({ user_id: first.id }).count<{ count: string }[]>('* as count')
    assert.equal(Number(rows[0]?.count), 0)
  }
  await assert.rejects(pushNotes(first.id, [old], 0), NoteGenerationMismatchError)
  const fresh = await pushNotes(first.id, [mutation()], 1)
  assert.equal(fresh.results[0]?.status, 'applied')
  assert.equal((await pullNotes(first.id, 0)).changes.length, 1)
})

test('authentication limit is atomic across concurrent attempts and resets after its window', async () => {
  const source = `integration:${crypto.randomUUID()}`
  const decisions = await Promise.all(Array.from({ length: 25 }, () => authenticationAttemptAllowed(source)))
  assert.equal(decisions.filter(Boolean).length, 20)
  assert.equal(decisions.filter(value => !value).length, 5)
  await database()('authentication_limits').update({ reset_at: new Date(0) })
  assert.equal(await authenticationAttemptAllowed(source), true)
  const strict = `integration-strict:${crypto.randomUUID()}`
  assert.equal(await authenticationAttemptAllowed(strict, 2, 60_000), true)
  assert.equal(await authenticationAttemptAllowed(strict, 2, 60_000), true)
  assert.equal(await authenticationAttemptAllowed(strict, 2, 60_000), false)
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

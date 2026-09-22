import { z } from 'zod'

export const collectionName = z.string().trim().min(1).max(80)
export type CollectionName = z.infer<typeof collectionName>
export const collection = z.object({ name: collectionName })
export type Collection = z.infer<typeof collection>
export const collectionList = z.object({ collections: z.array(collection) })
export type CollectionList = z.infer<typeof collectionList>

export const note = z.object({
  id: z.uuid(),
  collection: collectionName,
  title: z.string().max(500),
  body: z.string(),
  tags: z.array(z.string().min(1).max(50)).max(20),
  pinned: z.boolean(),
  purged: z.boolean(),
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
})
export type Note = z.infer<typeof note>

export const noteMutation = z.object({
  mutationId: z.uuid(),
  id: z.uuid(),
  collection: collectionName,
  baseRevision: z.number().int().nonnegative(),
  title: z.string().max(500),
  body: z.string(),
  tags: z.array(z.string().min(1).max(50)).max(20),
  pinned: z.boolean().optional(),
  purged: z.boolean().optional(),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  deleted: z.boolean(),
})
export type NoteMutation = z.infer<typeof noteMutation>

export const pushRequest = z.object({ mutations: z.array(noteMutation).max(100) })
export type PushRequest = z.infer<typeof pushRequest>
export const pushResult = z.object({
  results: z.array(z.discriminatedUnion('status', [
    z.object({ status: z.literal('applied'), mutationId: z.uuid(), note }),
    z.object({ status: z.literal('conflict'), mutationId: z.uuid(), serverNote: note }),
  ])),
})
export type PushResult = z.infer<typeof pushResult>
export const pullResult = z.object({
  changes: z.array(note),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
export type PullResult = z.infer<typeof pullResult>

export const attachment = z.object({
  id: z.uuid(),
  noteId: z.uuid(),
  filename: z.string().min(1).max(255),
  mediaType: z.string().min(1).max(255),
  byteSize: z.number().int().nonnegative().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
})
export type Attachment = z.infer<typeof attachment>
export const attachmentList = z.object({ attachments: z.array(attachment).max(20) })
export type AttachmentList = z.infer<typeof attachmentList>

export const shareId = z.string().regex(/^[A-Za-z0-9_-]{22}$/)
export const noteShare = z.object({
  id: shareId,
  noteId: z.uuid(),
  title: z.string().max(500),
  createdAt: z.iso.datetime(),
})
export type NoteShare = z.infer<typeof noteShare>
export const publicNote = z.object({
  title: z.string().max(500),
  body: z.string(),
  updatedAt: z.iso.datetime(),
})
export type PublicNote = z.infer<typeof publicNote>

export const credentials = z.object({
  email: z.email().max(254).transform(value => value.trim().toLowerCase()),
  password: z.string().min(12).max(128),
})
export type Credentials = z.infer<typeof credentials>
export const recoveryRequest = z.object({
  email: z.email().max(254).transform(value => value.trim().toLowerCase()),
  recoveryCode: z.string().trim().transform(value => value.toLowerCase().replaceAll('-', ''))
    .pipe(z.string().regex(/^[a-f0-9]{48}$/)),
  password: z.string().min(12).max(128),
})
export type RecoveryRequest = z.infer<typeof recoveryRequest>
export const passwordConfirmation = z.object({ password: z.string().min(12).max(128) })
export type PasswordConfirmation = z.infer<typeof passwordConfirmation>
export const account = z.object({ id: z.uuid(), email: z.email(), admin: z.boolean() })
export type Account = z.infer<typeof account>
export const apiKeyName = z.object({ name: z.string().trim().min(1).max(80) })
export type ApiKeyName = z.infer<typeof apiKeyName>
export const apiKey = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
})
export type ApiKey = z.infer<typeof apiKey>
export const createdApiKey = apiKey.extend({ key: z.string().regex(/^astronote_[a-f0-9]{64}$/) })
export type CreatedApiKey = z.infer<typeof createdApiKey>
export const accountPreferences = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  accent: z.enum(['cobalt', 'sage', 'amber', 'rose']),
  showPreviews: z.boolean(),
  showTags: z.boolean(),
  previewLines: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sort: z.enum(['modified', 'title']),
  sortDirection: z.enum(['asc', 'desc']),
  textSize: z.union([z.literal(13), z.literal(15), z.literal(17), z.literal(19)]),
  lineLength: z.union([z.literal(600), z.literal(720), z.literal(840)]),
  editorMode: z.enum(['rich', 'source']),
  spellcheck: z.boolean(),
})
export type AccountPreferences = z.infer<typeof accountPreferences>
export const systemSettings = z.object({ enableAccountRegistration: z.boolean() })
export type SystemSettings = z.infer<typeof systemSettings>
export const systemUser = z.object({ id: z.uuid(), email: z.email(), admin: z.boolean(), createdAt: z.iso.datetime() })
export type SystemUser = z.infer<typeof systemUser>

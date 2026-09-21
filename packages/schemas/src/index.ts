import { z } from 'zod'

export const note = z.object({
  id: z.uuid(),
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
export const account = z.object({ id: z.uuid(), email: z.email(), admin: z.boolean() })
export type Account = z.infer<typeof account>
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

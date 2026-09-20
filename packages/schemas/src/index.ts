import { z } from 'zod'

export const note = z.object({
  id: z.uuid(),
  title: z.string().max(500),
  body: z.string(),
  tags: z.array(z.string().min(1).max(50)).max(20),
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
export const account = z.object({ id: z.uuid(), email: z.email() })
export type Account = z.infer<typeof account>

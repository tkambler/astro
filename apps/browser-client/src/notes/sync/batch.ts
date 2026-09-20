import type { NoteMutation } from '@astronote/schemas'

const maxMutations = 25
const maxBytes = 51 * 1024 * 1024
const encoder = new TextEncoder()

/** Selects a request that fits both the API's mutation and body limits. */
export function nextPushBatch(pending: NoteMutation[]) {
  const mutations: NoteMutation[] = []
  let body = ''
  for (const mutation of pending.slice(0, maxMutations)) {
    const candidate = [...mutations, mutation]
    const encoded = JSON.stringify({ mutations: candidate })
    if (encoder.encode(encoded).byteLength > maxBytes) {
      if (!mutations.length) throw new Error('This note is too large to sync. It remains saved on this device.')
      break
    }
    mutations.push(mutation)
    body = encoded
  }
  return { mutations, body }
}

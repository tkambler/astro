export type DeviceStorage = { persistent: boolean | null; usedBytes: number | null }

/** Reports whether browser storage has eviction protection and estimated usage. */
export async function deviceStorage(): Promise<DeviceStorage> {
  if (!navigator.storage) return { persistent: null, usedBytes: null }
  const [persistent, estimate] = await Promise.all([
    navigator.storage.persisted().catch(() => null),
    navigator.storage.estimate().catch(() => null),
  ])
  return { persistent, usedBytes: estimate?.usage ?? null }
}

/** Requests persistent storage after an explicit user action. */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}

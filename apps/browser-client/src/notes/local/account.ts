export const accountKey = 'astronote-account-id'
export function activeAccountId() { return localStorage.getItem(accountKey) }
export function owner() { return activeAccountId() ?? 'guest' }
export function ownedKey(ownerId: string, id: string) { return `${ownerId}\0${id}` }

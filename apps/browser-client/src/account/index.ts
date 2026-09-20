import { create } from 'zustand'
import { account as accountSchema, type Account } from '@astronote/schemas'
import { activateAccount, activeAccountId, deactivateAccount } from '../notes/local'

type AccountState = {
  account: Account | null
  status: 'checking' | 'guest' | 'signed-in' | 'signed-out' | 'offline'
  check(): Promise<void>
  signIn(email: string, password: string, register: boolean): Promise<string | null>
  recover(email: string, recoveryCode: string, password: string): Promise<string>
  rotateRecoveryCode(): Promise<string>
  signOut(): Promise<boolean>
}

let accountVersion = 0
let authPending = false
const pendingLogoutKey = 'astronote-pending-logout-v1'
function logoutPending() { return localStorage.getItem(pendingLogoutKey) === '1' }
async function finishPendingLogout() {
  const attempt = async () => {
    if (!logoutPending()) return true
    try {
      const response = await fetch('/api/account/logout', {
        method: 'POST', headers: { 'x-astronote-request': '1' },
      })
      if (!response.ok) return false
      localStorage.removeItem(pendingLogoutKey)
      return true
    } catch { return false }
  }
  return navigator.locks ? navigator.locks.request('astronote-account-logout', attempt) : attempt()
}

export const useAccount = create<AccountState>((set, get) => ({
  account: null, status: 'checking',
  async check() {
    if (authPending) return
    const version = ++accountVersion
    try {
      if (logoutPending() && !await finishPendingLogout()) {
        if (version === accountVersion) set({ account: null, status: 'guest' })
        return
      }
      const response = await fetch('/api/account', { cache: 'no-store' })
      if (!response.ok) throw new Error('Account service unavailable')
      const result = await response.json() as { account: unknown }
      if (version !== accountVersion || authPending) return
      if (result.account) {
        const account = accountSchema.parse(result.account)
        await activateAccount(account.id)
        if (version !== accountVersion || authPending) return
        set({ account, status: 'signed-in' })
      } else set({ account: null, status: activeAccountId() ? 'signed-out' : 'guest' })
    } catch {
      if (version !== accountVersion || authPending) return
      set({ account: get().account?.id === activeAccountId() ? get().account : null,
        status: activeAccountId() ? 'offline' : 'guest' })
    }
  },
  async signIn(email, password, register) {
    ++accountVersion
    authPending = true
    try {
      if (!await finishPendingLogout()) throw new Error('Reconnect to finish signing out before signing in.')
      const response = await fetch(`/api/account/${register ? 'register' : 'login'}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-astronote-request': '1' },
        body: JSON.stringify({ email, password }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not sign in')
      }
      const result = await response.json() as { account: unknown; recoveryCode?: unknown }
      const account = accountSchema.parse(result.account)
      if (register && typeof result.recoveryCode !== 'string') throw new Error('Recovery code missing')
      await activateAccount(account.id)
      set({ account, status: 'signed-in' })
      return register ? result.recoveryCode as string : null
    } finally {
      authPending = false
    }
  },
  async recover(email, recoveryCode, password) {
    ++accountVersion
    authPending = true
    try {
      if (!await finishPendingLogout()) throw new Error('Reconnect to finish signing out before recovering this account.')
      const response = await fetch('/api/account/recover', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-astronote-request': '1' },
        body: JSON.stringify({ email, recoveryCode, password }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not recover account')
      }
      const result = await response.json() as { account: unknown; recoveryCode?: unknown }
      const account = accountSchema.parse(result.account)
      if (typeof result.recoveryCode !== 'string') throw new Error('Recovery code missing')
      await activateAccount(account.id)
      set({ account, status: 'signed-in' })
      return result.recoveryCode
    } finally {
      authPending = false
    }
  },
  async rotateRecoveryCode() {
    const response = await fetch('/api/account/recovery-code', {
      method: 'POST', headers: { 'x-astronote-request': '1' },
    })
    if (!response.ok) throw new Error('Could not generate recovery code')
    const result = await response.json() as { recoveryCode?: unknown }
    if (typeof result.recoveryCode !== 'string') throw new Error('Recovery code missing')
    return result.recoveryCode
  },
  async signOut() {
    ++accountVersion
    authPending = true
    try {
      localStorage.setItem(pendingLogoutKey, '1')
      deactivateAccount()
      set({ account: null, status: 'guest' })
      return await finishPendingLogout()
    } finally {
      authPending = false
    }
  },
}))

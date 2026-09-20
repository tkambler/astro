import { useState } from 'react'
import { useAccount } from '../account'
import { Button, Input } from '../design-system'
import { activeAccountId } from '../notes/local'

export function AccountPanel({ onClose, onAccountChanged }: { onClose(): void; onAccountChanged(): Promise<void> }) {
  const { account, status, signIn, signOut, recover, rotateRecoveryCode } = useAccount()
  const [mode, setMode] = useState<'sign-in' | 'register' | 'recover'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [newRecoveryCode, setNewRecoveryCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const code = mode === 'recover' ? await recover(email, recoveryInput, password)
        : await signIn(email, password, mode === 'register')
      await onAccountChanged()
      setPassword(''); setRecoveryInput('')
      if (code) setNewRecoveryCode(code)
      else onClose()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const logout = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const completed = await signOut()
      await onAccountChanged()
      if (completed) onClose()
      else setNotice('Signed out on this device. The server session will close when you reconnect.')
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const regenerate = async () => {
    setBusy(true); setError('')
    try { setNewRecoveryCode(await rotateRecoveryCode()) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className="account-panel">
    <div className="settings-top"><button className="mobile-settings-back" onClick={onClose}>‹ Notes</button><span>ACCOUNT</span><button onClick={onClose}>ESC to close</button></div>
    <div className="account-content">
      {newRecoveryCode ? <><h1>Save Your Recovery Code</h1><p>This code can reset your password if you lose it. Store it somewhere safe. It will only be shown now; generating another code invalidates this one.</p>
        <code className="recovery-code">{newRecoveryCode}</code>
        <Button variant="primary" className="account-action" onClick={() => { void navigator.clipboard.writeText(newRecoveryCode).catch(error => setError(String(error))) }}>Copy Code</Button>
        <Button variant="ghost" className="account-switch" onClick={() => { setNewRecoveryCode(''); onClose() }}>I Saved the Code</Button></>
      : account ? <><h1>{account.email}</h1><p>Your notes sync with this account. They remain available on this device when offline.</p>
        <Button variant="ghost" className="account-switch" disabled={busy} onClick={() => { void regenerate() }}>Generate a New Recovery Code</Button>
        <Button variant="primary" className="account-action" disabled={busy} onClick={() => { void logout() }}>Sign Out</Button></>
      : status === 'offline' && activeAccountId() ? <><h1>Account Offline</h1><p>Your notes are still available on this device. You can sign out here now; the server session will close when you reconnect.</p>
        <Button variant="primary" className="account-action" disabled={busy} onClick={() => { void logout() }}>Sign Out on This Device</Button></>
      : <><h1>{mode === 'register' ? 'Create Account' : mode === 'recover' ? 'Recover Account' : 'Sign In'}</h1>
        <p>{status === 'offline' ? 'The server is unreachable. Your existing notes remain available on this device.' :
          mode === 'recover' ? 'Enter the recovery code you saved when you created your account or last generated a new code.' :
          'Connect an account to sync notes across devices. You can keep using local notes without one.'}</p>
        <form onSubmit={event => { void submit(event) }}>
          <label>Email <Input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          {mode === 'recover' && <label>Recovery Code <Input type="text" autoComplete="off" required value={recoveryInput} onChange={event => setRecoveryInput(event.target.value)} /></label>}
          <label>{mode === 'recover' ? 'New Password' : 'Password'} <Input type="password" minLength={12} maxLength={128} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required value={password} onChange={event => setPassword(event.target.value)} /></label>
          <Button variant="primary" className="account-action" disabled={busy} type="submit">{busy ? 'Working…' : mode === 'register' ? 'Create Account' : mode === 'recover' ? 'Reset Password' : 'Sign In'}</Button>
        </form>
        {mode === 'sign-in' ? <><Button variant="ghost" className="account-switch" onClick={() => { setMode('register'); setError('') }}>New Here? Create an Account</Button>
          <Button variant="ghost" className="account-switch" onClick={() => { setMode('recover'); setError('') }}>Use a Recovery Code</Button></>
          : <Button variant="ghost" className="account-switch" onClick={() => { setMode('sign-in'); setError('') }}>Back to Sign In</Button>}
      </>}
      {error && <p role="alert" className="account-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </div>
}

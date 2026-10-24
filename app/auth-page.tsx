'use client'

import { FormEvent, useState } from 'react'
import { Boxes } from 'lucide-react'

type Mode = 'signin' | 'signup'

export default function AuthPage({ onSignedIn }: { onSignedIn: (payload: { name: string; email: string; password: string }, mode: Mode) => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (mode === 'signup' && (!name.trim() || password.length < 10 || password !== confirmation)) {
      setError(!name.trim() ? 'Enter your name.' : password.length < 10 ? 'Use at least 10 characters for your password.' : 'Passwords do not match.')
      return
    }
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    try {
      await onSignedIn({ name: name.trim(), email: email.trim(), password }, mode)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-brand"><div className="brand-mark"><Boxes size={20}/></div><div><strong>stockwise</strong><span>inventory intelligence</span></div></section>
    <section className="auth-card">
      <div className="auth-heading"><span className="eyebrow">Inventory workspace</span><h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1><p>{mode === 'signin' ? 'Sign in to manage your inventory workspace.' : 'Create a workspace with sample inventory to explore.'}</p></div>
      <form className="auth-form" onSubmit={submit} noValidate>
        {mode === 'signup' && <label>Full name<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" placeholder="Your name"/></label>}
        <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com"/></label>
        <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 10 characters"/></label>
        {mode === 'signup' && <label>Confirm password<input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password"/></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create workspace'}</button>
        <p className="auth-demo-note">Passwords are hashed on the server. Sample data belongs to your workspace.</p>
      </form>
      <div className="auth-switch">{mode === 'signin' ? <>New to StockWise? <button onClick={() => setMode('signup')}>Create an account</button></> : <>Already have an account? <button onClick={() => setMode('signin')}>Sign in</button></>}</div>
    </section>
  </main>
}


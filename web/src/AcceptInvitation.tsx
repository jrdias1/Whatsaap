import { useState } from 'react'
import type { FormEvent } from 'react'
import './accept-invitation.css'

function captureToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
  if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  return token
}

export default function AcceptInvitation() {
  const [token] = useState(captureToken)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!token) return setError('O link está incompleto. Peça um novo convite ao administrador da clínica.')
    if (password !== confirmation) return setError('As senhas não conferem.')
    if (new TextEncoder().encode(password).length > 72) return setError('A senha deve ter no máximo 72 bytes.')

    setSubmitting(true)
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3002'
      const response = await fetch(`${apiUrl}/api/auth/accept-invitation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string }
        throw new Error(Array.isArray(body.message) ? body.message.join(' ') : body.message ?? 'O convite expirou ou já foi utilizado.')
      }
      setMessage('Convite aceito. Sua conta está pronta; peça ao administrador o endereço de acesso da clínica.')
      setPassword('')
      setConfirmation('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível aceitar o convite.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="invite-page">
    <section className="invite-card" aria-labelledby="invite-title">
      <div className="invite-brand"><b>e</b><span>essencial<small>CLÍNICAS</small></span></div>
      <h1 id="invite-title">Ative seu acesso</h1>
      <p>Crie uma senha para concluir o convite à clínica.</p>
      {!token && !message ? <p className="invite-alert" role="alert">O link está incompleto ou já foi removido. Peça um novo convite ao administrador.</p> : null}
      {message ? <p className="invite-success" role="status">{message}</p> : null}
      {token && !message ? <form onSubmit={submit}>
        <label htmlFor="new-password">Nova senha</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} />
        <small>Use pelo menos 8 caracteres.</small>
        <label htmlFor="confirm-password">Confirme a senha</label>
        <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        {error ? <p className="invite-alert" role="alert">{error}</p> : null}
        <button type="submit" disabled={submitting}>{submitting ? 'Ativando…' : 'Ativar acesso'}</button>
      </form> : null}
      {!token && error ? <p className="invite-alert" role="alert">{error}</p> : null}
    </section>
  </main>
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import './accept-invitation.css'

function readToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
  return token
}

export default function CompletePasswordRecovery() {
  const [token] = useState(readToken)
  const [tenantSlug, setTenantSlug] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('')
    if (!token) return setError('Token ausente. Peça ao administrador que inicie outra recuperação.')
    if (password !== confirmation) return setError('As senhas não conferem.')
    setBusy(true)
    try {
      const api = import.meta.env.VITE_API_URL ?? 'http://localhost:3002'
      const response = await fetch(`${api}/api/auth/password-recovery/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug, email, token, password }) })
      const body = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) throw new Error(body.message ?? 'Token inválido ou expirado.')
      setMessage('Senha atualizada. Todas as sessões anteriores foram encerradas; entre novamente com a nova senha.')
      setPassword(''); setConfirmation('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a senha.') }
    finally { setBusy(false) }
  }
  return <main className="invite-page"><section className="invite-card" aria-labelledby="recovery-title"><div className="invite-brand"><b>e</b><span>essencial<small>CLÍNICAS</small></span></div><h1 id="recovery-title">Definir nova senha</h1><p>Use o identificador da clínica e o e-mail da conta que está sendo recuperada.</p>{message && <p role="status" className="invite-success">{message}</p>}{!message && <form onSubmit={(event) => void submit(event)}><label htmlFor="recovery-tenant">Identificador da clínica</label><input id="recovery-tenant" required autoComplete="off" value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)} /><label htmlFor="recovery-email">E-mail da conta</label><input id="recovery-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /><label htmlFor="recovery-password">Nova senha</label><input id="recovery-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} /><label htmlFor="recovery-confirm">Confirme a senha</label><input id="recovery-confirm" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />{error && <p role="alert" className="invite-alert">{error}</p>}<button type="submit" disabled={busy || !token}>{busy ? 'Atualizando…' : 'Atualizar senha'}</button></form>}{!token && <p role="alert" className="invite-alert">Link sem token. Solicite uma nova recuperação ao administrador.</p>}</section></main>
}

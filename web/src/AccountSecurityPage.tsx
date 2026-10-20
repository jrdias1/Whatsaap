import { useState } from 'react'
import type { FormEvent } from 'react'
import './account-security.css'

type Request = (path: string, init?: RequestInit) => Promise<any>

export default function AccountSecurityPage({ request, setNotice }: { request: Request; setNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    if (data.get('newPassword') !== data.get('confirmPassword')) { setNotice('As novas senhas não coincidem.'); return }
    setBusy(true)
    try {
      await request('/auth/password', { method: 'PATCH', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }) })
      form.reset()
      setNotice('Senha atualizada. As outras sessões desta conta foram encerradas.')
    } catch (error) { setNotice((error as Error).message) }
    finally { setBusy(false) }
  }

  return <section className="account-security-form"><h2>Trocar senha</h2><p>Use sua senha atual para definir uma nova. A troca vale para todos os acessos desta conta.</p><form onSubmit={(event) => void submit(event)}>
    <label>Senha atual<input name="currentPassword" required type="password" autoComplete="current-password"/></label>
    <label>Nova senha<input name="newPassword" required type="password" minLength={8} maxLength={72} autoComplete="new-password"/></label>
    <label>Confirmar nova senha<input name="confirmPassword" required type="password" minLength={8} maxLength={72} autoComplete="new-password"/></label>
    <button className="primary" disabled={busy}>{busy ? 'Salvando…' : 'Atualizar senha'}</button>
  </form></section>
}

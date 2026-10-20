import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Props = { token: string; apiBaseUrl: string }

export default function PublicReferralPage({ token, apiBaseUrl }: Props) {
  const [claimToken, setClaimToken] = useState('')
  const [phone, setPhone] = useState('')
  const [notice, setNotice] = useState('Registrando a origem do link…')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    const storageKey = `referral-click:${token}`
    const clickKey = sessionStorage.getItem(storageKey) ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)
    sessionStorage.setItem(storageKey, clickKey)
    void fetch(`${apiBaseUrl}/api/referrals/public/${encodeURIComponent(token)}/click`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clickKey }) })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.message ?? 'Este link não está disponível.')
        if (active) { setClaimToken(body.claimToken); setNotice('Se quiser, informe seu telefone para a clínica identificar o contato. Isso não cria um cadastro de paciente nem autoriza mensagens.') }
      })
      .catch((error: Error) => { if (active) setNotice(error.message) })
    return () => { active = false }
  }, [apiBaseUrl, token])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!claimToken) return
    setBusy(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/referrals/public/lead/${encodeURIComponent(claimToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message ?? 'Não foi possível registrar o contato.')
      setNotice(body.accepted ? 'Contato registrado. A equipe da clínica poderá associá-lo a um cadastro existente e verificar os próximos passos. Nenhum consentimento de mensagens foi criado.' : 'Não foi possível aceitar esta indicação. Entre em contato diretamente com a clínica.')
      setClaimToken('')
      setPhone('')
    } catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }

  return <main className="public-referral">
    <section>
      <span>INDICAÇÃO</span>
      <h1>Você recebeu uma indicação</h1>
      <p>{notice}</p>
      {claimToken && <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="referral-phone">Telefone com DDD</label>
        <input id="referral-phone" type="tel" inputMode="tel" autoComplete="tel" required minLength={10} maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(31) 99999-9999" />
        <button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Continuar'}</button>
      </form>}
      <small>Este link registra a origem da indicação. A clínica precisa confirmar separadamente qualquer benefício e eventual autorização de contato.</small>
    </section>
  </main>
}

import { useCallback, useEffect, useState } from 'react'
import './operator-whatsapp-reconnect.css'

type Request = (path: string, init?: RequestInit) => Promise<any>
type ConnectionStatus = { configured: boolean; status: string; canReconnect: boolean }
type QrSession = { qr: string | null; status: string }

export default function OperatorWhatsAppReconnect({ unitId, unitName, request, setNotice }: { unitId: string; unitName: string; request: Request; setNotice: (message: string) => void }) {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [qrSession, setQrSession] = useState<QrSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refreshStatus = useCallback(async () => {
    if (!unitId) return null
    const result = await request(`/messaging/connections/operational-status?unitId=${encodeURIComponent(unitId)}`) as ConnectionStatus
    setConnection(result)
    return result
  }, [request, unitId])

  useEffect(() => {
    let active = true
    const check = async () => {
      try {
        const result = await request(`/messaging/connections/operational-status?unitId=${encodeURIComponent(unitId)}`) as ConnectionStatus
        if (active) setConnection(result)
      } catch { if (active) setConnection(null) }
    }
    void check()
    const interval = window.setInterval(() => void check(), 30000)
    return () => { active = false; window.clearInterval(interval) }
  }, [request, unitId])

  useEffect(() => {
    if (!qrSession || qrSession.status === 'CONNECTED') return
    let active = true
    let timer = 0
    const poll = async () => {
      try {
        const result = await refreshStatus()
        if (!active) return
        if (result?.status === 'CONNECTED') {
          setQrSession(null)
          setNotice(`WhatsApp da filial ${unitName} conectado.`)
          return
        }
      } catch { /* Keep the QR visible and retry while the operator waits. */ }
      if (active) timer = window.setTimeout(() => void poll(), 3000)
    }
    timer = window.setTimeout(() => void poll(), 2500)
    return () => { active = false; window.clearTimeout(timer) }
  }, [qrSession?.status, refreshStatus, setNotice, unitName])

  async function reconnect() {
    setError('')
    setBusy(true)
    try {
      const result = await request('/messaging/connections/evolution/connect', { method: 'POST', body: JSON.stringify({ unitId }) })
      if (result.status === 'CONNECTED') {
        setQrSession(null)
        await refreshStatus()
        setNotice(`WhatsApp da filial ${unitName} j\u00e1 est\u00e1 conectado.`)
      } else {
        setQrSession({ qr: result.qr ?? null, status: result.status })
      }
    } catch (cause) {
      setError((cause as Error).message || 'N\u00e3o foi poss\u00edvel reconectar o WhatsApp.')
    } finally { setBusy(false) }
  }

  if (!connection?.configured || connection.status === 'CONNECTED' || connection.status === 'DISABLED') return <>
    {qrSession && <QrDialog session={qrSession} unitName={unitName} busy={busy} onClose={() => setQrSession(null)} onReconnect={() => void reconnect()}/>}
  </>

  return <>
    <aside className={`operator-whatsapp-alert${connection.status === 'ERROR' ? ' has-error' : ''}`} role="status">
      <div><strong>{connection.status === 'ERROR' ? 'N\u00e3o foi poss\u00edvel confirmar a conex&atilde;o do WhatsApp' : connection.status === 'CONNECTING' ? `Aguardando conex&atilde;o da filial ${unitName}` : `WhatsApp da filial ${unitName} desconectado`}</strong><p>{connection.status === 'CONNECTING' ? 'Se o QR Code foi fechado ou expirou, gere outro para concluir a conex&atilde;o.' : 'O atendimento pode ficar sem receber mensagens. Voc\u00ea pode tentar reconectar esta filial.'}</p>{error && <small role="alert">{error}</small>}</div>
      <button type="button" className="primary" onClick={() => void reconnect()} disabled={busy}>{busy ? 'Preparando QR Code\u2026' : connection.status === 'CONNECTING' ? 'Gerar QR Code novamente' : 'Reconectar WhatsApp'}</button>
    </aside>
    {qrSession && <QrDialog session={qrSession} unitName={unitName} busy={busy} onClose={() => setQrSession(null)} onReconnect={() => void reconnect()}/>}
  </>
}

function QrDialog({ session, unitName, busy, onClose, onReconnect }: { session: QrSession; unitName: string; busy: boolean; onClose: () => void; onReconnect: () => void }) {
  return <div className="qr-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="qr-modal operator-reconnect-modal" role="dialog" aria-modal="true" aria-labelledby="operator-qr-title"><header><div><span>RECONEX&#xC3;O DA FILIAL</span><h3 id="operator-qr-title">{unitName}</h3></div><button type="button" aria-label="Fechar" onClick={onClose}>&times;</button></header>
    {session.status === 'CONNECTED' ? <div className="qr-connected"><strong>WhatsApp conectado</strong><p>A filial voltou a receber conversas.</p><button type="button" onClick={onClose}>Fechar</button></div> : session.qr ? <div className="qr-content"><p>Abra o WhatsApp no celular e acesse <b>Aparelhos conectados &rarr; Conectar aparelho</b>. Aponte a c&acirc;mera para este QR Code.</p><img src={session.qr} alt={`QR Code para reconectar o WhatsApp da filial ${unitName}`}/><span>Esta tela verifica a conex&atilde;o automaticamente.</span><button type="button" className="primary" onClick={onReconnect} disabled={busy}>{busy ? 'Gerando QR Code' : 'Gerar outro QR Code'}</button></div> : <div className="qr-waiting"><strong>Preparando a conex&atilde;o</strong><p>Aguarde enquanto geramos um novo QR Code.</p><button type="button" className="primary" onClick={onReconnect} disabled={busy}>{busy ? 'Gerando QR Code' : 'Tentar novamente'}</button></div>}
  </section></div>
}

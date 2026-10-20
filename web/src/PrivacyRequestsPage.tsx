import { useEffect, useState } from 'react'
import './phase10-admin.css'
import { statusLabel } from './status-labels.js'

type Request = (path: string, init?: RequestInit) => Promise<any>
type Patient = { id: string; fullName: string }
const labels: Record<string, string> = { ACCESS: 'Acesso', CORRECTION: 'Correção', EXPORT: 'Exportação', CONSENT_REVIEW: 'Revisão de consentimento', ERASURE: 'Pedido de exclusão', ANONYMIZATION: 'Pedido de anonimização', DATA_USE_QUESTION: 'Questionamento de uso' }

export default function PrivacyRequestsPage({ request, setNotice }: { request: Request; setNotice: (value: string) => void }) {
  const [items, setItems] = useState<any[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ patientId: '', type: 'ACCESS', reason: '' })
  const [busy, setBusy] = useState(false)
  async function load() {
    try { const [requests, result] = await Promise.all([request('/privacy/requests'), request(`/patients?status=ACTIVE&page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`)]); setItems(requests); setPatients(result.items) }
    catch (error) { setNotice((error as Error).message) }
  }
  useEffect(() => { void load() }, [search])
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true)
    try { await request('/privacy/requests', { method: 'POST', body: JSON.stringify(form) }); setForm({ patientId: '', type: 'ACCESS', reason: '' }); setNotice('Solicitação registrada. Nenhuma informação foi excluída ou alterada automaticamente.'); await load() }
    catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }
  async function update(id: string, status: string) {
    const closureReason = ['COMPLETED', 'REJECTED'].includes(status) ? window.prompt('Registre o motivo do encerramento (não executa exclusão):') : undefined
    if (['COMPLETED', 'REJECTED'].includes(status) && !closureReason) return
    setBusy(true)
    try { await request(`/privacy/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status, ...(closureReason ? { closureReason } : {}) }) }); setNotice('Status e histórico atualizados; os dados do paciente permanecem preservados.'); await load() }
    catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }
  return <div className="phase10-admin">
    <section className="phase10-card"><h2>Solicitações de privacidade</h2><p>Registre e acompanhe pedidos do titular. Este fluxo não apaga dados, não anonimiza e não substitui análise administrativa ou jurídica.</p>
      <form className="phase10-form" onSubmit={(event) => void create(event)}><h3>Registrar solicitação</h3><label>Buscar paciente<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou telefone" /></label><label>Paciente<select required value={form.patientId} onChange={(event) => setForm({ ...form, patientId: event.target.value })}><option value="">Selecione um paciente</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}</option>)}</select></label><label>Tipo<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label htmlFor="privacy-request-description">Descrição do pedido<textarea id="privacy-request-description" required minLength={5} maxLength={1000} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label><button className="primary" disabled={busy}>Registrar e auditar</button></form>
    </section>
    <section className="phase10-card"><h2>Histórico</h2>{items.length ? items.map((item) => <article className="phase10-privacy-item" key={item.id}><div><strong>{item.patient.fullName} · {labels[item.type] ?? item.type}</strong><p>{item.reason}</p><small>Status: {statusLabel(item.status)} · Registrado em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.createdAt))}</small>{item.closureReason && <p>Encerramento: {item.closureReason}</p>}</div><label>Status<select value={item.status} disabled={busy} onChange={(event) => void update(item.id, event.target.value)}><option value="OPEN">Aberta</option><option value="UNDER_REVIEW">Em análise</option><option value="COMPLETED">Concluída (sem excluir)</option><option value="REJECTED">Encerrada após análise</option></select></label><details><summary>Ver eventos ({item.events.length})</summary><ol>{item.events.map((event: any) => <li key={event.id}>{statusLabel(event.action)} · {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.occurredAt))}</li>)}</ol></details></article>) : <p className="phase10-empty">Ainda não há solicitações registradas.</p>}</section>
  </div>
}

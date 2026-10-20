import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './CampaignsPanel.css'

type Campaign = { id: string; name: string; body: string; mode: 'STAGE' | 'BULK'; provider: string; status: string; scheduledAt?: string | null; createdAt: string; audiencePatientIds?: string[]; _count?: { outbox: number } }
type Patient = { id: string; fullName: string; phone: string | null; unit?: { name: string } | null }
type Request = (path: string, init?: RequestInit) => Promise<any>

const variables = [
  { key: 'paciente.primeiroNome', label: 'Primeiro nome', detail: 'Parte inicial do nome cadastrado.' },
  { key: 'paciente.nome', label: 'Nome completo', detail: 'Nome cadastrado do paciente.' },
  { key: 'clinica.nome', label: 'Clínica', detail: 'Nome da clínica cadastrado no sistema.' },
  { key: 'unidade.nome', label: 'Unidade', detail: 'Unidade do paciente ou da conversa.' },
  { key: 'atendente.nome', label: 'Atendente', detail: 'Somente no funil, quando a conversa tiver responsável.' },
  { key: 'agendamento.data', label: 'Data da agenda', detail: 'Próximo agendamento pendente ou confirmado.' },
  { key: 'agendamento.hora', label: 'Horário da agenda', detail: 'Horário do mesmo agendamento, em São Paulo.' },
  { key: 'agendamento.procedimento', label: 'Procedimento', detail: 'Procedimento do próximo agendamento, se cadastrado.' },
]

function emptyForm() { return { name: '', body: '', mode: 'STAGE' as 'STAGE' | 'BULK', provider: 'EVOLUTION_BAILEYS', scheduledAt: '', audiencePatientIds: [] as string[] } }
function localDateTime(value?: string | null) {
  if (!value || new Date(value).getTime() <= Date.now()) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export default function CampaignsPanel({ rows, request, onRefresh, setNotice, onOpenInbox }: { rows: Record<string, any>[]; request: Request; onRefresh: () => Promise<unknown> | void; setNotice: (message: string) => void; onOpenInbox: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')
  const [available, setAvailable] = useState<Patient[]>([])
  const [known, setKnown] = useState<Record<string, Patient>>({})
  const [busy, setBusy] = useState(false)
  const campaigns = rows as Campaign[]

  useEffect(() => {
    if (form.mode !== 'BULK') return
    let active = true
    const timer = window.setTimeout(() => {
      void request(`/campaigns/audience?search=${encodeURIComponent(search.trim())}`).then((patients: Patient[]) => {
        if (!active) return
        setAvailable(patients)
        setKnown((current) => Object.fromEntries([...Object.entries(current), ...patients.map((patient) => [patient.id, patient])]))
      }).catch((error: Error) => { if (active) setNotice(error.message) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [form.mode, request, search, setNotice])

  function startEdit(campaign: Campaign) {
    setEditingId(campaign.id)
    setForm({ name: campaign.name, body: campaign.body, mode: campaign.mode, provider: campaign.provider, scheduledAt: localDateTime(campaign.scheduledAt), audiencePatientIds: campaign.audiencePatientIds ?? [] })
    setSearch('')
    if (campaign.mode === 'BULK' && campaign.audiencePatientIds?.length) {
      for (let offset = 0; offset < campaign.audiencePatientIds.length; offset += 100) {
        const ids = campaign.audiencePatientIds.slice(offset, offset + 100)
        void request(`/campaigns/audience?ids=${encodeURIComponent(ids.join(','))}`).then((patients: Patient[]) => setKnown((current) => Object.fromEntries([...Object.entries(current), ...patients.map((patient) => [patient.id, patient])]))).catch((error: Error) => setNotice(error.message))
      }
    }
    document.querySelector('.campaigns-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function togglePatient(id: string) {
    setForm((current) => ({ ...current, audiencePatientIds: current.audiencePatientIds.includes(id) ? current.audiencePatientIds.filter((item) => item !== id) : [...current.audiencePatientIds, id] }))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const payload = { name: form.name.trim(), body: form.body.trim(), provider: form.mode === 'BULK' ? 'META_CLOUD' : form.provider, ...(editingId ? {} : { mode: form.mode }), ...(form.mode === 'BULK' ? { audiencePatientIds: form.audiencePatientIds, ...(form.scheduledAt ? { scheduledAt: new Date(form.scheduledAt).toISOString() } : editingId ? { scheduledAt: null } : {}) } : {}) }
      await request(editingId ? `/campaigns/${editingId}` : '/campaigns', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      setNotice(editingId ? form.mode === 'STAGE' ? 'Campanha atualizada. Acompanhamentos pendentes foram cancelados; novas entradas na etapa usarão o texto atualizado.' : 'Rascunho atualizado. Revise o público antes de aprovar para a fila.' : form.mode === 'STAGE' ? 'Campanha criada. Vincule-a a uma etapa no Quadro do Inbox.' : 'Campanha criada como rascunho. Revise o público antes de aprovar para a fila.')
      setEditingId(null); setForm(emptyForm()); setSearch('')
      await onRefresh()
    } catch (error) { setNotice((error as Error).message) }
    finally { setBusy(false) }
  }

  async function approve(campaign: Campaign) {
    const count = campaign.audiencePatientIds?.length ?? 0
    if (!count) { setNotice('Edite a campanha e selecione os pacientes antes de aprovar.'); return }
    if (!window.confirm(`Preparar ${count} ${count === 1 ? 'mensagem' : 'mensagens'} para os pacientes selecionados? Nenhum WhatsApp será enviado neste ambiente.`)) return
    setBusy(true)
    try {
      const result = await request(`/campaigns/${campaign.id}/approve`, { method: 'POST' })
      setNotice(`${Number(result.queuedCount ?? 0).toLocaleString('pt-BR')} mensagens registradas na fila lógica; nenhum envio externo foi realizado.`)
      await onRefresh()
    } catch (error) { setNotice((error as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="campaigns-page">
    <section className="campaigns-intro" aria-label="Como usar campanhas">
      <div><h2>Como vincular pacientes</h2><p><strong>Mensagem do funil:</strong> crie a campanha, vincule-a a uma etapa no Quadro do Inbox e confirme a inclusão ao mover cada cartão. Escolha envio ao entrar na etapa ou após dias sem resposta.</p><p><strong>Campanha para lista:</strong> selecione os pacientes abaixo, salve o rascunho e aprove o público. Somente cadastros ativos com telefone e consentimento de marketing aparecem na busca.</p></div>
      <button type="button" onClick={onOpenInbox}>Abrir Quadro do Inbox</button>
    </section>

    <form className="campaigns-editor" onSubmit={(event) => void save(event)}>
      <div className="campaigns-editor-heading"><div><h2>{editingId ? 'Editar campanha' : 'Nova campanha'}</h2><p>{editingId ? 'Revise o texto, o canal e o público antes de salvar.' : 'Escolha como os pacientes entram e escreva a mensagem.'}</p></div>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm()) }}>Cancelar edição</button>}</div>
      <div className="campaigns-fields"><label>Uso da campanha<select value={form.mode} disabled={Boolean(editingId)} onChange={(event) => setForm({ ...emptyForm(), mode: event.target.value as 'STAGE' | 'BULK', provider: event.target.value === 'STAGE' ? 'EVOLUTION_BAILEYS' : 'META_CLOUD' })}><option value="STAGE">Mensagem individual do funil</option><option value="BULK">Campanha para pacientes selecionados</option></select></label><label>Canal<select value={form.mode === 'BULK' ? 'META_CLOUD' : form.provider} disabled={form.mode === 'BULK'} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}><option value="META_CLOUD">Meta Cloud (oficial)</option><option value="EVOLUTION_BAILEYS">Evolution / Baileys (não oficial)</option></select></label></div>
      <label>Nome interno da campanha<input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Retorno de pacientes"/></label>
      <label>Mensagem para o paciente<textarea required maxLength={4000} rows={5} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} placeholder="Olá, {{paciente.primeiroNome}}! Podemos ajudar?"/></label>
      <section className="campaigns-variables" aria-label="Referências automáticas"><h3>Dados automáticos que você pode usar</h3><p>Clique para inserir a referência no texto. O sistema preenche com os dados do paciente no momento de preparar a mensagem.</p><div>{variables.filter((item) => form.mode === 'STAGE' || item.key !== 'atendente.nome').map((item) => <button type="button" key={item.key} title={item.detail} onClick={() => setForm((current) => ({ ...current, body: current.body + (current.body && !/\s$/u.test(current.body) ? ' ' : '') + `{{${item.key}}}` }))}><code>{`{{${item.key}}}`}</code><span>{item.label}</span></button>)}</div><small>Data, horário e procedimento exigem um próximo agendamento; atendente exige responsável na conversa. Se um dado faltar, a campanha para lista não será aprovada ou a mensagem do funil será suprimida.</small></section>
      {form.mode === 'BULK' && <section className="campaigns-audience" aria-label="Pacientes desta campanha"><div><h3>Pacientes vinculados <span>{form.audiencePatientIds.length}</span></h3><p>Marque os pacientes que receberão esta campanha. A seleção fica salva no rascunho.</p></div><label>Buscar paciente elegível<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou telefone"/></label><div className="campaigns-patient-list">{available.map((patient) => <label key={patient.id}><input type="checkbox" checked={form.audiencePatientIds.includes(patient.id)} onChange={() => togglePatient(patient.id)}/><span><strong>{patient.fullName}</strong><small>{patient.unit?.name ?? 'Sem unidade'} · {patient.phone}</small></span></label>)}{available.length === 0 && <p>Nenhum paciente elegível nesta busca.</p>}</div>{form.audiencePatientIds.length > 0 && <div className="campaigns-selected"><strong>Selecionados</strong><div>{form.audiencePatientIds.map((id) => <button type="button" key={id} onClick={() => togglePatient(id)} aria-label={`Remover ${known[id]?.fullName ?? 'paciente'} da campanha`}>{known[id]?.fullName ?? 'Paciente selecionado'} ×</button>)}</div></div>}<label>Preparar a partir de (opcional)<input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm((current) => ({ ...current, scheduledAt: event.target.value }))}/></label></section>}
      <p className="campaigns-simulation">Este ambiente registra mensagens em uma fila de simulação. Nenhum envio externo é realizado.</p>
      <div className="campaigns-actions"><button type="submit" className="primary" disabled={busy}>{busy ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Criar campanha'}</button></div>
    </form>

    <section className="campaigns-list"><h2>Campanhas criadas</h2>{campaigns.map((campaign) => <article key={campaign.id}><div><strong>{campaign.name}</strong><p>{campaign.mode === 'STAGE' ? 'Mensagem individual do funil' : `${campaign.audiencePatientIds?.length ?? 0} pacientes selecionados`} · {campaign.provider === 'META_CLOUD' ? 'Meta Cloud' : 'Evolution / Baileys'} · {campaign.status === 'DRAFT' ? 'Rascunho' : 'Ativa na simulação'}</p><small>Criada em {new Date(campaign.createdAt).toLocaleDateString('pt-BR')}{campaign._count?.outbox ? ` · ${campaign._count.outbox} mensagens na fila` : ''}</small></div><div className="campaigns-list-actions">{(campaign.mode === 'STAGE' || campaign.status === 'DRAFT') && <button type="button" onClick={() => startEdit(campaign)}>Editar campanha</button>}{campaign.mode === 'BULK' && campaign.status === 'DRAFT' && <button type="button" className="primary" disabled={busy || !campaign.audiencePatientIds?.length} onClick={() => void approve(campaign)}>Aprovar público para a fila</button>}</div></article>)}{campaigns.length === 0 && <p>Nenhuma campanha criada.</p>}</section>
  </div>
}

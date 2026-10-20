import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { statusLabel } from './status-labels.js'

type Row = Record<string, any> & { id: string }
type Unit = { id: string; name: string }
type Patient = { id: string; fullName: string; phone?: string | null; unitId?: string | null }
type Props = { request: (path: string, init?: RequestInit) => Promise<any>; units: Unit[]; setNotice: (value: string) => void; refreshKey: number }

const initial = { name: '', description: '', startsAt: '', endsAt: '', qualificationCriterion: 'FIRST_NATIVE_APPOINTMENT_COMPLETED', rewardEveryQualifiedCount: 1, rewardType: 'SESSION_CREDIT', rewardQuantity: 1, rewardDescription: '', rewardValidityDays: 90, maxRewardsPerParticipant: 1 }
const localDateTime = (value: string) => { const date = new Date(value); const pad = (part: number) => String(part).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}` }

export default function ReferralsPanel({ request, units, setNotice, refreshKey }: Props) {
  const [campaigns, setCampaigns] = useState<Row[]>([])
  const [referrals, setReferrals] = useState<Row[]>([])
  const [rewards, setRewards] = useState<Row[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [form, setForm] = useState(initial)
  const [editingId, setEditingId] = useState('')
  const [unitIds, setUnitIds] = useState<string[]>(units[0] ? [units[0].id] : [])
  const [patientId, setPatientId] = useState('')
  const [linkUnitId, setLinkUnitId] = useState(units[0]?.id ?? '')
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [loyalty, setLoyalty] = useState<Row | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemQuantity, setRedeemQuantity] = useState(1)
  const [redeemUnitId, setRedeemUnitId] = useState(units[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [campaignData, referralData, rewardData, patientData] = await Promise.all([
      request('/referrals/campaigns'), request('/referrals'), request('/referrals/rewards'), request('/patients?page=1&pageSize=100&status=ACTIVE'),
    ])
    setCampaigns(campaignData); setReferrals(referralData); setRewards(rewardData); setPatients(patientData.items)
  }, [request])
  useEffect(() => { void Promise.resolve().then(load).catch((error: Error) => setNotice(error.message)) }, [load, setNotice, refreshKey])

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true)
    try {
      await request(editingId ? `/referrals/campaigns/${editingId}` : '/referrals/campaigns', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null, rewardEveryQualifiedCount: Number(form.rewardEveryQualifiedCount), rewardQuantity: Number(form.rewardQuantity), rewardValidityDays: Number(form.rewardValidityDays), maxRewardsPerParticipant: Number(form.maxRewardsPerParticipant), unitIds, requireHumanApproval: true }) })
      setForm(initial); setEditingId(''); setNotice(editingId ? 'Campanha atualizada.' : 'Campanha criada em rascunho. Critério e recompensa exigem revisão e ativação explícitas.')
      await load()
    } catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }
  function editCampaign(campaign: Row) {
    setEditingId(campaign.id)
    setForm({ name: campaign.name, description: campaign.description ?? '', startsAt: localDateTime(campaign.startsAt), endsAt: campaign.endsAt ? localDateTime(campaign.endsAt) : '', qualificationCriterion: campaign.qualificationCriterion, rewardEveryQualifiedCount: campaign.rewardEveryQualifiedCount, rewardType: campaign.rewardType, rewardQuantity: campaign.rewardQuantity, rewardDescription: campaign.rewardDescription, rewardValidityDays: campaign.rewardValidityDays, maxRewardsPerParticipant: campaign.maxRewardsPerParticipant })
    setUnitIds(campaign.units.map((item: Row) => item.unitId))
  }
  async function changeReferralStatus(referral: Row, status: 'PENDING_VERIFICATION' | 'CANCELLED' | 'REVERSED') {
    const reason = window.prompt(`Motivo para ${status === 'PENDING_VERIFICATION' ? 'revisão' : status === 'CANCELLED' ? 'cancelamento' : 'reversão'}`)
    if (!reason?.trim()) return
    try { await request(`/referrals/${referral.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }); setNotice(`Indicação atualizada para ${statusLabel(status).toLocaleLowerCase('pt-BR')}; decisão registrada.`); await load() } catch (error) { setNotice((error as Error).message) }
  }
  async function status(campaign: Row) {
    try { const next = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'; await request(`/referrals/campaigns/${campaign.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); setNotice(`Campanha ${next === 'ACTIVE' ? 'ativada' : 'pausada'}.`); await load() } catch (error) { setNotice((error as Error).message) }
  }
  async function issueLink() {
    if (!selectedCampaignId || !patientId || !linkUnitId) return
    try { const result = await request(`/referrals/campaigns/${selectedCampaignId}/participants`, { method: 'POST', body: JSON.stringify({ patientId, unitId: linkUnitId }) }); await navigator.clipboard?.writeText(result.link); setNotice(`Link individual emitido${navigator.clipboard ? ' e copiado' : ''}: ${result.link}`); await load() } catch (error) { setNotice((error as Error).message) }
  }
  async function decision(id: string, action: 'APPROVE' | 'REJECT') {
    const reason = action === 'REJECT' ? window.prompt('Motivo obrigatório da recusa') : null
    if (action === 'REJECT' && !reason) return
    try { await request(`/referrals/rewards/${id}/decision`, { method: 'PATCH', body: JSON.stringify({ action, reason }) }); setNotice(action === 'APPROVE' ? 'Recompensa aprovada. Emita o voucher em ação separada.' : 'Recompensa recusada e decisão auditada.'); await load() } catch (error) { setNotice((error as Error).message) }
  }
  async function issue(id: string) {
    try { const result = await request(`/referrals/rewards/${id}/issue`, { method: 'POST' }); setNotice(`Benefício emitido. Voucher ${result.voucherCode} · válido até ${new Date(result.expiresAt).toLocaleDateString('pt-BR')}. Copie agora: o código não será exibido novamente.`); await load() } catch (error) { setNotice((error as Error).message) }
  }
  async function associate(referralId: string, targetPatientId: string) {
    try { await request(`/referrals/${referralId}/patient`, { method: 'PATCH', body: JSON.stringify({ patientId: targetPatientId }) }); setNotice('Indicação vinculada ao paciente existente; nenhum consentimento foi criado.'); await load() } catch (error) { setNotice((error as Error).message) }
  }
  async function showLoyalty(id: string) {
    try { setLoyalty(await request(`/referrals/loyalty/${id}`)) } catch (error) { setNotice((error as Error).message) }
  }
  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true)
    try {
      const result = await request('/referrals/rewards/redeem', { method: 'POST', body: JSON.stringify({ code: redeemCode, quantity: Number(redeemQuantity), unitId: redeemUnitId, idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}` }) })
      setNotice(result.duplicate ? 'Este resgate já estava registrado; o saldo não foi alterado novamente.' : 'Resgate registrado no SaaS. Nenhuma alteração foi enviada à Uno.')
      setRedeemCode(''); await load()
    } catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }

  return <div className="module-grid">
    <form className="module-form stacked" onSubmit={(event) => void create(event)}>
      <strong>Nova campanha de indicação · começa em rascunho</strong>
      <input required minLength={2} maxLength={120} placeholder="Nome da campanha" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/>
      <textarea maxLength={1000} placeholder="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/>
      <div className="form-row"><label>Início<input required type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })}/></label><label>Término opcional<input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })}/></label></div>
      <label>Critério configurável<select value={form.qualificationCriterion} onChange={(e) => setForm({ ...form, qualificationCriterion: e.target.value })}><option value="LEAD_REGISTERED">Lead cadastrado com telefone válido</option><option value="FIRST_NATIVE_APPOINTMENT_COMPLETED">Primeiro agendamento nativo concluído</option></select></label>
      <fieldset><legend>Unidades participantes</legend>{units.map((unit) => <label key={unit.id}><input type="checkbox" checked={unitIds.includes(unit.id)} onChange={(e) => setUnitIds(e.target.checked ? [...unitIds, unit.id] : unitIds.filter((id) => id !== unit.id))}/>{unit.name}</label>)}</fieldset>
      <div className="form-row"><label>Qualificações por recompensa<input type="number" min={1} max={100000} value={form.rewardEveryQualifiedCount} onChange={(e) => setForm({ ...form, rewardEveryQualifiedCount: Number(e.target.value) })}/></label><label>Limite de recompensas por participante<input type="number" min={1} max={1000} value={form.maxRewardsPerParticipant} onChange={(e) => setForm({ ...form, maxRewardsPerParticipant: Number(e.target.value) })}/></label></div>
      <div className="form-row"><label>Tipo<select value={form.rewardType} onChange={(e) => setForm({ ...form, rewardType: e.target.value })}><option value="SESSION_CREDIT">Crédito operacional de sessões</option><option value="VOUCHER">Voucher</option><option value="DISCOUNT">Desconto</option><option value="SERVICE">Serviço</option></select></label><label>Quantidade<input type="number" min={1} max={100} value={form.rewardQuantity} onChange={(e) => setForm({ ...form, rewardQuantity: Number(e.target.value) })}/></label></div>
      <input required minLength={2} maxLength={500} placeholder="Descrição do benefício (ex.: até 5 sessões, conforme regra aprovada)" value={form.rewardDescription} onChange={(e) => setForm({ ...form, rewardDescription: e.target.value })}/>
      <div className="form-row"><label>Validade após emissão (dias)<input type="number" min={1} max={3650} value={form.rewardValidityDays} onChange={(e) => setForm({ ...form, rewardValidityDays: Number(e.target.value) })}/></label><small>Aprovação humana é sempre obrigatória.</small></div>
      <button className="primary" disabled={busy || !unitIds.length}>{busy ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Criar rascunho'}</button>{editingId && <button type="button" onClick={() => { setEditingId(''); setForm(initial) }}>Cancelar edição</button>}
    </form>

    <section className="module-form stacked"><strong>Campanhas e participantes</strong>
      {campaigns.map((campaign) => <article key={campaign.id}><b>{campaign.name} · {statusLabel(campaign.status)}</b><span>{campaign.qualificationCriterion === 'LEAD_REGISTERED' ? 'Lead cadastrado' : 'Agendamento nativo concluído'} · meta de {Number(campaign.rewardEveryQualifiedCount).toLocaleString('pt-BR')} · {campaign.rewardDescription}</span><small>Início: {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(campaign.startsAt))}{campaign.endsAt ? ` · término: ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(campaign.endsAt))}` : ' · sem término definido'} · {Number(campaign._count?.referrals ?? 0).toLocaleString('pt-BR')} indicações · {Number(campaign._count?.rewards ?? 0).toLocaleString('pt-BR')} recompensas</small><div className="referral-campaign-actions">{campaign.status !== 'ENDED' && <><button type="button" className="small-action" onClick={() => void status(campaign)}>{campaign.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}</button>{campaign.status !== 'ACTIVE' ? <button type="button" className="small-action" onClick={() => editCampaign(campaign)}>Editar</button> : <span className="form-hint">A edição fica indisponível enquanto a campanha está ativa.</span>}</>}</div></article>)}
      <hr/><strong>Emitir link para participante elegível</strong>
      <select value={selectedCampaignId} onChange={(e) => setSelectedCampaignId(e.target.value)}><option value="">Campanha ativa</option>{campaigns.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <select value={patientId} onChange={(e) => setPatientId(e.target.value)}><option value="">Paciente indicador</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}</option>)}</select>
      <select value={linkUnitId} onChange={(e) => setLinkUnitId(e.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>
      <button type="button" disabled={!selectedCampaignId || !patientId} onClick={() => void issueLink()}>Gerar link privado</button>
      <p>O clique só registra origem. O interessado não vira paciente e não recebe consentimento automaticamente.</p>
    </section>

    <section className="module-form stacked"><strong>Indicações e atribuição</strong>{referrals.map((referral) => <article key={referral.id}><b>{referral.campaign.name} · {statusLabel(referral.status)}</b><span>Indicador: {referral.indicatorPatient.fullName} · lead: {referral.leadPhoneNormalized ?? 'sem telefone ainda'}</span>{referral.patient ? <small>Paciente: {referral.patient.fullName} · {referral.appointment ? `conversão · ${statusLabel(referral.appointment.status)}` : 'aguardando critério'}</small> : ['LEAD_REGISTERED', 'QUALIFIED'].includes(referral.status) && <div className="form-row"><select aria-label="Paciente existente para associar" id={`associate-${referral.id}`}><option value="">Associar paciente existente</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}</option>)}</select><button type="button" onClick={() => { const id = (document.getElementById(`associate-${referral.id}`) as HTMLSelectElement | null)?.value; if (id) void associate(referral.id, id) }}>Associar</button></div>}{!['CANCELLED', 'REVERSED', 'REJECTED'].includes(referral.status) && <div className="form-row"><button type="button" onClick={() => void changeReferralStatus(referral, 'PENDING_VERIFICATION')}>Pedir verificação</button><button type="button" onClick={() => void changeReferralStatus(referral, 'CANCELLED')}>Cancelar</button>{referral.status === 'CONVERTED' && <button type="button" onClick={() => void changeReferralStatus(referral, 'REVERSED')}>Reverter conversão</button>}</div>}</article>)}</section>

    <section className="module-form stacked"><strong>Recompensas · sessão de cortesia é crédito interno, não Uno</strong>{rewards.map((reward) => <article key={reward.id}><b>{reward.campaign.name} · {statusLabel(reward.status)}</b><span>{reward.description} · {Number(reward.authorizedQty).toLocaleString('pt-BR')} · {reward.unit.name}</span><small>{reward.participant.patient.fullName}{reward.expiresAt ? ` · vence ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date(reward.expiresAt))}` : ''}{reward.voucherLast4 ? ` · final ${reward.voucherLast4}` : ''}</small>{reward.status === 'PENDING_APPROVAL' && <div><button type="button" onClick={() => void decision(reward.id, 'APPROVE')}>Aprovar</button><button type="button" onClick={() => void decision(reward.id, 'REJECT')}>Recusar</button></div>}{reward.status === 'APPROVED' && <button type="button" onClick={() => void issue(reward.id)}>Emitir voucher</button>}</article>)}</section>

    <form className="module-form stacked" onSubmit={(event) => void redeem(event)}><strong>Registrar resgate interno</strong><label>Código do voucher<input required minLength={10} maxLength={100} value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} /></label><label>Unidade do resgate<select required value={redeemUnitId} onChange={(event) => setRedeemUnitId(event.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label>Quantidade<input required type="number" min={1} max={100} value={redeemQuantity} onChange={(event) => setRedeemQuantity(Number(event.target.value))} /></label><button type="submit" disabled={busy || !redeemUnitId}>{busy ? 'Registrando…' : 'Confirmar resgate'}</button><small>O resgate atualiza somente o saldo interno do SaaS; não altera pacotes nem agenda Uno.</small></form>

    <section className="module-form stacked"><strong>Cartão fidelidade administrativo</strong><select value={loyalty ? loyalty.patient.id : ''} onChange={(e) => void showLoyalty(e.target.value)}><option value="">Selecionar paciente</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}</option>)}</select>{loyalty && <><b>{loyalty.patient.fullName}</b>{loyalty.progress.map((row: Row) => <article key={row.campaign.id}><b>{row.campaign.name} · {row.qualified}/{row.target}</b><span>{row.remaining ? `Faltam ${row.remaining} qualificações` : 'Meta atingida; aguarda revisão/aprovação humana'}</span></article>)}<small>{loyalty.referrals.length} indicações · {loyalty.rewards.length} benefícios</small></>}</section>
  </div>
}

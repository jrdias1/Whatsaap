import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './platform-admin.css'

type Request = (path: string, init?: RequestInit) => Promise<any>
type Section = 'Painel' | 'Clínicas' | 'Planos' | 'Assinaturas' | 'WhatsApp e integrações' | 'Uso e limites' | 'Registros e auditoria' | 'Pendências'
type Plan = { id: string; code: string; name: string; priceCents: number; patientLimit: number | null; messageLimitPerCycle: number; userLimit: number; unitLimit: number; connectionLimit: number; activeAutomationLimit: number; campaignLimitPerCycle: number }
type Tenant = { id: string; name: string; slug: string; status: string; createdAt: string; units?: { id: string; name: string; slug: string; active?: boolean; scheduleEnabled?: boolean }[]; subscription?: { id?: string; status: string; cycleStartsAt: string; cycleEndsAt: string; limitOverrides?: Record<string, number | null> | null; plan: Plan & { enabled?: boolean } } | null; _count?: { memberships: number; automations: number; tasks: number; patients?: number; outbox?: number } }
type TenantDetails = Tenant & { timezone: string; updatedAt: string; units: NonNullable<Tenant['units']>; memberships: any[]; invitations: any[]; unoConnections: any[]; metaConnections: any[]; evolutionConnections: any[]; automations: any[]; tasks: any[]; outbox: any[]; auditEvents: any[]; subscription: NonNullable<Tenant['subscription']> & { usageEntries: any[] } }
type Dashboard = { generatedAt: string; counts: Record<string, number>; usage: { activePatients: number; messagesReserved30d: number; campaignsReserved30d: number; activeAutomations: number; periodStart: string; periodEnd: string }; operations: { pendingInvitations: number; trialsEndingSoon: number; failedOutbox: number; pausedAutomations: number }; tenants: Tenant[]; plans: Plan[]; recentAudit: any[] }
type OneTimeAccess = { email: string; displayName: string; password: string }

const sections: { name: Section; icon: string; description: string }[] = [
  { name: 'Painel', icon: 'dashboard', description: 'Visão geral da plataforma' },
  { name: 'Clínicas', icon: 'clinic', description: 'Empresas, unidades e acessos' },
  { name: 'Planos', icon: 'plans', description: 'Catálogo e limites comerciais' },
  { name: 'Assinaturas', icon: 'subscription', description: 'Períodos e planos contratados' },
  { name: 'WhatsApp e integrações', icon: 'integrations', description: 'Conexões configuradas e estado conhecido' },
  { name: 'Uso e limites', icon: 'usage', description: 'Consumo e capacidade por clínica' },
  { name: 'Registros e auditoria', icon: 'audit', description: 'Atividades administrativas' },
  { name: 'Pendências', icon: 'pending', description: 'Itens que exigem acompanhamento' },
]

const limitFields: { key: keyof Plan; label: string; nullable?: boolean }[] = [
  { key: 'patientLimit', label: 'Pacientes ativos', nullable: true },
  { key: 'userLimit', label: 'Usuários' },
  { key: 'unitLimit', label: 'Unidades' },
  { key: 'connectionLimit', label: 'Conexões WhatsApp' },
  { key: 'activeAutomationLimit', label: 'Automações ativas' },
  { key: 'campaignLimitPerCycle', label: 'Campanhas por ciclo' },
  { key: 'messageLimitPerCycle', label: 'Mensagens por ciclo' },
]
const blank = { name: '', slug: '', unitName: '', unitSlug: '', adminName: '', adminEmail: '', adminPassword: '', confirmAdminPassword: '', planCode: 'STARTER', trialDays: 30 }
const detailTabs = ['Visão geral', 'Equipe', 'Assinatura', 'Limites e uso', 'Integrações', 'Pendências', 'Auditoria'] as const
type DetailTab = typeof detailTabs[number]

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    dashboard: 'M3 3h7v7H3z M14 3h7v4h-7z M14 10h7v11h-7z M3 14h7v7H3z',
    clinic: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6 M9 9h.01 M15 9h.01',
    plans: 'M4 6h16 M4 12h16 M4 18h10 M7 3v6 M17 9v6',
    subscription: 'M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16 M8 14h3 M8 17h6',
    integrations: 'M8 7h8 M8 17h8 M5 12h14 M7 5l-2 2 2 2 M17 15l2 2-2 2',
    usage: 'M4 19V5 M4 19h17 M8 16v-4 M13 16V8 M18 16V5',
    audit: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
    pending: 'M12 8v4l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    plus: 'M12 5v14 M5 12h14',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.35-4.35',
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.dashboard}/></svg>
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', ...(withTime ? { timeStyle: 'short' as const } : {}) }).format(date)
}
function money(cents: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100) }
function statusLabel(value?: string) { return ({ ACTIVE: 'Ativa', TRIAL: 'Em avaliação', SUSPENDED: 'Suspensa', CLOSED: 'Encerrada', CONNECTED: 'Conectada', DISCONNECTED: 'Desconectada', ERROR: 'Com erro', PENDING: 'Pendente', FAILED: 'Falhou', PAUSED: 'Pausada', TODO: 'A fazer', IN_PROGRESS: 'Em andamento' } as Record<string, string>)[value ?? ''] ?? value ?? '—' }
function limitValue(value: number | null | undefined, label: string) { return value == null ? (label === 'patientLimit' ? 'Sem limite comercial' : 'Sem limite') : new Intl.NumberFormat('pt-BR').format(value) }

function StatCard({ label, value, detail, icon, tone = '' }: { label: string; value: string | number; detail?: string; icon?: string; tone?: string }) {
  return <article className={`platform-stat ${tone}`}><div className="platform-stat-top"><span>{label}</span>{icon && <Icon name={icon}/>}</div><strong>{value}</strong>{detail && <small>{detail}</small>}</article>
}

export default function PlatformAdminPanel({ request, setNotice, identity, onLogout }: { request: Request; setNotice: (message: string) => void; identity: string; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [selected, setSelected] = useState<TenantDetails | null>(null)
  const [section, setSection] = useState<Section>('Painel')
  const [detailTab, setDetailTab] = useState<DetailTab>('Visão geral')
  const [form, setForm] = useState(blank)
  const [memberCreateForm, setMemberCreateForm] = useState({ displayName: '', email: '', role: 'OPERATOR', password: '', confirmPassword: '', unitIds: [] as string[] })
  const [oneTimeAccess, setOneTimeAccess] = useState<OneTimeAccess | null>(null)
  const [reason, setReason] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)

  const load = useCallback(async () => {
    setBusy(true); setError('')
    try { setDashboard(await request('/platform/dashboard')) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }, [request])
  useEffect(() => { void load() }, [load])

  async function refreshSelected(id = selected?.id) {
    await load()
    if (id) {
      try { setSelected(await request(`/platform/tenants/${id}`)) }
      catch (cause) { setError((cause as Error).message) }
    }
  }
  function notify(message: string) { setSuccess(message); setNotice(message) }
  function startProvisioning() {
    setSelected(null); setForm(blank)
    requestAnimationFrame(() => { const section = document.getElementById('clinic-provision-form'); section?.scrollIntoView({ behavior: 'smooth', block: 'start' }); section?.querySelector<HTMLInputElement>('input')?.focus() })
  }
  async function choose(tenant: Tenant, tab: DetailTab = 'Visão geral') {
    setError(''); setBusy(true)
    try { setSelected(await request(`/platform/tenants/${tenant.id}`)); setDetailTab(tab) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    if (form.adminPassword !== form.confirmAdminPassword) { setBusy(false); setError('As senhas do administrador não coincidem.'); return }
    try {
      const result = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ ...form, idempotencyKey: crypto.randomUUID() }) })
      if (!result.alreadyProvisioned && result.account && !result.account.reused) setOneTimeAccess({ email: form.adminEmail.trim().toLowerCase(), displayName: form.adminName, password: form.adminPassword })
      notify(result.alreadyProvisioned ? 'Esta chave já havia provisionado a empresa.' : result.account?.reused ? 'Clínica criada e conta de administrador existente vinculada; a senha foi preservada.' : 'Clínica e primeiro acesso administrativo criados. Nenhum e-mail foi enviado.')
      setForm(blank); await load()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function saveBasics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    try { await request(`/platform/tenants/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ name: selected.name, slug: selected.slug }) }); notify('Dados administrativos atualizados e auditados.'); await refreshSelected() }
    catch (cause) { setError((cause as Error).message) }
  }
  async function updateStatus(status: string) {
    if (!selected) return
    try { await request(`/platform/tenants/${selected.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }); setReason(''); notify(status === 'SUSPENDED' ? 'Clínica suspensa; sessões revogadas e itens antigos suprimidos.' : 'Clínica reativada. Integrações e execuções antigas continuam desativadas.'); await refreshSelected() }
    catch (cause) { setError((cause as Error).message) }
  }
  async function changePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const planCode = String(new FormData(event.currentTarget).get('planCode'))
    try { await request(`/platform/tenants/${selected.id}/plan`, { method: 'PATCH', body: JSON.stringify({ planCode }) }); notify('Plano atualizado. O catálogo global não foi alterado.'); await refreshSelected() }
    catch (cause) { setError((cause as Error).message) }
  }
  async function saveLimits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const data = new FormData(event.currentTarget); const overrides: Record<string, number | null | string> = {}
    for (const { key } of limitFields) { const raw = String(data.get(key) ?? ''); overrides[key] = key === 'patientLimit' && raw === '' ? null : Number(raw) }
    try { await request(`/platform/tenants/${selected.id}/limits`, { method: 'PATCH', body: JSON.stringify(overrides) }); notify('Limites desta clínica atualizados e auditados.'); await refreshSelected() }
    catch (cause) { setError((cause as Error).message) }
  }
  async function createClinicMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    if (memberCreateForm.password !== memberCreateForm.confirmPassword) { setError('As senhas não coincidem.'); return }
    setBusy(true); setError('')
    try {
      const result = await request(`/platform/tenants/${selected.id}/members`, { method: 'POST', body: JSON.stringify({ ...memberCreateForm, reason: 'Criado pelo Superadmin' }) })
      if (result.accountReused) setOneTimeAccess(null)
      else setOneTimeAccess({ email: memberCreateForm.email.trim().toLowerCase(), displayName: memberCreateForm.displayName, password: memberCreateForm.password })
      setMemberCreateForm({ displayName: '', email: '', role: 'OPERATOR', password: '', confirmPassword: '', unitIds: [] }); notify(result.accountReused ? 'Acesso vinculado. O usuário mantém a senha da conta existente.' : 'Usuário criado. A troca da senha provisória será obrigatória no primeiro acesso.'); await refreshSelected()
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  async function updateClinicMember(event: FormEvent<HTMLFormElement>, memberId: string) {
    event.preventDefault(); if (!selected) return
    const formElement = event.currentTarget
    const data = new FormData(formElement)
    const target = selected.memberships.find((member) => member.id === memberId)
    if (data.get('status') === 'DISABLED' && target?.status === 'ACTIVE' && !window.confirm(`Desativar o acesso de ${target.user.displayName} nesta clínica?`)) return
    setBusy(true); setError('')
    try {
      await request(`/platform/tenants/${selected.id}/memberships/${memberId}`, { method: 'PATCH', body: JSON.stringify({ displayName: data.get('displayName'), role: data.get('role'), status: data.get('status'), unitIds: data.getAll('unitIds'), reason: data.get('reason') }) })
      formElement.reset(); notify('Dados e acessos atualizados; sessões revogadas quando as permissões mudaram.'); await refreshSelected()
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  async function resetClinicMemberPassword(event: FormEvent<HTMLFormElement>, memberId: string) {
    event.preventDefault(); if (!selected) return
    const formElement = event.currentTarget
    const data = new FormData(formElement)
    if (data.get('password') !== data.get('confirmPassword')) { setError('As senhas não coincidem.'); return }
    if (!window.confirm('A senha desta conta será alterada em todas as clínicas às quais este e-mail tem acesso, e as sessões atuais serão encerradas. Deseja continuar?')) return
    setBusy(true); setError('')
    try {
      const result = await request(`/platform/tenants/${selected.id}/memberships/${memberId}/password`, { method: 'PATCH', body: JSON.stringify({ password: data.get('password'), reason: data.get('reason') }) })
      const target = selected.memberships.find((member) => member.id === memberId)
      if (target) setOneTimeAccess({ email: target.user.email, displayName: target.user.displayName, password: String(data.get('password')) })
      formElement.reset(); notify(`Senha redefinida; ${result.sessionsRevoked} sessão(ões) encerrada(s). A pessoa deverá trocar essa senha provisória no próximo acesso.`); await refreshSelected()
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  async function revokeClinicMemberSessions(event: FormEvent<HTMLFormElement>, memberId: string) {
    event.preventDefault(); if (!selected) return
    const formElement = event.currentTarget
    const data = new FormData(formElement)
    setBusy(true); setError('')
    try {
      const result = await request(`/platform/tenants/${selected.id}/memberships/${memberId}/revoke-sessions`, { method: 'POST', body: JSON.stringify({ reason: data.get('reason') }) })
      notify(`Sessões revogadas: ${result.revoked}.`); formElement.reset()
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }

  const visibleTenants = useMemo(() => (dashboard?.tenants ?? []).filter((tenant) => `${tenant.name} ${tenant.slug} ${tenant.subscription?.plan.name ?? ''}`.toLowerCase().includes(search.toLowerCase())), [dashboard?.tenants, search])
  const selectedPlan = dashboard?.plans.find((plan) => plan.code === selected?.subscription?.plan.code) ?? selected?.subscription?.plan
  const currentLimits = selected?.subscription?.limitOverrides ?? {}
  const displayLimit = (plan: Plan | undefined, key: keyof Plan) => currentLimits[key] === undefined ? plan?.[key] ?? '' : currentLimits[key]

  function openSection(next: Section) { setSection(next); setMobileMenu(false); setSelected(null); setError(''); setMemberCreateForm({ displayName: '', email: '', role: 'OPERATOR', password: '', confirmPassword: '', unitIds: [] }) }
  function renderTenantTeam() {
    if (!selected) return null
    const members = selected.memberships.filter((member) => member.role !== 'PLATFORM_SUPERADMIN' && !member.user.platformAdminIdentity)
    return <div className="platform-detail-content">
      <section className="platform-callout"><b>Um único Superadmin administra a plataforma.</b><p>Os acessos abaixo são usuários da clínica. Crie o login e a senha inicial aqui. A senha nunca é exibida depois de salva.</p></section>
      <section className="platform-card"><div className="platform-card-heading"><div><h3>Criar usuário</h3><p>Sem convite ou e-mail. Informe os dados, escolha o papel e as unidades. Uma conta nova usa a senha inicial informada; um e-mail já cadastrado mantém a senha atual.</p></div></div>
        <form className="platform-form" onSubmit={(event) => void createClinicMember(event)}>
          <label>Nome<input required minLength={2} maxLength={120} autoComplete="name" value={memberCreateForm.displayName} onChange={(event) => setMemberCreateForm({ ...memberCreateForm, displayName: event.target.value })}/></label>
          <label>E-mail de login<input required type="email" autoComplete="email" value={memberCreateForm.email} onChange={(event) => setMemberCreateForm({ ...memberCreateForm, email: event.target.value })}/></label>
          <label>Papel<select value={memberCreateForm.role} onChange={(event) => setMemberCreateForm({ ...memberCreateForm, role: event.target.value })}><option value="TENANT_ADMIN">Administrador da clínica</option><option value="UNIT_MANAGER">Gerente de unidade</option><option value="OPERATOR">Operador</option></select></label>
          <label>Senha inicial<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={memberCreateForm.password} onChange={(event) => setMemberCreateForm({ ...memberCreateForm, password: event.target.value })}/><small>Use pelo menos 8 caracteres. Você precisará compartilhar essa senha com a pessoa.</small></label>
          <label>Confirmar senha<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={memberCreateForm.confirmPassword} onChange={(event) => setMemberCreateForm({ ...memberCreateForm, confirmPassword: event.target.value })}/></label>
          <fieldset><legend>Unidades permitidas</legend>{selected.units.filter((unit) => unit.active).map((unit) => <label key={unit.id}><input type="checkbox" checked={memberCreateForm.unitIds.includes(unit.id)} onChange={(event) => setMemberCreateForm((current) => ({ ...current, unitIds: event.target.checked ? [...current.unitIds, unit.id] : current.unitIds.filter((id) => id !== unit.id) }))}/>{unit.name}</label>)}</fieldset>
          <button className="platform-button platform-button-primary" disabled={busy || !memberCreateForm.unitIds.length}>{busy ? 'Salvando…' : 'Criar usuário'}</button>
        </form>
      </section>
      <section className="platform-card"><div className="platform-card-heading"><div><h3>Usuários da clínica ({members.length})</h3><p>O e-mail é o login e não pode ser alterado aqui. Senhas não são exibidas. Contas com o mesmo e-mail compartilham o acesso entre clínicas.</p></div></div>
        <div className="platform-team-member-list">{members.map((member) => <article className="platform-team-member" key={member.id}>
          <span className="platform-clinic-mark">{member.user.displayName.slice(0, 1).toUpperCase()}</span><div className="platform-row-main"><b>{member.user.displayName}</b><small>{member.user.email}</small><small>{member.role === 'TENANT_ADMIN' ? 'Administrador da clínica' : member.role === 'UNIT_MANAGER' ? 'Gerente de unidade' : 'Operador'} · {member.status === 'ACTIVE' && member.user.active ? 'Ativo' : 'Inativo'}</small>{member.user.mustChangePassword && <small>Troca obrigatória da senha provisória no próximo acesso</small>}</div>
          <details><summary>Editar acesso</summary><form className="platform-form" onSubmit={(event) => void updateClinicMember(event, member.id)}>
            <label>Nome<input name="displayName" required minLength={2} maxLength={120} defaultValue={member.user.displayName}/></label>
            <label>Papel<select name="role" defaultValue={member.role}><option value="TENANT_ADMIN">Administrador da clínica</option><option value="UNIT_MANAGER">Gerente de unidade</option><option value="OPERATOR">Operador</option></select></label>
            <label>Status<select name="status" defaultValue={member.status === 'ACTIVE' && member.user.active ? 'ACTIVE' : 'DISABLED'}><option value="ACTIVE">Ativo</option><option value="DISABLED">Desativado</option></select></label>
            <fieldset><legend>Unidades permitidas</legend>{selected.units.filter((unit) => unit.active).map((unit) => <label key={unit.id}><input type="checkbox" name="unitIds" value={unit.id} defaultChecked={member.unitScopes.some((scope: { unitId: string }) => scope.unitId === unit.id)}/>{unit.name}</label>)}</fieldset>
            <label>Observação (opcional)<input name="reason" maxLength={500} placeholder="Ex.: solicitação do administrador"/></label>
            <button className="platform-button platform-button-secondary" disabled={busy}>Salvar alterações</button>
          </form></details>
          <details><summary>Redefinir senha</summary><form className="platform-form" onSubmit={(event) => void resetClinicMemberPassword(event, member.id)}>
            <p>A senha provisória será válida no próximo login e encerrará as sessões deste e-mail em todas as clínicas. A pessoa deverá definir uma nova senha antes de continuar.</p>
            <label>Nova senha<input name="password" required type="password" minLength={8} maxLength={72} autoComplete="new-password"/></label>
            <label>Confirmar senha<input name="confirmPassword" required type="password" minLength={8} maxLength={72} autoComplete="new-password"/></label>
            <label>Observação (opcional)<input name="reason" maxLength={500} placeholder="Ex.: senha esquecida"/></label>
            <button className="platform-button platform-button-secondary" disabled={busy || member.status !== 'ACTIVE' || !member.user.active}>Salvar nova senha</button>
          </form></details>
          <details><summary>Encerrar sessões</summary><form className="platform-form" onSubmit={(event) => void revokeClinicMemberSessions(event, member.id)}><label>Observação (opcional)<input name="reason" maxLength={500}/></label><button className="platform-button platform-button-secondary" disabled={busy}>Encerrar sessões</button></form></details>
        </article>)}{!members.length && <div className="platform-empty-inline">Nenhum usuário clínico associado.</div>}</div>
      </section>
    </div>
  }
  function renderDashboard() {
    if (!dashboard) return null
    const { counts, operations, usage } = dashboard
    return <>
      <div className="platform-stats platform-stats-primary">
        <StatCard label="Clínicas cadastradas" value={counts.tenants ?? 0} icon="clinic"/>
        <StatCard label="Clínicas ativas" value={counts.active ?? 0} icon="dashboard" tone="success"/>
        <StatCard label="Em avaliação" value={counts.trial ?? 0} icon="pending" tone="warning"/>
        <StatCard label="Suspensas" value={counts.suspended ?? 0} icon="audit" tone="danger"/>
      </div>
      <div className="platform-stats platform-stats-secondary">
        <StatCard label="Novas clínicas" value={counts.newTenants30d ?? 0} detail="Últimos 30 dias"/>
        <StatCard label="Unidades cadastradas" value={counts.units ?? 0}/>
        <StatCard label="Usuários ativos" value={counts.activeUsers ?? 0} detail="Em clínicas ativas ou em avaliação"/>
        <StatCard label="Conexões cadastradas" value={counts.configuredConnections ?? 0} detail="WhatsApp e Uno; inclui desconectadas"/>
      </div>
      <section className="platform-section-block">
        <div className="platform-section-heading"><div><span className="platform-eyebrow">ACOMPANHAMENTO</span><h3>Pendências operacionais</h3><p>Contagens calculadas a partir dos registros atuais, sem ações automáticas nesta tela.</p></div><button className="platform-text-button" onClick={() => setSection('Pendências')}>Ver pendências</button></div>
        <div className="platform-stats platform-stats-operations">
          <button className="platform-stat-link" onClick={() => setSection('Pendências')}><StatCard label="Convites pendentes" value={operations.pendingInvitations}/></button>
          <button className="platform-stat-link" onClick={() => setSection('Pendências')}><StatCard label="Avaliações vencem em até 7 dias" value={operations.trialsEndingSoon} tone="warning"/></button>
          <button className="platform-stat-link" onClick={() => setSection('Pendências')}><StatCard label="Itens de outbox com falha" value={operations.failedOutbox} tone={operations.failedOutbox ? 'danger' : ''}/></button>
          <button className="platform-stat-link" onClick={() => setSection('Pendências')}><StatCard label="Automações pausadas" value={operations.pausedAutomations}/></button>
        </div>
      </section>
      <section className="platform-section-block">
        <div className="platform-section-heading"><div><span className="platform-eyebrow">USO REGISTRADO</span><h3>Atividade dos últimos 30 dias</h3><p>Mensagens e campanhas representam reservas de cota no ledger, não confirmações de entrega.</p></div><span className="platform-period">{formatDate(usage.periodStart)} — {formatDate(usage.periodEnd)}</span></div>
        <div className="platform-stats platform-stats-usage">
          <StatCard label="Pacientes ativos" value={usage.activePatients}/>
          <StatCard label="Mensagens reservadas" value={usage.messagesReserved30d}/>
          <StatCard label="Campanhas reservadas" value={usage.campaignsReserved30d}/>
          <StatCard label="Automações ativas" value={usage.activeAutomations}/>
        </div>
      </section>
      <div className="platform-dashboard-columns">
        <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">CONTAS RECENTES</span><h3>Clínicas cadastradas</h3></div><button className="platform-text-button" onClick={() => setSection('Clínicas')}>Ver todas <span aria-hidden="true">→</span></button></div>
          <div className="platform-compact-list">{dashboard.tenants.slice(0, 6).map((tenant) => <article key={tenant.id}><span className="platform-clinic-mark">{tenant.name.slice(0, 1).toUpperCase()}</span><div className="platform-row-main"><b>{tenant.name}</b><small>{tenant.slug} · {tenant.subscription?.plan.name ?? 'Sem assinatura'}</small></div><span className={`platform-badge status-${tenant.status.toLowerCase()}`}>{statusLabel(tenant.status)}</span><button className="platform-icon-button" aria-label={`Administrar ${tenant.name}`} title="Administrar clínica" onClick={() => { setSection('Clínicas'); void choose(tenant) }}>›</button></article>)}</div>
          {dashboard.counts.tenants > dashboard.tenants.length && <p className="platform-footnote">A lista mostra as 200 clínicas mais recentes; os totais acima abrangem a plataforma inteira.</p>}
        </section>
        <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">TRILHA ADMINISTRATIVA</span><h3>Atividade recente</h3></div><button className="platform-text-button" onClick={() => setSection('Registros e auditoria')}>Abrir registros</button></div>
          <div className="platform-audit-list">{dashboard.recentAudit.slice(0, 7).map((event) => <article key={event.id}><span className="platform-audit-dot"/><div><b>{event.action.replaceAll('_', ' ').toLowerCase()}</b><small>{event.entityType}{event.entityId ? ` · ${event.entityId}` : ''} · ${event.tenantId ? 'clínica' : 'plataforma'}</small></div><time>{formatDate(event.occurredAt, true)}</time></article>)}</div>
          {!dashboard.recentAudit.length && <p className="platform-empty-inline">Ainda não há eventos administrativos registrados.</p>}
        </section>
      </div>
    </>
  }

  function renderTenantDetails() {
    if (!selected) return null
    const plan = selectedPlan
    return <section className="platform-detail-card">
      <div className="platform-detail-header"><button className="platform-back" onClick={() => setSelected(null)}>← Voltar às clínicas</button><div className="platform-detail-title"><div><span className="platform-eyebrow">ADMINISTRAÇÃO DA CLÍNICA</span><h2>{selected.name}</h2><p>{selected.slug} · criada em {formatDate(selected.createdAt)}</p></div><span className={`platform-badge status-${selected.status.toLowerCase()}`}>{statusLabel(selected.status)}</span></div></div>
      <nav className="platform-tabs" aria-label="Seções da clínica">{detailTabs.map((tab) => <button key={tab} className={detailTab === tab ? 'active' : ''} aria-current={detailTab === tab ? 'page' : undefined} onClick={() => setDetailTab(tab)}>{tab}</button>)}</nav>
      {detailTab === 'Visão geral' && <div className="platform-detail-content"><div className="platform-stats platform-stats-detail"><StatCard label="Unidades ativas" value={selected.units.filter((unit) => unit.active).length}/><StatCard label="Usuários ativos" value={selected.memberships.filter((member) => member.status === 'ACTIVE' && member.user.active).length}/><StatCard label="Pacientes cadastrados" value={selected._count?.patients ?? 0}/><StatCard label="Automações cadastradas" value={selected._count?.automations ?? 0}/></div><div className="platform-info-grid"><section><h3>Identificação</h3><p><b>Empresa:</b> {selected.name}</p><p><b>Identificador:</b> {selected.slug}</p><p><b>Fuso:</b> {selected.timezone}</p><p><b>Conta criada:</b> {formatDate(selected.createdAt, true)}</p></section><section><h3>Unidades</h3>{selected.units.map((unit) => <p key={unit.id}><b>{unit.name}</b><small>{unit.active ? 'Ativa' : 'Inativa'} · agenda {unit.scheduleEnabled ? 'habilitada' : 'não habilitada'}</small></p>)}</section><section><h3>Administradores e equipe</h3><p>Esta lista mostra os usuários da clínica. Para criar um acesso, editar papel ou unidades e redefinir senha, use a aba <b>Equipe</b>. O Superadmin é uma única conta global da plataforma.</p>{selected.memberships.slice(0, 10).map((member) => <p key={member.id}><b>{member.user.displayName}</b><small>{member.user.email} · {member.role} · {statusLabel(member.status)}</small></p>)}{!selected.memberships.length && <p>Nenhum usuário associado.</p>}</section></div><form className="platform-form platform-form-admin" onSubmit={saveBasics}><h3>Dados administrativos</h3><label>Nome da clínica<input required maxLength={160} value={selected.name} onChange={(event) => setSelected({ ...selected, name: event.target.value })}/></label><label>Identificador único<input required value={selected.slug} onChange={(event) => setSelected({ ...selected, slug: event.target.value })}/></label><button className="platform-button platform-button-secondary">Salvar dados</button></form></div>}
      {detailTab === 'Equipe' && renderTenantTeam()}
      {detailTab === 'Assinatura' && <div className="platform-detail-content"><section className="platform-subscription-summary"><span className="platform-eyebrow">PLANO E ACESSO</span><h3>{selected.subscription?.plan.name ?? 'Sem assinatura'}</h3><p>Status da assinatura: <b>{statusLabel(selected.subscription?.status)}</b></p><p>Ciclo: {formatDate(selected.subscription?.cycleStartsAt)} até {formatDate(selected.subscription?.cycleEndsAt)}</p><small>Esta tela não processa cobranças. Os valores exibidos no catálogo são referências comerciais cadastradas.</small></section><form className="platform-form platform-form-admin" onSubmit={changePlan}><h3>Alterar plano desta clínica</h3><label>Novo plano<select name="planCode" defaultValue={selected.subscription?.plan.code}>{dashboard?.plans.map((item) => <option key={item.code} value={item.code}>{item.name} · {money(item.priceCents)}</option>)}</select></label><button className="platform-button platform-button-primary" >Salvar plano</button></form></div>}
      {detailTab === 'Limites e uso' && <div className="platform-detail-content"><p className="platform-callout">Uso financeiro não é calculado nesta área. Valores de uso abaixo vêm do ledger e registros operacionais atuais da clínica.</p><div className="platform-usage-overview"><StatCard label="Pacientes ativos" value={selected._count?.patients ?? 0}/><StatCard label="Usuários ativos" value={selected.memberships.filter((member) => member.status === 'ACTIVE' && member.user.active).length}/><StatCard label="Automações cadastradas" value={selected._count?.automations ?? 0}/><StatCard label="Itens de outbox registrados" value={selected._count?.outbox ?? 0}/></div><form className="platform-form platform-limit-form" onSubmit={saveLimits}><h3>Limites efetivos da clínica</h3><p>Valores sobrescritos nesta tela se aplicam somente a esta assinatura; não alteram o catálogo global.</p>{limitFields.map(({ key, label, nullable }) => <label key={key}>{label}<input type="number" min={0} max={1000000} value={displayLimit(plan, key) ?? ''} placeholder={nullable ? 'sem limite comercial' : '—'} onChange={(event) => setSelected({ ...selected, subscription: { ...selected.subscription, limitOverrides: { ...currentLimits, [key]: event.target.value === '' && nullable ? null : Number(event.target.value) } } as TenantDetails['subscription'] })}/></label>)}<button className="platform-button platform-button-secondary" >Salvar limites</button></form><section className="platform-ledger"><h3>Registros recentes de uso</h3>{selected.subscription?.usageEntries?.length ? <div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Métrica</th><th>Quantidade</th><th>Ciclo</th><th>Registrado</th></tr></thead><tbody>{selected.subscription.usageEntries.slice(0, 30).map((entry, index) => <tr key={`${entry.metric}-${entry.createdAt}-${index}`}><td>{entry.metric}</td><td>{entry.quantity}</td><td>{formatDate(entry.cycleStartsAt)} — {formatDate(entry.cycleEndsAt)}</td><td>{formatDate(entry.createdAt, true)}</td></tr>)}</tbody></table></div> : <p>Nenhum registro de consumo foi encontrado.</p>}</section></div>}
      {detailTab === 'Integrações' && <div className="platform-detail-content"><p className="platform-callout">Consulta somente de metadados de estado. Segredos não são exibidos e nenhuma conexão externa é consultada ou alterada.</p><div className="platform-info-grid"><section><h3>Meta Cloud</h3>{selected.metaConnections.map((item) => <p key={item.id}><b>{item.displayName}</b><small>Unidade {selected.units.find((unit) => unit.id === item.unitId)?.name ?? '—'} · {statusLabel(item.status)} · {item.enabled ? 'habilitada' : 'desabilitada'}</small></p>)}{!selected.metaConnections.length && <p>Nenhuma conexão cadastrada.</p>}</section><section><h3>Evolution</h3>{selected.evolutionConnections.map((item) => <p key={item.id}><b>{item.displayName}</b><small>{item.mode} · {statusLabel(item.status)} · {item.enabled ? 'habilitada' : 'desabilitada'}</small></p>)}{!selected.evolutionConnections.length && <p>Nenhuma conexão cadastrada.</p>}</section><section><h3>Uno por unidade</h3>{selected.units.map((unit) => { const uno = selected.unoConnections.find((item) => item.unitId === unit.id); return <p key={unit.id}><b>{unit.name}</b><small>Fonte {uno?.sourceOfTruth ?? 'NATIVE'} · {uno ? statusLabel(uno.status) : 'sem conexão configurada'} · escrita {uno?.writeEnabled ? 'habilitada' : 'desabilitada'} · última verificação {formatDate(uno?.lastCheckedAt, true)}</small></p> })}{!selected.units.length && <p>Nenhuma unidade cadastrada.</p>}</section></div></div>}
      {detailTab === 'Pendências' && <div className="platform-detail-content"><div className="platform-stats platform-stats-detail"><StatCard label="Tarefas abertas" value={selected.tasks.length}/><StatCard label="Falhas na outbox" value={selected.outbox.filter((item) => item.status === 'FAILED').length} tone={selected.outbox.some((item) => item.status === 'FAILED') ? 'danger' : ''}/><StatCard label="Mensagens pendentes ou em retry" value={selected.outbox.filter((item) => ['PENDING', 'RETRY'].includes(item.status)).length}/><StatCard label="Automações pausadas" value={selected.automations.filter((item) => item.status === 'PAUSED').length}/></div><div className="platform-info-grid"><section><h3>Tarefas operacionais</h3>{selected.tasks.map((task) => <p key={task.id}><b>Pendência operacional</b><small>{statusLabel(task.status)} · {task.priority} · vence {formatDate(task.dueAt)}</small></p>)}{!selected.tasks.length && <p>Sem tarefas abertas registradas.</p>}</section><section><h3>Outbox</h3>{selected.outbox.slice(0, 20).map((item) => <p key={item.id}><b>{item.purpose}</b><small>{statusLabel(item.status)} · {formatDate(item.createdAt, true)}</small></p>)}{!selected.outbox.length && <p>Sem itens pendentes ou falhos.</p>}</section></div><div className="platform-reauth"><label>Motivo para suspender/reativar<input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label><button className={selected.status === 'SUSPENDED' ? 'platform-button platform-button-primary' : 'platform-button platform-button-danger'} type="button" disabled={!reason} onClick={() => void updateStatus(selected.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}>{selected.status === 'SUSPENDED' ? 'Reativar clínica' : 'Suspender clínica'}</button></div></div>}
      {detailTab === 'Auditoria' && <div className="platform-detail-content"><AuditList events={selected.auditEvents}/></div>}
    </section>
  }

  function renderSection() {
    if (!dashboard) return <div className="platform-loading" role="status">Carregando dados da plataforma…</div>
    if (section === 'Painel') return renderDashboard()
    if (section === 'Clínicas') return <>
      <div className="platform-page-actions"><label className="platform-search"><Icon name="search"/><input aria-label="Buscar clínicas" placeholder="Buscar clínica, identificador ou plano" value={search} onChange={(event) => setSearch(event.target.value)}/></label><button className="platform-button platform-button-primary" onClick={startProvisioning}><Icon name="plus"/> Nova clínica</button></div>
      {!selected && <div className="platform-clinic-layout"><section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">CLÍNICAS</span><h3>Clínicas cadastradas</h3><p>Mostrando até 200 clínicas mais recentes.</p></div></div><div className="platform-tenant-list">{visibleTenants.map((tenant) => <article key={tenant.id}><span className="platform-clinic-mark">{tenant.name.slice(0, 1).toUpperCase()}</span><div className="platform-row-main"><b>{tenant.name}</b><small>{tenant.slug}</small><small>{tenant.units?.length ?? 0} unidades ativas · {tenant._count?.memberships ?? 0} usuários · {tenant._count?.automations ?? 0} automações</small></div><div className="platform-tenant-meta"><span className={`platform-badge status-${tenant.status.toLowerCase()}`}>{statusLabel(tenant.status)}</span><small>{tenant.subscription?.plan.name ?? 'Sem assinatura'}</small></div><button className="platform-button platform-button-secondary" onClick={() => void choose(tenant)}>Administrar</button></article>)}{!visibleTenants.length && <div className="platform-empty"><Icon name="clinic"/><b>Nenhuma clínica encontrada</b><span>Tente buscar por nome, identificador ou plano.</span></div>}</div></section>
        <ClinicProvisionForm form={form} setForm={setForm} plans={dashboard.plans} busy={busy} onSubmit={createTenant}/></div>}
      {selected && renderTenantDetails()}
    </>
    if (section === 'Planos') return <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">CATÁLOGO COMERCIAL</span><h3>Planos disponíveis</h3><p>Consulta do catálogo vigente. Alterações de preço ou limites globais não estão disponíveis aqui.</p></div></div><div className="platform-plan-grid">{dashboard.plans.map((plan) => <article className="platform-plan-card" key={plan.id}><div className="platform-plan-title"><div><span className="platform-eyebrow">{plan.code}</span><h3>{plan.name}</h3></div><strong>{money(plan.priceCents)}<small>/mês · referência comercial</small></strong></div><ul>{limitFields.map(({ key, label }) => <li key={key}><span>{label}</span><b>{limitValue(plan[key] as number | null, key)}</b></li>)}</ul><small className="platform-footnote">Plano somente para consulta nesta tela.</small></article>)}</div></section>
    if (section === 'Assinaturas') return <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">ACESSO AO PRODUTO</span><h3>Assinaturas e períodos</h3><p>As datas refletem os ciclos registrados; esta tela não efetua cobranças nem renovações.</p></div></div><div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Clínica</th><th>Plano</th><th>Status</th><th>Início do ciclo</th><th>Fim do ciclo</th><th>Ação</th></tr></thead><tbody>{dashboard.tenants.map((tenant) => <tr key={tenant.id}><td><b>{tenant.name}</b><small>{tenant.slug}</small></td><td>{tenant.subscription?.plan.name ?? 'Sem assinatura'}</td><td><span className={`platform-badge status-${(tenant.subscription?.status ?? tenant.status).toLowerCase()}`}>{statusLabel(tenant.subscription?.status ?? tenant.status)}</span></td><td>{formatDate(tenant.subscription?.cycleStartsAt)}</td><td>{formatDate(tenant.subscription?.cycleEndsAt)}</td><td><button className="platform-text-button" onClick={() => { setSection('Clínicas'); void choose(tenant) }}>Administrar</button></td></tr>)}</tbody></table></div></section>
    if (section === 'WhatsApp e integrações') return <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">ESTADO REGISTRADO</span><h3>WhatsApp e integrações</h3><p>Selecione uma clínica para consultar metadados das conexões. Nenhum segredo é exibido e não há chamadas externas.</p></div></div>{selected ? renderTenantDetails() : <div className="platform-tenant-list">{dashboard.tenants.map((tenant) => <article key={tenant.id}><span className="platform-clinic-mark">{tenant.name.slice(0, 1).toUpperCase()}</span><div className="platform-row-main"><b>{tenant.name}</b><small>{tenant.slug} · {tenant.subscription?.plan.name ?? 'Sem assinatura'}</small></div><button className="platform-button platform-button-secondary" onClick={() => { setSection('WhatsApp e integrações'); void choose(tenant, 'Integrações') }}>Ver estado</button></article>)}</div>}</section>
    if (section === 'Uso e limites') return <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">CAPACIDADE E CONSUMO</span><h3>Uso e limites por clínica</h3><p>Contagens de registros não são envio entregue. Para ver cotas por ciclo, abra os registros de uso da clínica.</p></div></div>{selected ? renderTenantDetails() : <div className="platform-tenant-list">{dashboard.tenants.map((tenant) => <article key={tenant.id}><span className="platform-clinic-mark">{tenant.name.slice(0, 1).toUpperCase()}</span><div className="platform-row-main"><b>{tenant.name}</b><small>{tenant.subscription?.plan.name ?? 'Sem assinatura'} · {tenant._count?.memberships ?? 0} usuários · {tenant.units?.length ?? 0} unidades</small></div><button className="platform-button platform-button-secondary" onClick={() => { setSection('Uso e limites'); void choose(tenant, 'Limites e uso') }}>Ver uso e limites</button></article>)}</div>}</section>
    if (section === 'Registros e auditoria') return <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">TRILHA DE ACESSO</span><h3>Auditoria global</h3><p>Eventos recentes registrados pela plataforma. Leituras sensíveis permanecem auditadas.</p></div></div><AuditList events={dashboard.recentAudit}/></section>
    return <>
      <div className="platform-stats platform-stats-operations">
        <StatCard label="Convites pendentes e válidos" value={dashboard.operations.pendingInvitations} tone={dashboard.operations.pendingInvitations ? 'warning' : ''}/>
        <StatCard label="Avaliações que encerram em até 7 dias" value={dashboard.operations.trialsEndingSoon} tone={dashboard.operations.trialsEndingSoon ? 'warning' : ''}/>
        <StatCard label="Mensagens na fila com falha" value={dashboard.operations.failedOutbox} tone={dashboard.operations.failedOutbox ? 'danger' : ''}/>
        <StatCard label="Automações pausadas" value={dashboard.operations.pausedAutomations}/>
      </div>
      <section className="platform-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">ATENÇÃO OPERACIONAL</span><h3>Clínicas com pendências consultáveis</h3><p>Abra uma clínica para ver tarefas abertas e mensagens pendentes, em nova tentativa ou com falha.</p></div></div><div className="platform-tenant-list">{dashboard.tenants.filter((tenant) => (tenant._count?.tasks ?? 0) + (tenant._count?.outbox ?? 0) > 0).map((tenant) => <article key={tenant.id}><span className="platform-clinic-mark">{tenant.name.slice(0, 1).toUpperCase()}</span><div className="platform-row-main"><b>{tenant.name}</b><small>{tenant._count?.tasks ?? 0} tarefas abertas; {tenant._count?.outbox ?? 0} mensagens na fila · {tenant.subscription?.plan.name ?? 'Sem assinatura'}</small></div><button className="platform-button platform-button-secondary" onClick={() => { setSection('Clínicas'); void choose(tenant); setDetailTab('Pendências') }}>Consultar</button></article>)}{!dashboard.tenants.some((tenant) => (tenant._count?.tasks ?? 0) + (tenant._count?.outbox ?? 0) > 0) && <div className="platform-empty-inline">Nenhuma tarefa ou mensagem pendente nas clínicas listadas.</div>}</div>{dashboard.counts.tenants > dashboard.tenants.length && <p className="platform-footnote">A lista de pendências por clínica considera somente as 200 clínicas mais recentes; os totais de cima abrangem toda a plataforma.</p>}</section>
    </>
  }

  const activeDescription = sections.find((item) => item.name === section)?.description
  return <div className="platform-shell">
    <aside className={`platform-sidebar ${mobileMenu ? 'is-open' : ''}`}>
      <div className="platform-brand"><span className="platform-brand-mark">e</span><span><b>essencial</b><small>CLÍNICAS</small></span></div>
      <div className="platform-context"><span className="platform-context-dot"/><div><b>ESSENCIAL COMUNICAÇÃO</b><small>Administração da plataforma</small></div></div>
      <span className="platform-nav-label">PLATAFORMA</span>
      <nav className="platform-nav">{sections.map((item) => <button key={item.name} className={section === item.name ? 'active' : ''} aria-current={section === item.name ? 'page' : undefined} onClick={() => openSection(item.name)}><Icon name={item.icon}/><span>{item.name}</span>{item.name === 'Pendências' && (dashboard?.operations.pendingInvitations ?? 0) + (dashboard?.operations.trialsEndingSoon ?? 0) + (dashboard?.operations.failedOutbox ?? 0) > 0 && <i aria-label="Existem pendências">!</i>}</button>)}</nav>
      <div className="platform-sidebar-bottom"><div className="platform-user"><span>{identity.slice(0, 1).toUpperCase() || 'S'}</span><div><b>{identity || 'Superadmin'}</b><small>Administrador global</small></div></div><button className="platform-logout" onClick={onLogout}><span aria-hidden="true">↪</span> Sair</button></div>
    </aside>
    {mobileMenu && <button className="platform-mobile-overlay" aria-label="Fechar menu" onClick={() => setMobileMenu(false)}/>}
    <div className="platform-workspace">
      <header className="platform-topbar"><button className="platform-menu-toggle" aria-label="Abrir menu" onClick={() => setMobileMenu(true)}>☰</button><div className="platform-breadcrumb"><span>Plataforma</span><i>/</i><b>{section}</b></div><div className="platform-topbar-right"><span className="platform-global-badge"><Icon name="audit"/> Acesso global auditado</span><button className="platform-refresh" onClick={() => void refreshSelected()} disabled={busy}>{busy ? 'Atualizando…' : 'Atualizar dados'}</button><button className="platform-top-logout" onClick={onLogout}>Sair</button></div></header>
      <main className="platform-content"><div className="platform-page-heading"><div><h1>{section}</h1><p>{activeDescription}</p></div>{section === 'Clínicas' && <button className="platform-button platform-button-primary platform-heading-create" onClick={startProvisioning}><Icon name="plus"/> Provisionar clínica</button>}</div>
        {success && <div className="platform-success" role="status"><span>{success}</span><button onClick={() => setSuccess('')} aria-label="Fechar aviso">×</button></div>}
        {error && <div className="platform-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar erro">×</button></div>}
        {oneTimeAccess && <div className="platform-callout" role="status"><b>Acesso provisório — entregue em canal privado</b><p>{oneTimeAccess.displayName} · {oneTimeAccess.email}</p><p>Senha provisória: <code>{oneTimeAccess.password}</code></p><p>A pessoa deverá definir uma nova senha antes de continuar. Este valor deixará de ser exibido ao fechar este aviso ou sair.</p><button className="platform-button platform-button-secondary" type="button" onClick={() => { void navigator.clipboard.writeText(`Login: ${oneTimeAccess.email}\nSenha provisória: ${oneTimeAccess.password}`).then(() => notify('Dados temporários copiados. Entregue-os em canal privado.')).catch(() => setError('Não foi possível copiar automaticamente. Selecione os dados exibidos.')) }}>Copiar acesso</button><button className="platform-button platform-button-secondary" type="button" onClick={() => setOneTimeAccess(null)}>Ocultar senha</button></div>}
        {renderSection()}
        <footer className="platform-footer"><span>Essencial Clínicas · Administração da plataforma</span><span>Dados atualizados {formatDate(dashboard?.generatedAt, true)}</span></footer>
      </main>
    </div>
  </div>
}

function ClinicProvisionForm({ form, setForm, plans, busy, onSubmit }: { form: typeof blank; setForm: (next: typeof blank) => void; plans: Plan[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <section id="clinic-provision-form" className="platform-card platform-provision-card"><div className="platform-card-heading"><div><span className="platform-eyebrow">ONBOARDING</span><h3>Provisionar clínica</h3><p>Cria a clínica, a primeira unidade, a assinatura e o acesso do administrador em uma transação.</p></div></div><form className="platform-form" onSubmit={onSubmit}>
    <label>Nome da clínica<input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
    <label>Identificador único<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}/></label>
    <label>Primeira unidade<input required value={form.unitName} onChange={(event) => setForm({ ...form, unitName: event.target.value })}/></label>
    <label>Identificador da unidade<input value={form.unitSlug} placeholder="Gerado a partir do nome" onChange={(event) => setForm({ ...form, unitSlug: event.target.value.toLowerCase() })}/></label>
    <label>Administrador inicial<input required value={form.adminName} onChange={(event) => setForm({ ...form, adminName: event.target.value })}/></label>
    <label>E-mail administrativo<input required type="email" value={form.adminEmail} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })}/></label>
    <label>Senha inicial<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={form.adminPassword} onChange={(event) => setForm({ ...form, adminPassword: event.target.value })}/></label>
    <label>Confirmar senha<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={form.confirmAdminPassword} onChange={(event) => setForm({ ...form, confirmAdminPassword: event.target.value })}/></label>
    <label>Plano inicial<select value={form.planCode} onChange={(event) => setForm({ ...form, planCode: event.target.value })}>{plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {money(plan.priceCents)}</option>)}</select></label>
    <label>Período inicial (dias)<input type="number" required min={1} max={90} value={form.trialDays} onChange={(event) => setForm({ ...form, trialDays: Number(event.target.value) })}/></label>
    <p className="platform-form-note">O administrador entra com e-mail, identificador da clínica e senha provisória. No primeiro acesso, deverá definir uma nova senha antes de continuar. Se a conta já existir em outra clínica, ela será vinculada e manterá a senha atual. Não enviamos e-mail nem ativamos integrações nesta tela.</p>
    <button className="platform-button platform-button-primary platform-form-submit" disabled={busy}>{busy ? 'Provisionando…' : 'Provisionar clínica'}</button>
  </form></section>
}

function AuditList({ events }: { events: any[] }) {
  return <div className="platform-audit-list">{events.map((event) => <article key={event.id}><span className="platform-audit-dot"/><div><b>{event.action.replaceAll('_', ' ').toLowerCase()}</b><small>{event.entityType}{event.entityId ? ` · ${event.entityId}` : ''} · {event.tenantId ? `clínica ${event.tenantId}` : 'plataforma'} · ator {event.actorUserId ?? 'sistema'}</small></div><time>{formatDate(event.occurredAt, true)}</time></article>)}{!events.length && <div className="platform-empty-inline">Nenhum evento de auditoria encontrado.</div>}</div>
}

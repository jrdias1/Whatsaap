import { useEffect, useState } from 'react'
import './phase10-admin.css'

type Request = (path: string, init?: RequestInit) => Promise<any>
type Unit = { id: string; name: string; slug: string; contactEmail: string | null; contactPhone: string | null; address: string | null }
type Clinic = { id: string; name: string; displayName: string | null; legalName: string | null; contactEmail: string | null; contactPhone: string | null; address: string | null; accentColor: string | null; secondaryColor: string | null; institutionalText: string | null }
const blank: Omit<Clinic, 'id' | 'name'> = { displayName: '', legalName: '', contactEmail: '', contactPhone: '', address: '', accentColor: '', secondaryColor: '', institutionalText: '' }

export default function ClinicSettingsPage({ request, setNotice, onThemeUpdated, onNavigate, refreshKey }: { request: Request; setNotice: (value: string) => void; onThemeUpdated: (clinic: Clinic | null) => void; onNavigate: (page: string) => void; refreshKey: number }) {
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [form, setForm] = useState(blank)
  const [units, setUnits] = useState<Unit[]>([])
  const [unitForms, setUnitForms] = useState<Record<string, Pick<Unit, 'contactEmail' | 'contactPhone' | 'address'>>>({})
  const [progress, setProgress] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  async function load() {
    try {
      const [settings, nextProgress] = await Promise.all([request('/settings/tenant'), request('/settings/setup')])
      setClinic(settings.tenant); setUnits(settings.units); setProgress(nextProgress)
      setForm(Object.fromEntries(Object.keys(blank).map((key) => [key, settings.tenant?.[key] ?? ''])) as typeof blank)
      setUnitForms(Object.fromEntries(settings.units.map((unit: Unit) => [unit.id, { contactEmail: unit.contactEmail ?? '', contactPhone: unit.contactPhone ?? '', address: unit.address ?? '' }])))
    } catch (error) { setNotice((error as Error).message) }
  }
  useEffect(() => { void load() }, [refreshKey])
  async function saveClinic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true)
    try { const saved = await request('/settings/tenant', { method: 'PATCH', body: JSON.stringify(form) }); setClinic(saved); onThemeUpdated(saved); setNotice('Dados e identidade visual atualizados para esta clínica.') }
    catch (error) { const message = (error as Error).message; setNotice(/accentColor|secondaryColor|contraste/i.test(message) ? 'Escolha uma cor mais escura para garantir a leitura do texto branco. Use o formato hexadecimal, como #087E72.' : message) } finally { setBusy(false) }
  }
  async function saveUnit(id: string) {
    setBusy(true)
    try { const saved = await request(`/settings/units/${id}`, { method: 'PATCH', body: JSON.stringify(unitForms[id]) }); setUnits((current) => current.map((unit) => unit.id === id ? { ...unit, ...saved } : unit)); setNotice('Contato da unidade atualizado.') }
    catch (error) { setNotice((error as Error).message) } finally { setBusy(false) }
  }
  const nav = (page: string) => onNavigate(page)
  return <div className="phase10-admin">
    <section className="phase10-card"><div className="phase10-heading"><div><h2>Configurações da clínica</h2><p>Dados e identidade visual aplicados somente nesta clínica.</p></div>{progress && <strong className="phase10-progress">{progress.completed}/{progress.total} etapas · {progress.percent}%</strong>}</div>
      {progress && <div className="phase10-steps" aria-label="Progresso baseado em configurações salvas">{progress.steps.map((step: any) => <article key={step.key} className={step.optional ? 'optional' : ''}><span aria-hidden="true">{step.complete ? '✓' : '○'}</span><div><strong>{step.label}</strong><small>{step.optional ? 'Opcional' : step.complete ? 'Concluída com dados salvos' : 'Pendente; abrir a etapa não marca como concluída'}</small></div><button type="button" onClick={() => { if (step.key === 'clinic') { const target = document.getElementById('clinic-branding'); target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); target?.focus() } else nav(({ unit: 'Configurações', team: 'Equipe', procedures: 'Procedimentos', resources: 'Recursos', schedule: 'Agenda', calendar: 'Agenda', consents: 'Pacientes', channels: 'Canais', automations: 'Automações' } as Record<string, string>)[step.key] ?? 'Configurações') }}>Abrir</button></article>)}</div>}
    </section>
    <section className="phase10-card" id="clinic-branding" tabIndex={-1}><h2>Dados e identidade visual</h2><p>Texto simples, sem código ou marcação. A plataforma Essencial mantém sua própria identidade.</p><form className="phase10-form phase10-grid" onSubmit={(event) => void saveClinic(event)}>{[
      ['displayName', 'Nome de exibição', 'text'], ['legalName', 'Razão social', 'text'], ['contactEmail', 'E-mail de contato', 'email'], ['contactPhone', 'Telefone de contato', 'tel'], ['address', 'Endereço', 'text'], ['accentColor', 'Cor de destaque (hexadecimal)', 'color'], ['secondaryColor', 'Cor secundária (hexadecimal)', 'color'],
    ].map(([key, label, type]) => <label key={key}>{label}<input type={type === 'color' ? 'text' : type} pattern={type === 'color' ? '#[0-9a-fA-F]{6}' : undefined} placeholder={type === 'color' ? '#087E72' : undefined} title={type === 'color' ? 'Informe uma cor hexadecimal de seis dígitos, como #087E72.' : undefined} value={String(form[key as keyof typeof form] ?? '')} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}<label className="phase10-wide">Texto institucional<textarea maxLength={1000} value={form.institutionalText ?? ''} onChange={(event) => setForm({ ...form, institutionalText: event.target.value })} /></label><button className="primary" disabled={busy}>Salvar dados da clínica</button></form>{clinic && <p className="phase10-muted">Nome de cadastro: {clinic.name} · Identificador: <code translate="no">{clinic.id}</code></p>}</section>
    <section className="phase10-card"><h2>Unidades</h2>{units.map((unit) => <article className="phase10-unit" key={unit.id}><div><h3>{unit.name}</h3><small translate="no">{unit.slug}</small></div><div className="phase10-form phase10-grid">{(['contactEmail', 'contactPhone', 'address'] as const).map((key) => <label key={key}>{key === 'contactEmail' ? 'E-mail' : key === 'contactPhone' ? 'Telefone' : 'Endereço'}<input type={key === 'contactEmail' ? 'email' : key === 'contactPhone' ? 'tel' : 'text'} value={unitForms[unit.id]?.[key] ?? ''} onChange={(event) => setUnitForms((current) => ({ ...current, [unit.id]: { ...current[unit.id]!, [key]: event.target.value } }))} /></label>)}<button type="button" className="primary" disabled={busy} onClick={() => void saveUnit(unit.id)}>Salvar unidade</button></div></article>)}</section>
    <section className="phase10-card"><h2>Áreas de configuração</h2><div className="phase10-settings-links">{[['Equipe e permissões', 'Equipe'], ['Procedimentos e automações', 'Automações'], ['Profissionais e recursos', 'Recursos'], ['Expediente e agenda', 'Agenda'], ['Atendimento e consentimentos', 'Pacientes'], ['Integrações', 'Canais'], ['Plano e consumo', 'Plano'], ['Solicitações de privacidade', 'Privacidade']].map(([label, page]) => <button key={label} type="button" onClick={() => nav(page)}>{label}<span aria-hidden="true">→</span></button>)}</div><p className="phase10-muted">Esta área centraliza atalhos para telas existentes e evita duplicar formulários ou regras de domínio. Não ativa provedores nem envio de mensagens.</p></section>
    <section className="phase10-card"><h2>Armazenamento de marca</h2><p>O projeto ainda não tem armazenamento de arquivos com controle de acesso e validação de conteúdo adequado para logotipos. O upload permanece indisponível; use somente as cores e textos validados acima.</p></section>
  </div>
}

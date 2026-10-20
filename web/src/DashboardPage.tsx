import { useEffect, useState } from 'react'
import './dashboard.css'
import './dashboard-refinement.css'

type Row = Record<string, any> & { id: string }
type Overview = { clinicName: string; dayStart: string; units: { id: string; name: string }[]; metrics: { appointmentsToday: number; confirmedToday: number; awaitingConfirmation: number; activePatients: number; conversationsWaitingHuman: number; openTasks: number; overdueTasks: number; failedOutbox: number; pendingNpsFollowups: number; plannedNpsSurveys: number }; appointments: Row[] }
type Props = { request: (path: string, init?: RequestInit) => Promise<any>; unitId: string; availablePages: string[]; onNavigate: (page: string) => void; onNewAppointment: () => void; refreshKey: number }

const fmtTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const fmtDay = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))

export default function DashboardPage({ request, unitId, availablePages, onNavigate, onNewAppointment, refreshKey }: Props) {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    request(`/dashboard/overview${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ''}`).then((result) => { if (live) setData(result) }).catch((cause: Error) => { if (live) setError(cause.message || 'Não foi possível carregar a visão geral.') }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [request, unitId, refreshKey])
  const m = data?.metrics
  const quickLinks = [
    { page: 'Agenda', title: 'Agenda', subtitle: 'Atendimentos e horários', icon: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16' },
    { page: 'Pacientes', title: 'Pacientes', subtitle: 'Cadastro e histórico', icon: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
    { page: 'Inbox', title: 'Inbox', subtitle: 'Conversas para atender', icon: 'M4 4h16v13h-5l-3 3-3-3H4z' },
    { page: 'Campanhas', title: 'Campanhas', subtitle: 'Mensagens para pacientes', icon: 'M3 11v2h4l5 4V7l-5 4z M7 13l2 7h3 M16 9a4 4 0 0 1 0 6' },
  ].filter(item => availablePages.includes(item.page)).slice(0, 4)
  return <div className="clinic-dashboard">
    <div className="clinic-dashboard-toolbar"><time className="clinic-dashboard-date" dateTime={(data?.dayStart ?? new Date().toISOString()).slice(0, 10)}>{fmtDay(data?.dayStart ?? new Date().toISOString())}{data?.units.find((unit) => unit.id === unitId) ? ` · ${data.units.find((unit) => unit.id === unitId)?.name}` : ''}</time><button className="primary" onClick={onNewAppointment}>Abrir agenda</button></div>
    <nav className="clinic-dashboard-quick-links" aria-label="Acesso rápido aos módulos">{quickLinks.map((item, index) => <button type="button" className={`clinic-quick-link clinic-quick-link-${index + 1}`} key={item.page} onClick={() => onNavigate(item.page)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg><span><b>{item.title}</b><small>{item.subtitle}</small></span></button>)}</nav>
    {error && <div className="clinic-dashboard-error" role="alert">{error}<button onClick={() => setError('')}>Fechar</button></div>}
    {loading ? <div className="clinic-dashboard-state" aria-live="polite">Carregando indicadores da unidade…</div> : data && <>
      <section className="clinic-dashboard-metrics" aria-label="Indicadores operacionais">
        <Metric title="Agendamentos hoje" value={m?.appointmentsToday ?? 0} detail={`${m?.confirmedToday ?? 0} confirmados · ${m?.awaitingConfirmation ?? 0} aguardando`} onClick={() => onNavigate('Agenda')}/>
        <Metric title="Pacientes ativos" value={m?.activePatients ?? 0} detail="Na clínica; inclui pacientes sem unidade preferencial no escopo permitido" onClick={() => onNavigate('Pacientes')}/>
        <Metric title="Conversas na fila" value={m?.conversationsWaitingHuman ?? 0} detail="Aguardando atendimento humano" onClick={() => onNavigate('Inbox')}/>
        <Metric title="Tarefas pendentes" value={m?.openTasks ?? 0} detail={`${m?.overdueTasks ?? 0} atrasadas${m?.failedOutbox ? ` · ${m.failedOutbox} falhas de automação` : ''}`} onClick={() => onNavigate('Tarefas')}/>
      </section>
      <div className="clinic-dashboard-columns">
        <section className="clinic-dashboard-card"><div className="clinic-dashboard-card-heading"><div><h2>Agenda de hoje</h2><p>Próximos atendimentos locais · America/Sao_Paulo</p></div><button className="text-action" onClick={() => onNavigate('Agenda')}>Ver agenda →</button></div>
          {data.appointments.length ? <div className="clinic-dashboard-appointments">{data.appointments.map((item) => <button className="clinic-dashboard-appointment" key={item.id} onClick={() => onNavigate('Agenda')}><time>{fmtTime(item.startsAt)}</time><span className="clinic-dashboard-appointment-main"><b>{item.patient?.fullName ?? 'Paciente'}</b><small>{item.procedure?.name ?? 'Atendimento'}{item.resources?.length ? ` · ${item.resources.map((r: Row) => r.resource?.name).filter(Boolean).join(', ')}` : ''}</small></span><span className={`clinic-status clinic-status-${String(item.status).toLowerCase()}`}>{statusName(item.status)}</span></button>)}</div> : <div className="clinic-dashboard-empty">Nenhum atendimento agendado para hoje.</div>}
        </section>
        <section className="clinic-dashboard-card"><div className="clinic-dashboard-card-heading"><div><h2>Precisa de atenção</h2><p>Pendências registradas nos módulos operacionais</p></div></div><div className="clinic-dashboard-attention">
          <Attention title="Tarefas atrasadas" count={m?.overdueTasks ?? 0} onClick={() => onNavigate('Tarefas')}/><Attention title="Acompanhamentos de NPS pendentes" count={m?.pendingNpsFollowups ?? 0} onClick={() => onNavigate('Tarefas')}/><Attention title="Conversas aguardando a equipe" count={m?.conversationsWaitingHuman ?? 0} onClick={() => onNavigate('Inbox')}/><Attention title="Falhas na fila de automações" count={m?.failedOutbox ?? 0} onClick={() => onNavigate('Automações')}/>
        </div></section>
      </div>
    </>}
  </div>
}

function Metric({ title, value, detail, onClick }: { title: string; value: number; detail: string; onClick: () => void }) { return <button className="clinic-metric-card" onClick={onClick}><span>{title}</span><b>{value.toLocaleString('pt-BR')}</b><small>{detail}</small></button> }
function Attention({ title, count, onClick }: { title: string; count: number; onClick: () => void }) { return <button className="clinic-attention-row" onClick={onClick}><span><i aria-hidden="true">{count ? '!' : '✓'}</i>{title}</span><b>{count}</b></button> }
function statusName(status: string) { return ({ PENDING: 'A confirmar', CONFIRMED: 'Confirmado', COMPLETED: 'Concluído', CANCELLED: 'Cancelado', NO_SHOW: 'Falta' } as Record<string, string>)[status] ?? status }

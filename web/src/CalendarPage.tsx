import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import './calendar.css'
import './calendar-month.css'
import './calendar-settings.css'
const ResourcesSchedulePanel = lazy(() => import('./ResourcesSchedulePanel.js'))

type Unit = { id: string; name: string; slug: string }
type Row = Record<string, any> & { id: string }
type Request = (path: string, init?: RequestInit) => Promise<any>
const TZ = 'America/Sao_Paulo'
const STATUS: Record<string, string> = { PENDING: 'Pendente', CONFIRMED: 'Confirmado', COMPLETED: 'Concluído', CANCELLED: 'Cancelado', NO_SHOW: 'Falta' }
const BRAZIL_NATIONAL_HOLIDAYS: Record<string, string> = { '01-01': 'Confraternização Universal', '04-21': 'Tiradentes', '05-01': 'Dia do Trabalho', '09-07': 'Independência do Brasil', '10-12': 'Nossa Senhora Aparecida', '11-02': 'Finados', '11-15': 'Proclamação da República', '11-20': 'Dia Nacional de Zumbi e da Consciência Negra', '12-25': 'Natal' }
const CALENDAR_PREFERENCES_KEY = 'essential-clinics.calendar-preferences'
function calendarPreferences() {
  try {
    const value = JSON.parse(sessionStorage.getItem(CALENDAR_PREFERENCES_KEY) ?? '{}') as Record<string, unknown>
    return { view: value.view === 'MONTH' ? 'MONTH' as const : value.view === 'WEEK' ? 'WEEK' as const : 'DAY' as const, status: typeof value.status === 'string' && (value.status === '' || value.status in STATUS) ? value.status : '', date: typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : '' }
  } catch { return { view: 'DAY' as const, status: '', date: '' } }
}

function parts(date: Date) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return Object.fromEntries(values.map((item) => [item.type, item.value])) as Record<string, string>
}
function dateKey(date: Date) { const p = parts(date); return `${p.year}-${p.month}-${p.day}` }
function holidayForDate(key: string) { return BRAZIL_NATIONAL_HOLIDAYS[key.slice(5)] }
function localInputToIso(value: string) {
  const [day, time] = value.split('T')
  if (!day || !time) throw new Error('Informe data e horário válidos.')
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wall = Date.UTC(year!, month! - 1, date!, hour!, minute!)
  let candidate = wall
  for (let i = 0; i < 3; i++) {
    const shown = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(candidate))
    const p = Object.fromEntries(shown.map((part) => [part.type, Number(part.value)])) as Record<string, number>
    const shownAsUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!)
    candidate += wall - shownAsUtc
  }
  return new Date(candidate).toISOString()
}
function isoToLocalInput(value: string) {
  const date = new Date(value)
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const p = Object.fromEntries(f.map((item) => [item.type, item.value])) as Record<string, string>
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
function showDate(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'full' }).format(new Date(value)) }
function showTime(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function availabilityMessage(result: { available?: boolean; outsideHours?: boolean; reasonCode?: string; reason?: string; sourceOfTruth?: string }, action: 'create' | 'reschedule') {
  if (result.sourceOfTruth === 'UNO') return 'A disponibilidade do Uno não está sincronizada aqui. Encaminhe o pedido à recepção.'
  if (result.available && result.outsideHours) return action === 'create'
    ? 'Nenhum conflito encontrado. Este horário excepcional está pronto para confirmação; o agendamento ainda não foi salvo.'
    : 'Nenhum conflito encontrado. Este horário excepcional está pronto para confirmação; o reagendamento ainda não foi salvo.'
  if (result.available) return 'Horário disponível. Confirme para salvar a alteração.'
  if (result.reasonCode === 'CLOSED_DATE') return 'A unidade está fechada nesta data.'
  if (result.reasonCode === 'OUTSIDE_HOURS') return 'Este horário está fora do expediente da unidade.'
  if (result.reasonCode === 'RESOURCE_CONFLICT') return 'Conflito: o profissional, a sala ou o equipamento já está reservado. Escolha outro horário ou recurso.'
  if (result.reasonCode === 'RESOURCE_START_INTERVAL') return 'Este horário não segue o intervalo entre inícios de um recurso selecionado. Ajuste o horário e consulte novamente.'
  if (result.reasonCode === 'UNIT_CONFLICT') return 'Conflito: já existe um atendimento nesse horário na unidade. Escolha outro horário.'
  if (result.reasonCode === 'BLOCKED') return 'Esse horário está bloqueado para a unidade ou para um recurso selecionado. Escolha outro horário.'
  return result.reason || 'Horário indisponível. Escolha outro horário ou recurso.'
}
function addDays(day: Date, amount: number) { const next = new Date(day); next.setUTCDate(next.getUTCDate() + amount); return next }
function weekStart(day: Date) { const weekday = day.getUTCDay(); return addDays(day, weekday === 0 ? -6 : 1 - weekday) }
function addMonths(day: Date, amount: number) { const year = day.getUTCFullYear(); const month = day.getUTCMonth() + amount; const targetLastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); return new Date(Date.UTC(year, month, Math.min(day.getUTCDate(), targetLastDay), 12)) }
function greatestCommonDivisor(a: number, b: number): number { return b ? greatestCommonDivisor(b, a % b) : a }
function combinedStartInterval(values: number[]) { return values.reduce((result, value) => result * value / greatestCommonDivisor(result, value), 1) }
function monthStart(day: Date) { return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1, 12)) }

export default function CalendarPage({ request, units, unitId, role, setNotice, onOpenPatient, initialPatientId = '', initialAppointmentId = '', onContextConsumed, refreshKey = 0 }: { request: Request; units: Unit[]; unitId: string; role: string; setNotice: (message: string) => void; onOpenPatient: (id: string) => void; initialPatientId?: string; initialAppointmentId?: string; onContextConsumed?: () => void; refreshKey?: number }) {
  const [anchor, setAnchor] = useState(() => { const saved = calendarPreferences(); return new Date(`${saved.date || dateKey(new Date())}T12:00:00Z`) })
  const [view, setView] = useState<'DAY' | 'WEEK' | 'MONTH'>(() => calendarPreferences().view)
  const [status, setStatus] = useState(() => calendarPreferences().status)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<Row[]>([])
  const [schedule, setSchedule] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Row | null>(null)
  const [modal, setModal] = useState<'CREATE' | 'DETAIL' | null>(null)
  const [catalog, setCatalog] = useState<Row[]>([])
  const [resources, setResources] = useState<Row[]>([])
  const [resourceFilter, setResourceFilter] = useState('')
  const [resourceIds, setResourceIds] = useState<string[]>([])
  const [patients, setPatients] = useState<Row[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [patientId, setPatientId] = useState('')
  const [procedureId, setProcedureId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [availability, setAvailability] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState<'NATIVE' | 'UNO' | 'UNKNOWN'>('UNKNOWN')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskBusy, setTaskBusy] = useState(false)
  const [showScheduleSettings, setShowScheduleSettings] = useState(false)

  const requiredResources = (catalog.find((procedure) => procedure.id === procedureId)?.resourceRequirements ?? []) as Row[]
  const requirementsMet = requiredResources.every((requirement) => {
    const requiredTypeIds = resources.filter((resource) => resource.active && resource.type === requirement.resourceType).map((resource) => resource.id)
    return requiredTypeIds.filter((id) => resourceIds.includes(id)).length === requirement.quantity
  })
  const unavailableRequirements = requiredResources.filter((requirement) => resources.filter((resource) => resource.active && resource.type === requirement.resourceType).length < requirement.quantity)
  const selectedStartIntervals = resources.filter((resource) => resourceIds.includes(resource.id) && resource.startIntervalMinutes).map((resource) => Number(resource.startIntervalMinutes))
  const selectedStartInterval = selectedStartIntervals.length ? combinedStartInterval(selectedStartIntervals) : null

  const days = useMemo(() => view === 'DAY' ? [anchor] : view === 'WEEK' ? Array.from({ length: 7 }, (_, index) => addDays(weekStart(anchor), index)) : Array.from({ length: 42 }, (_, index) => addDays(weekStart(monthStart(anchor)), index)), [anchor, view])
  const range = useMemo(() => {
    const first = dateKey(days[0]!)
    const afterLast = dateKey(addDays(days[days.length - 1]!, 1))
    return { from: localInputToIso(`${first}T00:00`), to: localInputToIso(`${afterLast}T00:00`) }
  }, [days])
  const load = useCallback(async () => {
    if (!unitId) { setItems([]); return }
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, unitId })
      if (status) params.set('status', status)
      if (search.trim()) params.set('search', search.trim())
      if (resourceFilter) params.set('resourceId', resourceFilter)
      setItems(await request(`/appointments?${params}`))
      try {
        const config = await request(`/integrations/uno/${unitId}/status`)
        setSource(config?.activeSource === 'UNO' ? 'UNO' : 'NATIVE')
      } catch {
        setSource('UNKNOWN')
        setError('Não foi possível confirmar a fonte da agenda. As alterações ficam bloqueadas até a verificação.')
      }
    } catch (cause) { setSource('UNKNOWN'); setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a agenda.') }
    finally { setLoading(false) }
  }, [range.from, range.to, request, search, status, unitId, resourceFilter])
  useEffect(() => { void load() }, [load, refreshKey])
  useEffect(() => {
    try { sessionStorage.setItem(CALENDAR_PREFERENCES_KEY, JSON.stringify({ view, status, date: dateKey(anchor) })) } catch { /* Preferências são opcionais quando o navegador bloqueia armazenamento. */ }
  }, [anchor, status, view])
  useEffect(() => {
    if (!unitId) { setSchedule(null); return }
    let active = true
    void request(`/units/${encodeURIComponent(unitId)}/schedule`).then((data) => { if (active) setSchedule(data) }).catch(() => { if (active) setSchedule(null) })
    return () => { active = false }
  }, [request, unitId])
  useEffect(() => {
    setResourceIds([]); setResourceFilter('')
    if (unitId) void request(`/resources?unitId=${encodeURIComponent(unitId)}`).then((data) => { setResources(data.resources ?? []); setCatalog(data.procedures ?? []) }).catch((cause: Error) => setError(cause.message))
  }, [request, unitId])
  useEffect(() => {
    if (!patientSearch.trim()) { setPatients([]); return }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: '1', pageSize: '25', status: 'ACTIVE', search: patientSearch.trim(), ...(unitId ? { unitId, includeUnassigned: 'true' } : {}) })
      void request(`/patients?${params}`).then((result) => setPatients(result.items ?? [])).catch((cause: Error) => setError(cause.message))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [patientSearch, request, unitId])
  useEffect(() => {
    if (!initialAppointmentId) return
    let active = true
    setBusy(true)
    void request(`/appointments/${encodeURIComponent(initialAppointmentId)}`).then((appointment) => {
      if (!active) return
      setAnchor(new Date(`${dateKey(new Date(String(appointment.startsAt)))}T12:00:00Z`))
      setSelected(appointment); setModal('DETAIL'); setError('')
    }).catch((cause: Error) => { if (active) setError(cause.message || 'Não foi possível abrir o agendamento neste escopo.') })
      .finally(() => { if (active) { setBusy(false); onContextConsumed?.() } })
    return () => { active = false }
  }, [initialAppointmentId, request, onContextConsumed])
  useEffect(() => {
    if (!initialPatientId) return
    let active = true
    void request(`/patients/${encodeURIComponent(initialPatientId)}`).then((patient) => {
      if (!active) return
      setPatients((current) => current.some((row) => row.id === patient.id) ? current : [patient, ...current])
      setPatientId(String(patient.id)); setPatientSearch(String(patient.fullName ?? ''))
      setModal('CREATE'); setAvailability(null); setError('')
      onContextConsumed?.()
    }).catch((cause: Error) => { if (active) setError(cause.message || 'Não foi possível abrir o paciente neste escopo.') })
    return () => { active = false }
  }, [initialPatientId, request, onContextConsumed])

  async function openDetails(id: string) {
    setBusy(true)
    try { setSelected(await request(`/appointments/${id}`)); setModal('DETAIL') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o agendamento.') }
    finally { setBusy(false) }
  }
  function resetForm(day = dateKey(new Date()), time = '09:00') {
    setPatientId(''); setPatientSearch(''); setProcedureId(''); setAvailability(null); setResourceIds(resourceFilter ? [resourceFilter] : [])
    setStartsAt(`${day}T${time}`)
  }
  async function checkAvailability(allowOutsideHours = false) {
    setAvailability(null); setBusy(true)
    try {
      const start = localInputToIso(startsAt)
      const params = new URLSearchParams({ unitId, startsAt: start, ...(procedureId ? { procedureId } : { durationMinutes: '30' }), ...(resourceIds.length ? { resourceIds: resourceIds.join(',') } : {}), ...(allowOutsideHours ? { allowOutsideHours: 'true' } : {}) })
      setAvailability(await request(`/appointments/availability?${params}`)); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao consultar este horário.') }
    finally { setBusy(false) }
  }
  async function createAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (source !== 'NATIVE' || busy) return
    setBusy(true); setError('')
    try {
      const result = await request('/appointments', { method: 'POST', body: JSON.stringify({ unitId, patientId, procedureId: procedureId || undefined, startsAt: localInputToIso(startsAt), durationMinutes: procedureId ? undefined : 30, resourceIds, outsideHoursOverride: availability?.outsideHours === true }) })
      setNotice('Agendamento criado após confirmação transacional do servidor.')
      setModal(null); setSelected(result); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar. O horário pode ter sido reservado por outra pessoa.') }
    finally { setBusy(false) }
  }
  async function action(actionName: string, body: Record<string, unknown>): Promise<boolean> {
    if (!selected || busy) return false
    if (actionName === 'status' && body.status === 'CANCELLED' && !window.confirm('Cancelar este agendamento?')) return false
    setBusy(true); setError('')
    try {
      const result = await request(`/appointments/${selected.id}/${actionName === 'status' ? 'status' : 'reschedule'}`, { method: 'PATCH', body: JSON.stringify(body) })
      setSelected(result); setNotice('Agendamento atualizado e alteração registrada no histórico.'); await load(); return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'A alteração falhou. Atualize a agenda e tente novamente.'); return false }
    finally { setBusy(false) }
  }
  async function createTask() {
    if (!selected || !taskTitle.trim() || taskBusy) return
    setTaskBusy(true)
    try {
      await request('/tasks', { method: 'POST', body: JSON.stringify({ unitId: selected.unitId, appointmentId: selected.id, patientId: selected.patientId, title: taskTitle.trim(), priority: 'NORMAL' }) })
      setTaskTitle(''); setSelected(await request(`/appointments/${selected.id}`)); setNotice('Tarefa vinculada ao agendamento criada.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a tarefa.') }
    finally { setTaskBusy(false) }
  }

  const selectedUnit = units.find((unit) => unit.id === unitId)
  const canWrite = source === 'NATIVE' && ['TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR'].includes(role)
  function openCreateAt(day: string, time: string) {
    if (!canWrite) return
    resetForm(day, time)
    setAvailability(null); setError(''); setModal('CREATE')
  }
  const title = view === 'DAY' ? showDate(localInputToIso(`${dateKey(anchor)}T12:00`)) : view === 'WEEK' ? `${new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short' }).format(new Date(range.from))} – ${new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(new Date(range.to).getTime() - 1))}` : new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, month: 'long', year: 'numeric' }).format(new Date(localInputToIso(`${dateKey(anchor)}T12:00`)))

  return <div className="calendar-page">
    {resources.length > 0 && <label className="calendar-resource-filter">Filtrar profissional/recurso<select value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)}><option value="">Todos</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select>{resources.find((resource) => resource.id === resourceFilter)?.startIntervalMinutes && <span>Inícios a cada {resources.find((resource) => resource.id === resourceFilter)?.startIntervalMinutes} min</span>}</label>}
    <section className="calendar-toolbar" aria-label="Filtros da agenda">
      <div className="calendar-navigation"><button type="button" aria-label="Período anterior" onClick={() => setAnchor((day) => view === 'DAY' ? addDays(day, -1) : view === 'WEEK' ? addDays(day, -7) : addMonths(day, -1))}>‹</button><button type="button" onClick={() => setAnchor(new Date(`${dateKey(new Date())}T12:00:00Z`))}>Hoje</button><button type="button" aria-label="Próximo período" onClick={() => setAnchor((day) => view === 'DAY' ? addDays(day, 1) : view === 'WEEK' ? addDays(day, 7) : addMonths(day, 1))}>›</button><h2>{title}</h2><span className='calendar-scope-label' aria-label={`Agenda ${selectedUnit?.name ?? 'Todas as unidades'}, ${resources.find((resource) => resource.id === resourceFilter)?.name ?? 'Todos'}`}>{selectedUnit?.name ?? 'Todas as unidades'} · {resources.find((resource) => resource.id === resourceFilter)?.name ?? 'Todos'}</span></div>
      <div className="calendar-filters"><label>Visualização<select value={view} onChange={(event) => setView(event.target.value as 'DAY' | 'WEEK' | 'MONTH')}><option value="DAY">Dia</option><option value="WEEK">Semana</option><option value="MONTH">Mês</option></select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><form onSubmit={(event) => { event.preventDefault(); setSearch(query) }}><label>Paciente<input aria-label="Buscar paciente na agenda" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar paciente"/></label><button type="submit">Buscar</button></form><div className="calendar-toolbar-actions">{role === 'TENANT_ADMIN' && <button type="button" className="calendar-settings-button" aria-expanded={showScheduleSettings} onClick={() => setShowScheduleSettings((open) => !open)}>Configurar agenda</button>}<button type="button" className="primary" onClick={() => openCreateAt(dateKey(new Date()), '09:00') } disabled={!canWrite} title={source === 'UNO' ? 'Agenda Uno é somente leitura neste módulo' : undefined}>Novo agendamento</button></div></div>
    </section>
    {showScheduleSettings && role === 'TENANT_ADMIN' && <section className="calendar-config-sheet" aria-labelledby="calendar-config-title"><header><div><h2 id="calendar-config-title">Configuração da agenda</h2><p>Intervalos por recurso, expediente, feriados e bloqueios da unidade.</p></div><button type="button" aria-label="Fechar configuração da agenda" onClick={() => setShowScheduleSettings(false)}>Fechar</button></header><Suspense fallback={<p className="calendar-state" role="status">Carregando configuração da agenda…</p>}><ResourcesSchedulePanel key={unitId} unitId={unitId} units={units} request={request} setNotice={setNotice} scheduleOnly onResourcesChanged={() => { void request(`/resources?unitId=${encodeURIComponent(unitId)}`).then((data) => { setResources(data.resources ?? []); setCatalog(data.procedures ?? []) }).catch((cause: Error) => setError(cause.message)) }}/></Suspense></section>}
    {source !== 'NATIVE' && <div className={`calendar-source ${source === 'UNKNOWN' ? 'readonly' : ''}`} role="status">{source === 'UNO' ? 'Agenda conectada ao Uno. A edição não está disponível nesta tela; encaminhe o pedido à recepção.' : 'Não foi possível confirmar a agenda. As alterações estão bloqueadas temporariamente.'}</div>}
    {error && <div className="calendar-error" role="alert">{error}<button type="button" onClick={() => setError('')}>Fechar</button></div>}
    {loading && <p className="calendar-state" role="status">Carregando agenda…</p>}
    {!loading && !error && items.length === 0 && <p className="calendar-state">Nenhum agendamento neste período e filtros.</p>}
    {view === 'WEEK' && <p className="calendar-week-hint">A semana inclui de segunda-feira a domingo. Em telas estreitas, deslize a grade horizontalmente para acessar todos os dias.</p>}
    {view === 'MONTH' && <p className="calendar-week-hint">Selecione um agendamento para ver os detalhes. As datas fora deste mês aparecem para completar a grade.</p>}
    <CalendarGrid days={days} items={items} view={view} anchor={anchor} onSelect={(id) => void openDetails(id)} onCreateAt={openCreateAt} canWrite={canWrite} schedule={schedule} loading={loading} startIntervalMinutes={Number(resources.find((resource) => resource.id === resourceFilter)?.startIntervalMinutes) || 15}/>
    {modal === 'CREATE' && <div className="calendar-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><section className="calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="dialog-close" type="button" onClick={() => setModal(null)} aria-label="Fechar">×</button><h2 id="create-title">Novo agendamento · {selectedUnit?.name}</h2>{source !== 'NATIVE' ? <p>{source === 'UNO' ? 'Esta unidade usa a agenda Uno. A criação local está bloqueada até a homologação.' : 'A fonte da agenda ainda não foi verificada. A criação está bloqueada temporariamente.'}</p> : <form onSubmit={createAppointment} className="appointment-form">
      <label>Localizar paciente<input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} placeholder="Nome, telefone ou e-mail" autoFocus required/></label><label>Paciente<select required value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Selecione um paciente</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}{patient.phone ? ` · ${patient.phone}` : ''}</option>)}</select></label>
      <label>Procedimento<select value={procedureId} onChange={(event) => { const id = event.target.value; setProcedureId(id); setAvailability(null); const needs = catalog.find((p) => p.id === id)?.resourceRequirements ?? []; const next: string[] = []; for (const need of needs) { const matching = resources.filter((resource) => resource.active && resource.type === need.resourceType); if (resourceFilter) matching.sort((a, b) => Number(b.id === resourceFilter) - Number(a.id === resourceFilter)); next.push(...matching.slice(0, need.quantity).map((resource) => resource.id)) } setResourceIds(resourceFilter && !next.includes(resourceFilter) ? [resourceFilter, ...next] : next) }}><option value="">Sem procedimento · 30 min</option>{catalog.filter((procedure) => !procedure.unitId || procedure.unitId === unitId).map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.name} · {procedure.appointmentDurationMinutes} min</option>)}</select></label><label>Data e horário (São Paulo)<input type="datetime-local" step={(selectedStartInterval ?? 15) * 60} required value={startsAt} onChange={(event) => { setStartsAt(event.target.value); setAvailability(null) }}/></label><p className="duration-hint" aria-live="polite"><strong>Duração do atendimento:</strong> {procedureId ? catalog.find((procedure) => procedure.id === procedureId)?.appointmentDurationMinutes ?? '—' : 30} min. Essa duração vem do procedimento. {selectedStartInterval ? `Os recursos selecionados permitem inícios a cada ${selectedStartInterval} min; isso não altera a duração.` : 'Os recursos selecionados podem limitar os horários de início.'}</p>
      {resources.filter((row) => row.active).length > 0 && <fieldset className="resource-picker"><legend>Profissionais, salas e recursos</legend><div className="resource-picker-list">{resources.filter((row) => row.active).map((resource) => { const kind = resource.type === 'PROFESSIONAL' ? 'Profissional' : resource.type === 'ROOM' ? 'Sala' : 'Equipamento'; const requirement = requiredResources.find((item: Row) => item.resourceType === resource.type); return <label className="resource-picker-option" key={resource.id}><input type="checkbox" checked={resourceIds.includes(resource.id)} onChange={(event) => { setAvailability(null); setResourceIds((ids) => event.target.checked ? [...ids, resource.id] : ids.filter((id) => id !== resource.id)) }}/><span className="resource-picker-name">{resource.name}</span><span className="resource-picker-kind">{kind}{resource.startIntervalMinutes ? ` · Inícios a cada ${resource.startIntervalMinutes} min` : ''}{requirement ? ` · Obrigatório${requirement.quantity > 1 ? ` (${requirement.quantity})` : ''}` : ' · Opcional'}</span></label> })}</div></fieldset>}
      {unavailableRequirements.map((requirement: Row) => <p className="availability no" role="alert" key={requirement.resourceType}>O procedimento exige {requirement.quantity} recurso(s) do tipo {requirement.resourceType}, mas a unidade não tem quantidade suficiente ativa.</p>)}
      <button type="button" onClick={() => void checkAvailability()} disabled={busy || !patientId || !startsAt || !requirementsMet || unavailableRequirements.length > 0}>Consultar este horário</button>{availability && <p className={availability.available ? (availability.outsideHours ? 'availability outside-hours' : 'availability yes') : ['OUTSIDE_HOURS', 'CLOSED_DATE'].includes(availability.reasonCode) ? 'availability outside-hours' : 'availability no'} role="status">{availabilityMessage(availability, 'create')}</p>}{availability?.outsideHours && !availability.available && ['OUTSIDE_HOURS', 'CLOSED_DATE'].includes(availability.reasonCode) && <div className="outside-hours-confirm" role="group" aria-label="Verificar agendamento fora do expediente"><p>Se precisar agendar aqui, verifique conflitos e bloqueios. Essa consulta não salva nada; se o horário estiver livre, confirme o agendamento no próximo passo.</p><button type="button" className="confirm-outside-hours" onClick={() => void checkAvailability(true)} disabled={busy}>Verificar conflitos para este horário</button></div>}<button className="primary" type="submit" disabled={busy || !patientId || !availability?.available || source !== 'NATIVE' || !requirementsMet || unavailableRequirements.length > 0}>{busy ? 'Salvando...' : availability?.outsideHours ? 'Confirmar agendamento excepcional' : 'Confirmar agendamento'}</button></form>}</section></div>}
    {modal === 'DETAIL' && selected && <AppointmentDetails appointment={selected} request={request} busy={busy} error={error} canWrite={canWrite} onClose={() => { setModal(null); setError('') }} onAction={action} onOpenPatient={onOpenPatient} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskBusy={taskBusy} onCreateTask={() => void createTask()} onTaskChanged={async () => setSelected(await request(`/appointments/${selected.id}`))}/>}
  </div>
}

function scheduleIntervalsForDay(dayKey: string, schedule: any) {
  if (!schedule?.unit?.scheduleEnabled) return [{ startMinute: 8 * 60, endMinute: 18 * 60 }]
  const exception = (schedule.exceptions ?? []).find((row: Row) => String(row.date).slice(0, 10) === dayKey)
  if (exception) return exception.closed ? [] : exception.intervals ?? []
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay()
  return (schedule.weekly ?? []).filter((row: Row) => row.weekday === weekday)
}
function localMinutes(value: string) {
  const date = new Date(value)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(date))
  const minute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, minute: '2-digit' }).format(date))
  return hour * 60 + minute
}
function isOutsideWorkingHours(item: Row, schedule: any) {
  if (!schedule?.unit?.scheduleEnabled) return false
  const key = dateKey(new Date(String(item.startsAt)))
  const start = localMinutes(String(item.startsAt))
  const end = localMinutes(String(item.endsAt))
  return !scheduleIntervalsForDay(key, schedule).some((interval: Row) => interval.startMinute <= start && interval.endMinute >= end)
}
function CalendarGrid({ days, items, view, anchor, schedule, onSelect, onCreateAt, canWrite, loading, startIntervalMinutes }: { days: Date[]; items: Row[]; view: 'DAY' | 'WEEK' | 'MONTH'; anchor: Date; schedule: any; onSelect: (id: string) => void; onCreateAt: (day: string, time: string) => void; canWrite: boolean; loading: boolean; startIntervalMinutes: number }) {
  if (view === 'MONTH') return <MonthGrid days={days} items={items} anchor={anchor} schedule={schedule} onSelect={onSelect} loading={loading}/>
  const today = dateKey(new Date())
  const intervals = days.flatMap((day) => scheduleIntervalsForDay(dateKey(day), schedule))
  let startMinute = intervals.length ? Math.min(...intervals.map((row) => row.startMinute)) : 8 * 60
  let endMinute = intervals.length ? Math.max(...intervals.map((row) => row.endMinute)) : 18 * 60
  for (const item of items) {
    const startKey = dateKey(new Date(String(item.startsAt)))
    if (!days.some((day) => dateKey(day) === startKey)) continue
    startMinute = Math.min(startMinute, localMinutes(String(item.startsAt)))
    endMinute = Math.max(endMinute, localMinutes(String(item.endsAt)))
  }
  const firstHour = Math.max(0, Math.floor(startMinute / 60))
  const lastHour = Math.min(24, Math.max(firstHour + 1, Math.ceil(endMinute / 60)))
  const visibleHours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index)
  return <section className={`calendar-grid ${days.length === 1 ? 'one-day' : ''}`} aria-label="Calendário de agendamentos; na visão semanal, use as setas ou a rolagem horizontal para acessar os sete dias" tabIndex={0}>
    <div className="calendar-time-gutter"><div className="calendar-day-head">Horário</div>{visibleHours.map((hour) => <div className="calendar-hour" key={hour}>{String(hour).padStart(2, '0')}:00</div>)}</div>
    {days.map((day) => {
      const key = dateKey(day)
      const rows: Row[] = items.filter((item) => dateKey(new Date(String(item.startsAt))) === key).map((item) => ({ ...item, isOutsideHours: item.outsideHoursOverride === true || isOutsideWorkingHours(item, schedule) } as Row))
      const exceptionalRows = rows.filter((item) => item.isOutsideHours)
      const holiday = holidayForDate(key)
      return <div className={`calendar-day ${key === today ? 'is-today' : ''}${holiday ? ' is-holiday' : ''}`} key={key}>
        <header className="calendar-day-head"><b>{new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(localInputToIso(`${key}T12:00`)))}</b><span>{rows.length} agend.</span>{holiday && <small className="calendar-holiday-label">Feriado nacional - {holiday}</small>}{exceptionalRows.length > 0 && <small className="calendar-outside-day-warning" role="status">Fora do expediente: {exceptionalRows.length} agendamento{exceptionalRows.length === 1 ? '' : 's'}</small>}</header>
        <div className={`calendar-day-body${canWrite ? ' is-clickable' : ''}`} style={{ height: `${visibleHours.length * 58}px`, minHeight: `${visibleHours.length * 58}px` }} role="group" aria-label={`${new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(localInputToIso(`${key}T12:00`)))}. Clique em um horário livre para iniciar um agendamento; pressione Enter para iniciar às 09:00${canWrite ? '' : '; somente leitura'}.`} tabIndex={canWrite ? 0 : undefined} onClick={(event) => {
          if (!canWrite || loading || (event.target as HTMLElement).closest('button,.calendar-loading-cover,.calendar-now')) return
          const rect = event.currentTarget.getBoundingClientRect()
          const minute = Math.max(firstHour * 60, Math.min(lastHour * 60 - startIntervalMinutes, firstHour * 60 + Math.floor(((event.clientY - rect.top) / 58 * 60) / startIntervalMinutes) * startIntervalMinutes))
          onCreateAt(key, `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`)
        }} onKeyDown={(event) => { if (canWrite && (event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); onCreateAt(key, `${String(firstHour).padStart(2, '0')}:00`) } }}>
          {visibleHours.map((hour) => <div className="calendar-hour-line" key={hour}><span>{String(hour).padStart(2, '0')}:00</span></div>)}
          {rows.map((item) => {
            const start = localMinutes(String(item.startsAt))
            const end = localMinutes(String(item.endsAt))
            const duration = Math.max(25, end - start)
            const top = (start - firstHour * 60) / 60 * 58
            return <button type="button" key={item.id} className={`calendar-event status-${String(item.status).toLowerCase()}${item.isOutsideHours ? ' is-outside-hours' : ''}`} style={{ top: `${top}px`, height: `${Math.max(34, duration / 60 * 58 - 3)}px` }} onClick={() => onSelect(item.id)} aria-label={`${item.isOutsideHours ? 'Fora do expediente, ' : ''}${STATUS[String(item.status)] ?? String(item.status)}, ${item.patient?.fullName ?? 'Paciente'}, ${showTime(String(item.startsAt))}`}><b>{showTime(String(item.startsAt))} - {String(item.patient?.fullName ?? 'Paciente')}</b><span>{String(item.procedure?.name ?? 'Atendimento')} - {STATUS[String(item.status)] ?? String(item.status)}{item.isOutsideHours ? ' - FORA DO EXPEDIENTE' : ''}</span></button>
          })}
          {key === today && <NowLine startHour={firstHour} endHour={lastHour}/ >}{loading && <span className="calendar-loading-cover">Atualizando?</span>}
        </div>
      </div>
    })}
  </section>
}

function MonthGrid({ days, items, anchor, schedule, onSelect, loading }: { days: Date[]; items: Row[]; anchor: Date; schedule: any; onSelect: (id: string) => void; loading: boolean }) {
  const today = dateKey(new Date())
  const month = anchor.getUTCMonth()
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short' }).format(new Date(Date.UTC(2024, 0, 1 + index, 12))) )
  return <section className="calendar-month-grid" aria-label="Calendário mensal de agendamentos" aria-busy={loading}>
    {weekdayLabels.map((label, index) => <div className="calendar-month-weekday" key={`${label}-${index}`}>{label}</div>)}
    {days.map((day) => {
      const key = dateKey(day)
      const isCurrentMonth = day.getUTCMonth() === month && day.getUTCFullYear() === anchor.getUTCFullYear()
      const rows: Row[] = items.filter((item) => dateKey(new Date(String(item.startsAt))) === key).map((item) => ({ ...item, isOutsideHours: item.outsideHoursOverride === true || isOutsideWorkingHours(item, schedule) } as Row))
      const holiday = holidayForDate(key)
      return <div className={`calendar-month-day${isCurrentMonth ? '' : ' is-outside'}${key === today ? ' is-today' : ''}${holiday ? ' is-holiday' : ''}`} key={key} aria-label={`${showDate(localInputToIso(`${key}T12:00`))}${holiday ? `, feriado nacional: ${holiday}` : ''}: ${rows.length} agendamentos`}>
        <div className="calendar-month-day-heading"><b>{new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric' }).format(new Date(localInputToIso(`${key}T12:00`)))}</b>{rows.length > 0 && <span>{rows.length}</span>}</div>{holiday && <span className="calendar-month-holiday">Feriado · {holiday}</span>}
        <div className="calendar-month-events">{rows.slice(0, 3).map((item) => <button type="button" key={item.id} className={`calendar-month-event status-${String(item.status).toLowerCase()}${item.isOutsideHours ? ' is-outside-hours' : ''}`} onClick={() => onSelect(item.id)} aria-label={`${showTime(String(item.startsAt))}, ${String(item.patient?.fullName ?? 'Paciente')}, ${STATUS[String(item.status)] ?? String(item.status)}`}><time>{showTime(String(item.startsAt))}</time><span>{String(item.patient?.fullName ?? 'Paciente')}</span>{item.isOutsideHours && <small>Fora do expediente</small>}</button>)}{rows.length > 3 && <span className="calendar-month-more">+{rows.length - 3} mais</span>}</div>
      </div>
    })}
  </section>
}

function NowLine({ startHour, endHour }: { startHour: number; endHour: number }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer) }, [])
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const parts = Object.fromEntries(p.map((item) => [item.type, Number(item.value)])) as Record<string, number>
  const top = (parts.hour! * 60 + parts.minute! - startHour * 60) / 60 * 58
  return parts.hour! >= startHour && parts.hour! < endHour ? <div className="calendar-now" style={{ top: `${top}px` }} aria-label="Horário atual"><span>{showTime(now.toISOString())}</span></div> : null
}

function AppointmentDetails({ appointment, request, busy, error, canWrite, onClose, onAction, onOpenPatient, taskTitle, setTaskTitle, taskBusy, onCreateTask, onTaskChanged }: { appointment: Row; request: Request; busy: boolean; error: string; canWrite: boolean; onClose: () => void; onAction: (action: string, body: Record<string, unknown>) => Promise<boolean>; onOpenPatient: (id: string) => void; taskTitle: string; setTaskTitle: (value: string) => void; taskBusy: boolean; onCreateTask: () => void; onTaskChanged: () => Promise<void> }) {
  const [newStart, setNewStart] = useState('')
  const [check, setCheck] = useState<any>(null)
  const [detailError, setDetailError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [checking, setChecking] = useState(false)
  useEffect(() => { setNewStart(isoToLocalInput(String(appointment.startsAt))); setCheck(null) }, [appointment.id, appointment.startsAt])
  const isActive = ['PENDING', 'CONFIRMED'].includes(String(appointment.status))
  const automationRows = (appointment.automationExecutions ?? []) as Row[]
  async function checkNewTime(allowOutsideHours = false) {
    setChecking(true); setDetailError(''); setCheck(null)
    try {
      const duration = Math.max(5, Math.round((new Date(String(appointment.endsAt)).getTime() - new Date(String(appointment.startsAt)).getTime()) / 60000))
      const ids = (appointment.resources ?? []).map((row: Row) => row.resourceId).filter(Boolean)
      const params = new URLSearchParams({ unitId: String(appointment.unitId), startsAt: localInputToIso(newStart), ...(appointment.procedureId ? { procedureId: String(appointment.procedureId) } : { durationMinutes: String(duration) }), excludeAppointmentId: String(appointment.id), ...(ids.length ? { resourceIds: ids.join(',') } : {}), ...(allowOutsideHours ? { allowOutsideHours: 'true' } : {}) })
      setCheck(await request(`/appointments/availability?${params}`)); setDetailError('')
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : 'Falha na consulta de disponibilidade.') }
    finally { setChecking(false) }
  }
  async function runAction(action: string, body: Record<string, unknown>, message: string) {
    setActionNotice('')
    if (await onAction(action, body)) setActionNotice(message)
  }
  const historyLabels: Record<string, string> = { APPOINTMENT_CREATED: 'Agendamento criado', APPOINTMENT_STATUS_CHANGED: 'Status do agendamento alterado', APPOINTMENT_RESCHEDULED: 'Agendamento reagendado', NPS_SURVEYS_CANCELLED_WITH_APPOINTMENT: 'Pesquisa de satisfação cancelada' }
  const automationStatusLabels: Record<string, string> = { PENDING: 'Programada', OUTBOXED: 'Na fila (sem envio externo)', SIMULATED: 'Simulada (não entregue)', SUPPRESSED: 'Suprimida', FAILED: 'Falhou', RESPONDED: 'Resposta autenticada recebida', CANCELLED: 'Cancelada', SENT: 'Enviada', DELIVERED: 'Entregue', READ: 'Lida' }
  const taskStatusLabels: Record<string, string> = { TODO: 'A fazer', IN_PROGRESS: 'Em andamento', DONE: 'Concluída', CANCELLED: 'Cancelada' }
  const sourceLabel = appointment.source === 'NATIVE' ? 'Agenda nativa' : appointment.source === 'UNO' ? 'Agenda Uno' : 'Não identificado'
  const rescheduleIntervals = ((appointment.resources ?? []) as Row[]).map((row) => Number(row.resource?.startIntervalMinutes)).filter((value) => value > 0)
  const rescheduleInterval = rescheduleIntervals.length ? combinedStartInterval(rescheduleIntervals) : null
  return <div className="calendar-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="calendar-dialog detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button className="dialog-close" type="button" onClick={onClose} aria-label="Fechar">×</button><h2 id="detail-title">Agendamento</h2>{error && <div className="calendar-error" role="alert">{error}</div>}{actionNotice && <div className="calendar-success" role="status" aria-live="polite">{actionNotice}</div>}<div className="appointment-summary">{appointment.outsideHoursOverride && <strong className="outside-hours-badge">Exceção autorizada · fora do expediente</strong>}<b>{appointment.patient?.fullName}</b><span>{appointment.unit?.name} · {appointment.procedure?.name ?? 'Sem procedimento'}</span><span>{showDate(String(appointment.startsAt))} · {showTime(String(appointment.startsAt))}–{showTime(String(appointment.endsAt))} ({Math.round((new Date(String(appointment.endsAt)).getTime() - new Date(String(appointment.startsAt)).getTime()) / 60000)} min)</span><span>Status: {STATUS[String(appointment.status)] ?? appointment.status} · Origem: {sourceLabel}</span>{(appointment.resources as Row[] | undefined)?.length ? <span>Profissional/recurso: {(appointment.resources as Row[]).map((resource) => resource.resource?.name).filter(Boolean).join(', ')}</span> : null}<span>Criado por: {appointment.createdBy?.displayName ?? 'Não identificado'}</span><button type="button" onClick={() => onOpenPatient(String(appointment.patientId))}>Abrir perfil do paciente</button></div>
    {(appointment.resources ?? []).length > 0 && <span>Recursos: {(appointment.resources as Row[]).map((row) => row.resource?.name).filter(Boolean).join(', ')}</span>}
    {canWrite && <div className="appointment-actions">{appointment.status === 'PENDING' && <button disabled={busy} onClick={() => void runAction('status', { status: 'CONFIRMED' }, 'Agendamento confirmado.')}>Confirmar</button>}{appointment.status === 'CONFIRMED' && <><button disabled={busy} onClick={() => void runAction('status', { status: 'COMPLETED' }, 'Atendimento concluído.')}>Concluir atendimento</button><button disabled={busy} onClick={() => void runAction('status', { status: 'NO_SHOW' }, 'Falta registrada.')}>Marcar falta</button></>}{isActive && <button disabled={busy} onClick={() => void runAction('status', { status: 'CANCELLED' }, 'Agendamento cancelado.')}>Cancelar</button>}</div>}
    {canWrite && isActive && <section className="detail-section"><h3>Reagendar</h3><label>Novo horário (São Paulo)<input type="datetime-local" step={(rescheduleInterval ?? 15) * 60} value={newStart} onChange={(event) => { setNewStart(event.target.value); setCheck(null); setActionNotice('') }}/></label>{rescheduleInterval && <p className="duration-hint">Os recursos deste atendimento permitem inícios a cada {rescheduleInterval} minutos.</p>}<button type="button" disabled={!newStart || checking || busy} onClick={() => void checkNewTime()}>{checking ? 'Consultando…' : 'Consultar disponibilidade'}</button>{check && <p className={check.available ? (check.outsideHours ? 'availability outside-hours' : 'availability yes') : ['OUTSIDE_HOURS', 'CLOSED_DATE'].includes(check.reasonCode) ? 'availability outside-hours' : 'availability no'} role="status">{availabilityMessage(check, 'reschedule')}</p>}{check?.outsideHours && !check.available && ['OUTSIDE_HOURS', 'CLOSED_DATE'].includes(check.reasonCode) && <div className="outside-hours-confirm" role="group" aria-label="Verificar reagendamento fora do expediente"><p>Se precisar reagendar aqui, verifique conflitos e bloqueios. Essa consulta não altera o atendimento; se o horário estiver livre, confirme o reagendamento no próximo passo.</p><button type="button" className="confirm-outside-hours" disabled={checking || busy} onClick={() => void checkNewTime(true)}>Verificar conflitos para este horário</button></div>}{check?.available && <button type="button" className="primary" disabled={busy} onClick={() => void runAction('reschedule', { startsAt: localInputToIso(newStart), outsideHoursOverride: check?.outsideHours === true }, 'Agendamento reagendado.')}>{check?.outsideHours ? 'Confirmar reagendamento excepcional' : 'Confirmar reagendamento'}</button>}{detailError && <p role="alert">{detailError}</p>}</section>}
    <section className="detail-section"><h3>Tarefas vinculadas</h3>{((appointment.tasks ?? []) as Row[]).length ? ((appointment.tasks ?? []) as Row[]).map((task) => <article key={task.id}><b>{task.title}</b><span>{taskStatusLabels[String(task.status)] ?? task.status} · {task.assignee?.displayName ?? 'Sem responsável'}</span>{task.status !== 'DONE' && <button disabled={busy} onClick={async () => { try { await request(`/tasks/${task.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) }); await onTaskChanged(); setDetailError(''); setActionNotice('Tarefa concluída.') } catch (cause) { setDetailError(cause instanceof Error ? cause.message : 'Falha ao concluir tarefa.') } }}>Concluir tarefa</button>}</article>) : <p>Nenhuma tarefa vinculada.</p>}{canWrite && <div className="task-create"><input aria-label="Título da tarefa" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Ex.: retornar solicitação de horário"/><button disabled={taskBusy || !taskTitle.trim()} onClick={onCreateTask}>{taskBusy ? 'Salvando…' : 'Criar tarefa'}</button></div>}</section>
    <section className="detail-section"><h3>Automações do atendimento</h3>{automationRows.length ? automationRows.map((row) => { const outbox = row.outbox as Row | null; const status = String(row.status); const rawStatus = String(outbox?.status ?? status); const label = outbox?.status === 'SIMULATED' ? 'Simulada (não entregue)' : outbox?.status === 'SUPPRESSED' || status === 'SUPPRESSED' ? 'Suprimida' : outbox?.status === 'FAILED' || status === 'FAILED' ? 'Falhou' : status === 'RESPONDED' ? 'Resposta autenticada recebida' : automationStatusLabels[rawStatus] ?? 'Estado registrado'; return <article key={row.id}><b>{row.automation?.name ?? (row.satisfactionSurvey ? 'Pesquisa de satisfação' : 'Automação')}</b><span>{label} · {new Date(String(row.scheduledAt)).toLocaleString('pt-BR', { timeZone: TZ })}</span>{(row.lastError || outbox?.lastError) && <small>{String(row.lastError ?? outbox?.lastError)}</small>}</article> }) : <p>Nenhuma execução vinculada.</p>}</section>
    <section className="detail-section"><h3>Histórico de alterações</h3>{((appointment.history ?? []) as Row[]).length ? ((appointment.history ?? []) as Row[]).map((event) => <article key={event.id}><b>{historyLabels[String(event.action)] ?? 'Outra alteração registrada'}</b><span>{new Date(String(event.occurredAt)).toLocaleString('pt-BR', { timeZone: TZ })} · {event.actor?.displayName ?? 'Sistema'}</span></article>) : <p>Sem alterações auditadas além do registro atual.</p>}</section></section></div>
}

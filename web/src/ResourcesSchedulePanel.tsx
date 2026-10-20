import { useCallback, useEffect, useRef, useState } from 'react'

type Unit = { id: string; name: string }
type Item = Record<string, any> & { id: string }
type Request = (path: string, init?: RequestInit) => Promise<any>
const TYPES = ['PROFESSIONAL', 'ROOM', 'EQUIPMENT'] as const
const TYPE_LABEL: Record<string, string> = { PROFESSIONAL: 'Profissional', ROOM: 'Sala', EQUIPMENT: 'Equipamento' }
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const START_INTERVALS = [5, 10, 15, 20, 30, 60]
const blank = () => DAYS.map((_, weekday) => ({ weekday, intervals: [{ start: '08:00', end: '18:00' }], enabled: weekday > 0 && weekday < 6 }))
const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h! * 60 + m! }
const NATIONAL_HOLIDAYS = [{ date: '01-01', name: 'Confraternização Universal' }, { date: '04-21', name: 'Tiradentes' }, { date: '05-01', name: 'Dia do Trabalho' }, { date: '09-07', name: 'Independência do Brasil' }, { date: '10-12', name: 'Nossa Senhora Aparecida' }, { date: '11-02', name: 'Finados' }, { date: '11-15', name: 'Proclamação da República' }, { date: '11-20', name: 'Dia Nacional de Zumbi e da Consciência Negra' }, { date: '12-25', name: 'Natal' }]

export default function ResourcesSchedulePanel({ unitId, units, request, setNotice, scheduleOnly = false, onResourcesChanged }: { unitId: string; units: Unit[]; request: Request; setNotice: (message: string) => void; scheduleOnly?: boolean; onResourcesChanged?: () => void }) {
  const [resources, setResources] = useState<Item[]>([])
  const [intervalDrafts, setIntervalDrafts] = useState<Record<string, string>>({})
  const [procedures, setProcedures] = useState<Item[]>([])
  const [exceptions, setExceptions] = useState<Item[]>([])
  const [blocks, setBlocks] = useState<Item[]>([])
  const [enabled, setEnabled] = useState(false)
  const [intervals, setIntervals] = useState(blank)
  const [name, setName] = useState('')
  const [type, setType] = useState<typeof TYPES[number]>('PROFESSIONAL')
  const [exceptionDate, setExceptionDate] = useState('')
  const [exceptionLabel, setExceptionLabel] = useState('')
  const [exceptionClosed, setExceptionClosed] = useState(true)
  const [exceptionIntervals, setExceptionIntervals] = useState([{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }])
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLDivElement>(null)
  const exceptionFormRef = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (error) { errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); errorRef.current?.focus() } }, [error])
  const load = useCallback(async () => {
    if (!unitId) return
    const [catalog, schedule] = await Promise.all([request(`/resources?unitId=${encodeURIComponent(unitId)}`), request(`/units/${unitId}/schedule`)] as const)
    setResources(catalog.resources); setIntervalDrafts(Object.fromEntries(catalog.resources.map((resource: Item) => [resource.id, String(resource.startIntervalMinutes ?? '')]))); setProcedures(catalog.procedures); setExceptions(schedule.exceptions); setBlocks(schedule.blocks); setEnabled(schedule.unit.scheduleEnabled)
    setIntervals(blank().map((day) => {
      const rows = schedule.weekly.filter((item: Item) => item.weekday === day.weekday)
      return rows.length ? { ...day, enabled: true, intervals: rows.map((row: Item) => ({ start: `${String(Math.floor(row.startMinute / 60)).padStart(2, '0')}:${String(row.startMinute % 60).padStart(2, '0')}`, end: `${String(Math.floor(row.endMinute / 60)).padStart(2, '0')}:${String(row.endMinute % 60).padStart(2, '0')}` })) } : day
    }))
  }, [request, unitId])
  useEffect(() => { void load().catch((cause: Error) => setError(cause.message)) }, [load])
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true); setError('')
    try { await action(); await load(); setNotice(success); return true } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a configuração.'); return false } finally { setBusy(false) }
  }
  async function createResource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); await run(async () => { await request('/resources', { method: 'POST', body: JSON.stringify({ unitId, name, type }) }); setName('') }, 'Recurso cadastrado e auditado.')
  }
  async function saveResourceInterval(resource: Item) {
    const value = intervalDrafts[resource.id] || null
    const saved = await run(() => request(`/resources/${resource.id}`, { method: 'PATCH', body: JSON.stringify({ startIntervalMinutes: value === null ? null : Number(value) }) }), `Horários de início de ${resource.name} atualizados.`)
    if (saved) onResourcesChanged?.()
  }
  async function saveWeekly() {
    await run(() => request(`/units/${unitId}/schedule/weekly`, { method: 'PUT', body: JSON.stringify({ enabled, intervals: intervals.filter((row) => row.enabled).flatMap((row) => row.intervals.map((interval) => ({ weekday: row.weekday, startMinute: minutes(interval.start), endMinute: minutes(interval.end) }))) }) }), 'Expediente semanal salvo.')
  }
  async function saveException(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => { await request(`/units/${unitId}/schedule/exceptions/${exceptionDate}`, { method: 'PUT', body: JSON.stringify({ closed: exceptionClosed, label: exceptionLabel, intervals: exceptionClosed ? [] : exceptionIntervals.map((interval) => ({ startMinute: minutes(interval.start), endMinute: minutes(interval.end) })) }) }); setExceptionDate(''); setExceptionLabel('') }, 'Exceção de data salva.')
  }
  async function setRequirement(procedureId: string, resourceType: string, quantity: number) {
    const procedure = procedures.find((item) => item.id === procedureId)
    const existing = (procedure?.resourceRequirements ?? []).filter((item: Item) => item.resourceType !== resourceType).map((item: Item) => ({ resourceType: item.resourceType, quantity: item.quantity }))
    if (quantity > 0) existing.push({ resourceType, quantity })
    await run(() => request(`/resources/procedure-requirements/${procedureId}`, { method: 'PUT', body: JSON.stringify({ unitId, requirements: existing }) }), 'Recursos exigidos pelo procedimento atualizados.')
  }
  const grouped = TYPES.map((resourceType) => ({ resourceType, items: resources.filter((item) => item.type === resourceType) }))
  const holidays = NATIONAL_HOLIDAYS.map((holiday) => ({ ...holiday, date: `${new Date().getFullYear()}-${holiday.date}` }))
  function configureHoliday(holiday: { date: string; name: string }) {
    const current = exceptions.find((row) => row.date.slice(0, 10) === holiday.date)
    setExceptionDate(holiday.date); setExceptionLabel(holiday.name); setExceptionClosed(current?.closed ?? true)
    if (current && !current.closed) setExceptionIntervals(current.intervals.map((interval: Item) => ({ start: `${String(Math.floor(interval.startMinute / 60)).padStart(2, '0')}:${String(interval.startMinute % 60).padStart(2, '0')}`, end: `${String(Math.floor(interval.endMinute / 60)).padStart(2, '0')}:${String(interval.endMinute % 60).padStart(2, '0')}` })))
    window.setTimeout(() => exceptionFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }
  async function closeHoliday(holiday: { date: string; name: string }) {
    await run(() => request(`/units/${unitId}/schedule/exceptions/${holiday.date}`, { method: 'PUT', body: JSON.stringify({ closed: true, label: holiday.name, intervals: [] }) }), `Unidade fechada em ${holiday.name}.`)
  }
  return <div className={`resource-schedule-panel${scheduleOnly ? ' is-schedule-only' : ''}`}>
    {error && <div ref={errorRef} className="calendar-error" role="alert" tabIndex={-1}>{error}</div>}
    <p>{scheduleOnly ? <>Unidade <b>{units.find((unit) => unit.id === unitId)?.name ?? ''}</b> · fuso de Brasília (America/Sao_Paulo). Configure os horários de início, o expediente e as exceções desta agenda.</> : <>Configurações da unidade <b>{units.find((unit) => unit.id === unitId)?.name ?? ''}</b> · fuso de Brasília (America/Sao_Paulo). O expediente e os intervalos dos recursos são conferidos ao agendar.</>}</p>
    <section className="detail-section resource-config-section"><h2>Profissionais, salas e equipamentos</h2><form className="module-form" onSubmit={(event) => void createResource(event)}><select aria-label="Tipo de recurso" value={type} onChange={(event) => setType(event.target.value as typeof type)}>{TYPES.map((value) => <option key={value} value={value}>{TYPE_LABEL[value]}</option>)}</select><input aria-label="Nome do recurso" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome"/><button className="primary" disabled={busy}>Cadastrar</button></form>
      {grouped.map(({ resourceType, items }) => <div key={resourceType}><h3>{TYPE_LABEL[resourceType]}</h3>{items.length ? items.map((item) => <article key={item.id}><b>{item.name}</b><span>{item.active ? 'Ativo' : 'Inativo'}</span><button type="button" disabled={busy} onClick={() => void run(() => request(`/resources/${item.id}`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) }), `Recurso ${item.active ? 'desativado' : 'ativado'}.`)}>{item.active ? 'Desativar' : 'Ativar'}</button></article>) : <p>{resourceType === 'ROOM' ? 'Nenhuma sala cadastrada.' : resourceType === 'PROFESSIONAL' ? 'Nenhum profissional cadastrado.' : 'Nenhum equipamento cadastrado.'}</p>}</div>)}</section>
    <section className="detail-section resource-interval-section"><h2>Intervalo entre inícios por agenda</h2><p>Defina de quanto em quanto tempo um atendimento pode começar para cada profissional, sala ou equipamento. Para ocupar 15 ou 60 minutos, ajuste também a duração do procedimento em Automações.</p>{resources.filter((resource) => resource.active).length ? resources.filter((resource) => resource.active).map((resource) => <div className="resource-interval-row" key={resource.id}><div><strong>{resource.name}</strong><small>{TYPE_LABEL[resource.type]}</small></div><label>Começar a cada<select value={intervalDrafts[resource.id] ?? ''} onChange={(event) => setIntervalDrafts((current) => ({ ...current, [resource.id]: event.target.value }))} disabled={busy} aria-label={`Intervalo entre inícios de ${resource.name}`}><option value="">Sem restrição</option>{START_INTERVALS.map((minute) => <option key={minute} value={minute}>{minute} minutos</option>)}</select></label><button type="button" disabled={busy || (intervalDrafts[resource.id] ?? '') === String(resource.startIntervalMinutes ?? '')} onClick={() => void saveResourceInterval(resource)}>Salvar</button></div>) : <p>Cadastre um profissional ou equipamento em Recursos para configurar os horários de início.</p>}<p className="resource-interval-example">Exemplo: 15 minutos permite 09:00, 09:15, 09:30…; 60 minutos permite 09:00, 10:00, 11:00… Se um agendamento usar dois recursos, o início precisa respeitar os dois.</p></section>
    <section className="detail-section procedure-config-section"><h2>Recursos exigidos por procedimento</h2>{procedures.length ? procedures.map((procedure) => <article key={procedure.id}><b>{procedure.name}</b>{TYPES.map((resourceType) => { const requirement = (procedure.resourceRequirements ?? []).find((row: Item) => row.resourceType === resourceType); return <label key={resourceType}><input type="checkbox" checked={Boolean(requirement)} onChange={(event) => void setRequirement(procedure.id, resourceType, event.target.checked ? 1 : 0)} disabled={busy}/>{TYPE_LABEL[resourceType]}{requirement && <select aria-label={`Quantidade ${TYPE_LABEL[resourceType]} ${procedure.name}`} value={requirement.quantity} onChange={(event) => void setRequirement(procedure.id, resourceType, Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => index + 1).map((quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}</select>}</label> })}</article>) : <p>Nenhum procedimento ativo nesta unidade.</p>}</section>
    <section className="detail-section"><h2>Expediente semanal</h2><label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)}/> Validar expediente ao criar ou reagendar</label>{intervals.map((day, index) => <div className="schedule-day-row" key={day.weekday}><label><input type="checkbox" checked={day.enabled} onChange={(event) => setIntervals((rows) => rows.map((row, i) => i === index ? { ...row, enabled: event.target.checked } : row))}/>{DAYS[index]}</label><div className="schedule-intervals">{day.intervals.map((interval, intervalIndex) => <div key={intervalIndex}><input aria-label={`${DAYS[index]} intervalo ${intervalIndex + 1} abre`} type="time" value={interval.start} onChange={(event) => setIntervals((rows) => rows.map((row, i) => i === index ? { ...row, intervals: row.intervals.map((value, n) => n === intervalIndex ? { ...value, start: event.target.value } : value) } : row))} disabled={!day.enabled}/><span>até</span><input aria-label={`${DAYS[index]} intervalo ${intervalIndex + 1} fecha`} type="time" value={interval.end} onChange={(event) => setIntervals((rows) => rows.map((row, i) => i === index ? { ...row, intervals: row.intervals.map((value, n) => n === intervalIndex ? { ...value, end: event.target.value } : value) } : row))} disabled={!day.enabled}/><button type="button" disabled={!day.enabled || day.intervals.length === 1} onClick={() => setIntervals((rows) => rows.map((row, i) => i === index ? { ...row, intervals: row.intervals.filter((_, n) => n !== intervalIndex) } : row))}>Remover</button></div>)}</div><button type="button" disabled={!day.enabled || day.intervals.length >= 4} onClick={() => setIntervals((rows) => rows.map((row, i) => i === index ? { ...row, intervals: [...row.intervals, { start: '13:00', end: '18:00' }] } : row))}>Adicionar intervalo</button></div>)}<button className="primary" disabled={busy} onClick={() => void saveWeekly()}>Salvar expediente</button></section>
    <section className="detail-section national-holiday-settings"><h2>Feriados nacionais do Brasil · {new Date().getFullYear()}</h2><p>Os feriados são destacados na agenda. Para bloquear reservas nesses dias, ative a validação do expediente e marque a unidade como fechada.</p>{holidays.map((holiday) => { const current = exceptions.find((row) => row.date.slice(0, 10) === holiday.date); return <article key={holiday.date}><b>{holiday.date.slice(5).split('-').reverse().join('/')} · {holiday.name}</b><span>{current ? current.closed ? 'Unidade fechada' : 'Horário especial' : 'Segue o expediente semanal'}</span><button type="button" disabled={busy} onClick={() => current ? configureHoliday(holiday) : void closeHoliday(holiday)}>{current ? 'Editar expediente' : 'Fechar unidade'}</button></article> })}</section>
    <section className="detail-section"><h2>Feriados e exceções</h2><form ref={exceptionFormRef} className="module-form" onSubmit={(event) => void saveException(event)}><input aria-label="Data da exceção" type="date" required value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)}/><input aria-label="Descrição da exceção" value={exceptionLabel} onChange={(event) => setExceptionLabel(event.target.value)} placeholder="Ex.: Feriado"/><label><input type="checkbox" checked={exceptionClosed} onChange={(event) => setExceptionClosed(event.target.checked)}/> Unidade fechada</label>{!exceptionClosed && <div className="schedule-intervals">{exceptionIntervals.map((interval, index) => <div key={index}><input aria-label={`Exceção intervalo ${index + 1} abre`} type="time" value={interval.start} onChange={(event) => setExceptionIntervals((rows) => rows.map((row, i) => i === index ? { ...row, start: event.target.value } : row))}/><span>até</span><input aria-label={`Exceção intervalo ${index + 1} fecha`} type="time" value={interval.end} onChange={(event) => setExceptionIntervals((rows) => rows.map((row, i) => i === index ? { ...row, end: event.target.value } : row))}/><button type="button" disabled={exceptionIntervals.length === 1} onClick={() => setExceptionIntervals((rows) => rows.filter((_, i) => i !== index))}>Remover intervalo</button></div>)}<button type="button" disabled={exceptionIntervals.length >= 4} onClick={() => setExceptionIntervals((rows) => [...rows, { start: '13:00', end: '17:00' }])}>Adicionar intervalo</button></div>}<button className="primary" disabled={busy}>Salvar exceção</button></form>{exceptions.map((row) => <article key={row.id}><b>{row.date.slice(0, 10)} · {row.label ?? (row.closed ? 'Fechado' : 'Horário especial')}</b><span>{row.closed ? 'Fechado o dia todo' : row.intervals.map((interval: Item) => `${interval.startMinute}-${interval.endMinute}`).join(', ')}</span><button disabled={busy} onClick={() => void run(() => request(`/units/${unitId}/schedule/exceptions/${row.date.slice(0, 10)}`, { method: 'DELETE' }), 'Exceção removida.')}>Remover</button></article>)}</section>
    <section className="detail-section"><h2>Bloqueios futuros</h2>{blocks.length ? blocks.map((block) => <article key={block.id}><b>{block.label ?? 'Bloqueio'}</b><span>{new Date(block.startsAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · {block.resource?.name ?? 'Unidade inteira'}</span><button disabled={busy} onClick={() => void run(() => request(`/units/${unitId}/schedule/blocks/${block.id}`, { method: 'DELETE' }), 'Bloqueio removido.')}>Remover</button></article>) : <p>Nenhum bloqueio futuro.</p>}<BlockForm resources={resources} busy={busy} onSave={(payload) => void run(() => request(`/units/${unitId}/schedule/blocks`, { method: 'POST', body: JSON.stringify(payload) }), 'Bloqueio cadastrado.')}/></section>
  </div>
}

function BlockForm({ resources, busy, onSave }: { resources: Item[]; busy: boolean; onSave: (payload: Record<string, unknown>) => void }) {
  const [startsAt, setStartsAt] = useState(''); const [endsAt, setEndsAt] = useState(''); const [resourceId, setResourceId] = useState(''); const [label, setLabel] = useState('')
  return <form className="module-form" onSubmit={(event) => { event.preventDefault(); onSave({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), resourceId: resourceId || undefined, label }) }}><input aria-label="Início do bloqueio" type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)}/><input aria-label="Fim do bloqueio" type="datetime-local" required value={endsAt} onChange={(event) => setEndsAt(event.target.value)}/><select aria-label="Recurso bloqueado" value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">Unidade inteira</option>{resources.filter((row) => row.active).map((row) => <option key={row.id} value={row.id}>{TYPE_LABEL[row.type]} · {row.name}</option>)}</select><input aria-label="Motivo do bloqueio" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Motivo"/><button disabled={busy}>Adicionar bloqueio</button></form>
}

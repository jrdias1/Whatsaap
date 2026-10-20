import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './reports.css'
import { statusLabel } from './status-labels.js'

type Unit = { id: string; name: string }
type Row = Record<string, any> & { id?: string }
type Props = { request: (path: string, init?: RequestInit) => Promise<any>; download: (path: string, name: string) => Promise<void>; units: Unit[]; unitId: string; role: string; userId: string; refreshKey: number; onNavigate: (page: string) => void }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const offsetDate = (value: string, days: number) => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }

export default function ReportsPage({ request, download, units, unitId, role, userId, refreshKey, onNavigate }: Props) {
  const [from, setFrom] = useState(() => offsetDate(today(), -29))
  const [to, setTo] = useState(today)
  const [selectedUnit, setSelectedUnit] = useState(unitId)
  const [report, setReport] = useState<Row | null>(null)
  const [previous, setPrevious] = useState<Row | null>(null)
  const [surveys, setSurveys] = useState<Row[]>([])
  const [assignees, setAssignees] = useState<Row[]>([])
  const [procedures, setProcedures] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [config, setConfig] = useState<Row>({ enabled: false, unitId: '', eligibleProcedureIds: [], delayHours: 24, question: 'De 0 a 10, o quanto você recomendaria nossa clínica?', allowComment: true, repeatAfterDays: 0, windowStartMinute: 480, windowEndMinute: 1200, createFollowupBelow: '', followupDueHours: 24, responsibleUserId: userId })
  const params = useMemo(() => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${selectedUnit ? `&unitId=${encodeURIComponent(selectedUnit)}` : ''}`, [from, to, selectedUnit])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const span = Math.max(1, Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000) + 1)
      const previousTo = offsetDate(from, -1)
      const previousFrom = offsetDate(previousTo, -(span - 1))
      const previousParams = `from=${previousFrom}&to=${previousTo}${selectedUnit ? `&unitId=${encodeURIComponent(selectedUnit)}` : ''}`
      const [current, prior, surveyResult] = await Promise.all([
        request(`/reports/overview?${params}`), request(`/reports/overview?${previousParams}`),
        request(`/reports/nps/surveys?${params}&page=1&pageSize=100`),
      ])
      setReport(current); setPrevious(prior); setSurveys(surveyResult.items)
    } catch (cause) { setError((cause as Error).message || 'Não foi possível carregar os relatórios.') }
    finally { setLoading(false) }
  }, [from, to, selectedUnit, params, request])
  useEffect(() => { void load() }, [load, refreshKey])
  useEffect(() => { setSelectedUnit(unitId) }, [unitId])
  useEffect(() => {
    if (role !== 'TENANT_ADMIN') return
    request('/reports/nps/settings').then((row) => setConfig({ ...row, unitId: row.unitId ?? '', eligibleProcedureIds: Array.isArray(row.eligibleProcedureIds) ? row.eligibleProcedureIds : [], createFollowupBelow: row.createFollowupBelow ?? '', responsibleUserId: row.responsibleUserId ?? userId })).catch((cause: Error) => setError(cause.message))
  }, [request, role, userId])
  useEffect(() => {
    if (role !== 'TENANT_ADMIN') return
    const query = config.unitId ? `?unitId=${encodeURIComponent(String(config.unitId))}` : ''
    request(`/inbox/assignees${query}`).then(setAssignees).catch(() => setAssignees([]))
  }, [request, role, config.unitId])
  useEffect(() => {
    if (role !== 'TENANT_ADMIN') return
    request('/procedures').then((rows) => setProcedures(Array.isArray(rows) ? rows : [])).catch(() => setProcedures([]))
  }, [request, role])
  const changeConfig = (key: string, value: unknown) => setConfig((current) => ({ ...current, [key]: value }))

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const value = { ...config, unitId: config.unitId || null, createFollowupBelow: config.createFollowupBelow === '' ? null : Number(config.createFollowupBelow), delayHours: Number(config.delayHours), repeatAfterDays: Number(config.repeatAfterDays), windowStartMinute: Number(config.windowStartMinute), windowEndMinute: Number(config.windowEndMinute), followupDueHours: Number(config.followupDueHours), eligibleProcedureIds: Array.isArray(config.eligibleProcedureIds) ? config.eligibleProcedureIds : [] }
      const saved = await request('/reports/nps/settings', { method: 'PUT', body: JSON.stringify(value) })
      setConfig({ ...saved, unitId: saved.unitId ?? '', createFollowupBelow: saved.createFollowupBelow ?? '', eligibleProcedureIds: Array.isArray(saved.eligibleProcedureIds) ? saved.eligibleProcedureIds : [] })
      setNotice(saved.enabled ? 'Configuração do NPS salva. As pesquisas serão planejadas apenas para atendimentos elegíveis e com consentimento.' : 'NPS desativado e configuração salva.')
      await load()
    } catch (cause) { setError((cause as Error).message) } finally { setSaving(false) }
  }
  async function recordResponse(event: FormEvent<HTMLFormElement>, survey: Row) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setError(''); setNotice('')
    try {
      const result = await request(`/reports/nps/surveys/${survey.id}/response`, { method: 'POST', body: JSON.stringify({ score: Number(form.get('score')), comment: form.get('comment') }) })
      setNotice(result.followupTaskId ? 'Resposta registrada e tarefa de acompanhamento criada.' : 'Resposta NPS registrada com autoria da equipe.')
      await load()
    } catch (cause) { setError((cause as Error).message) }
  }
  async function exportCsv() { setExporting(true); setError(''); try { await download(`/reports/export.csv?${params}`, `relatório-${from}-${to}.csv`); setNotice('CSV agregado exportado; a exportação foi auditada.') } catch (cause) { setError((cause as Error).message) } finally { setExporting(false) } }

  const a = report?.appointments ?? {}, p = report?.patients ?? {}, s = report?.service ?? {}, auto = report?.automations ?? {}, referral = report?.referrals ?? {}, nps = report?.nps ?? {}
  const cards = [
    ['Agendamentos criados', a.created, delta(a.created, previous?.appointments?.created)],
    ['Concluídos', a.completed, delta(a.completed, previous?.appointments?.completed)],
    ['Faltas', a.noShow, delta(a.noShow, previous?.appointments?.noShow)],
    ['Pacientes ativos', p.active, null],
    ['Conversas novas', s.conversationsCreated, delta(s.conversationsCreated, previous?.service?.conversationsCreated)],
    ['Tarefas vencidas', s.tasksOverdue, null],
    ['Falhas de automação', auto.failed, delta(auto.failed, previous?.automations?.failed)],
    ['NPS', nps.nps === null ? '—' : nps.nps, `${nps.responses ?? 0} respostas válidas`],
  ] as Array<[string, string | number, string | null]>
  return <div className="reports-page">
    <section className="reports-filters" aria-label="Filtros do relatório"><label>De<input aria-label="Data inicial" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}/></label><label>Até<input aria-label="Data final" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}/></label><label>Unidade<select aria-label="Unidade do relatório" value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)}><option value="">Todas as unidades permitidas</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Atualizando…' : 'Aplicar filtros'}</button><button type="button" className="reports-export" onClick={() => void exportCsv()} disabled={exporting || loading}>{exporting ? 'Preparando o CSV…' : 'Exportar CSV'}</button></section>
    {error && <div className="reports-alert" role="alert">{error}</div>}{notice && <div className="reports-notice" role="status">{notice}</div>}
    {loading && !report ? <p className="reports-empty" role="status">Carregando dados…</p> : report && <>
      <section className="reports-cards" aria-label="Indicadores gerenciais">{cards.map(([title, value, detail]) => <article className="reports-card" key={title}><span>{title}</span><b>{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</b><small>{detail ?? 'Sem comparação confiável no período'}</small></article>)}</section>
      <details className="reports-disclosure">
        <summary><strong>Agenda e pacientes</strong><span>Atendimentos, procedimentos e cadastros</span><span className="reports-disclosure-indicator" aria-hidden="true"/></summary>
      <section className="reports-grid">
        <article className="reports-panel"><PanelTitle title="Agendamentos por dia" detail="Distribuição pela data do atendimento; cancelados ficam fora desta tendência."/><Trend rows={a.trends ?? []}/><div className="reports-breakdown"><b>Situação atual dos agendamentos no período</b><span>Confirmados: {a.confirmed ?? 0} · Concluídos: {a.completed ?? 0} · Cancelados: {a.cancelled ?? 0} · Faltas: {a.noShow ?? 0}</span><small>Novos cadastros são contados pela data de criação; conclusões, pela data de conclusão. A situação atual considera a data do atendimento. Reagendamentos contam pelos eventos registrados no histórico.</small></div></article>
        <article className="reports-panel"><PanelTitle title="Por procedimento" detail="Agendamentos ocorridos no período."/><SimpleTable headers={['Procedimento', 'Agendamentos']} rows={a.byProcedure ?? []} values={(row) => [row.name, row.count]}/><button className="report-link" onClick={() => onNavigate('Agenda')}>Abrir agenda</button></article>
        <article className="reports-panel"><PanelTitle title="Pacientes" detail="A unidade abaixo é a unidade preferencial do cadastro; ela não representa necessariamente o local do atendimento."/><div className="reports-breakdown"><span>Novos cadastros: <b>{p.newInPeriod ?? 0}</b> · Arquivados ou inativos atualizados: <b>{p.archivedUpdatedInPeriod ?? 0}</b></span><SimpleTable headers={['Unidade preferencial', 'Pacientes ativos']} rows={p.byPreferredUnit ?? []} values={(row) => [row.unitName, row.count]}/></div><button className="report-link" onClick={() => onNavigate('Pacientes')}>Abrir pacientes</button></article>
      </section>
      </details>
      <details className="reports-disclosure">
        <summary><strong>Atendimento e operação</strong><span>Conversas, automações e indicações</span><span className="reports-disclosure-indicator" aria-hidden="true"/></summary>
      <section className="reports-grid">
        <article className="reports-panel"><PanelTitle title="Atendimento e mensagens" detail="Rascunhos de IA não contam como resposta humana; cada situação é apresentada separadamente."/><div className="reports-breakdown"><span>Conversas novas: {Number(s.conversationsCreated ?? 0).toLocaleString('pt-BR')} · Aguardando equipe: {Number(s.conversationsWaitingHuman ?? 0).toLocaleString('pt-BR')} · Atribuídas em aberto: {Number(s.conversationsAssigned ?? 0).toLocaleString('pt-BR')}</span><span>Tarefas: {Number(s.tasksCreated ?? 0).toLocaleString('pt-BR')} criadas · {Number(s.tasksCompleted ?? 0).toLocaleString('pt-BR')} concluídas · {Number(s.tasksOverdue ?? 0).toLocaleString('pt-BR')} vencidas</span><span>Tempo de resposta humana: {s.humanResponseMinutes == null ? 'Indisponível' : `${Number(s.humanResponseMinutes).toLocaleString('pt-BR')} min`}</span>{s.humanResponseUnavailableReason && <small>{s.humanResponseUnavailableReason}</small>}</div><SimpleTable headers={['Direção', 'Responsável', 'Situação', 'Quantidade']} rows={s.messages ?? []} values={(row) => [row.direction === 'OUTBOUND' ? 'Enviada' : row.direction === 'INBOUND' ? 'Recebida' : statusLabel(row.direction), statusLabel(row.actor), statusLabel(row.status), Number(row.count).toLocaleString('pt-BR')]}/><button className="report-link" onClick={() => onNavigate('Inbox')}>Abrir central de atendimentos</button></article>
        <article className="reports-panel"><PanelTitle title="Automações" detail="Uma simulação não representa mensagem entregue."/><SimpleTable headers={['Estado', 'Execuções']} rows={Object.entries(auto.executions ?? {}).map(([status, count]) => ({ id: status, status, count }))} values={(row) => [statusLabel(row.status), row.count]}/><div className="reports-breakdown"><span>Simuladas (não entregues): {unavailableAware(auto.simulated, auto.unitStatusUnavailableReason)} · Suprimidas: {unavailableAware(auto.suppressed, auto.unitStatusUnavailableReason)} · Falhas: {auto.failed ?? 0} · Tarefas: {auto.tasksCreatedByAutomation ?? 0}</span><span>Entregues/lidas: {unavailableAware(auto.delivered, auto.unitStatusUnavailableReason)}</span>{auto.unitStatusUnavailableReason && <small>{auto.unitStatusUnavailableReason}</small>}</div><button className="report-link" onClick={() => onNavigate('Automações')}>Abrir automações</button></article>
        <article className="reports-panel"><PanelTitle title="Indicações e fidelidade" detail="Conversões não equivalem a faturamento ou retorno financeiro."/><div className="reports-cards reports-cards-compact">{[['Links emitidos', referral.linksIssued], ['Cliques', referral.clicks], ['Leads', referral.leads], ['Qualificadas', referral.qualified], ['Conversões', referral.conversions], ['Pendentes de aprovação', referral.rewards?.PENDING_APPROVAL ?? 0], ['Vouchers emitidos', referral.vouchersIssued], ['Vouchers usados', referral.vouchersUsed], ['Expirados', referral.expiredVouchers]].map(([label, value]) => <div key={String(label)}><span>{label}</span><b>{Number(value ?? 0)}</b></div>)}</div><button className="report-link" onClick={() => onNavigate('Indicações')}>Abrir indicações</button></article>
      </section>
      </details>
      <details className="reports-disclosure">
        <summary><strong>NPS e pesquisas</strong><span>Notas registradas pela equipe e tarefas de acompanhamento</span><span className="reports-disclosure-indicator" aria-hidden="true"/></summary>
      <section className="reports-grid">
        <article className="reports-panel reports-panel-wide"><PanelTitle title="NPS da clínica" detail="A equipe registra uma nota de 0 a 10 recebida do paciente. Não há envio automático de pesquisa ou mensagem."/><p className="reports-nps-explainer">Notas de 0 a 6 são detratoras; 7 e 8 são neutras; 9 e 10 são promotoras. O NPS é o percentual de promotores menos o percentual de detratores. A pesquisa de satisfação de cinco opções é separada.</p><div className="reports-nps-summary"><strong>{nps.nps === null ? 'Sem respostas' : `${nps.nps} pontos`}</strong><span>{nps.responses ?? 0} respostas válidas · {nps.promoters ?? 0} promotores · {nps.passives ?? 0} neutros · {nps.detractors ?? 0} detratores</span><span>Acompanhamentos: {nps.followupsPending ?? 0} {(nps.followupsPending ?? 0) === 1 ? 'pendente' : 'pendentes'} · {nps.followupsCompleted ?? 0} concluídos no período · {nps.followupsCreated ?? 0} criados no período</span></div><NpsTrend rows={nps.trend ?? []}/><details className="reports-distribution"><summary>Ver distribuição das notas</summary><SimpleTable headers={['Nota', 'Respostas']} rows={Object.entries(nps.distribution ?? {}).map(([score, count]) => ({ id: score, score, count }))} values={(row) => [row.score, row.count]}/></details></article>
        <article className="reports-panel"><PanelTitle title="Pesquisa de satisfação (5 opções)" detail="Pesquisa já existente, independente do indicador NPS."/><div className="reports-breakdown"><b>{report.satisfaction5?.responses ?? 0} respostas registradas</b>{Object.entries(report.satisfaction5?.distribution ?? {}).map(([label, count]) => <span key={label}>{label}: {String(count)}</span>)}</div><button className="report-link" onClick={() => onNavigate('Automações')}>Ver configurações de satisfação</button></article>
      </section>
      <section className="reports-panel reports-nps-work"><PanelTitle title="Pesquisas pendentes e respostas" detail="Use a pergunta abaixo ao conversar com o paciente. Depois, registre a nota recebida; o sistema não envia a pesquisa."/><p>Registros neste período: {surveys.filter((item) => item.status === 'PLANNED').length} pendentes · {surveys.filter((item) => item.status === 'RESPONDED').length} respondidos</p>{surveys.length ? <div className="reports-surveys">{surveys.map((survey) => <article key={survey.id}><div><b>{survey.unit?.name ?? 'Unidade'} · {new Date(survey.appointment?.startsAt ?? survey.scheduledAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</b><span>{survey.appointment?.procedure?.name ?? 'Atendimento'} · {survey.status === 'RESPONDED' ? `Nota ${survey.score}/10 (${survey.responseSource === 'STAFF_RECORDED' ? 'registrada pela equipe' : survey.responseSource})` : 'Pendente de registro pela equipe'}</span><small className="reports-survey-question">Pergunta: {survey.question}</small>{survey.comment && <small>{survey.comment}</small>}</div>{survey.status === 'PLANNED' && <form onSubmit={(event) => void recordResponse(event, survey)}><label>Nota<select required name="score" defaultValue=""><option value="" disabled>0 a 10</option>{Array.from({ length: 11 }, (_, score) => <option key={score} value={score}>{score}</option>)}</select></label>{survey.allowComment && <label>Comentário (opcional)<input name="comment" maxLength={2000}/></label>}<button type="submit">Registrar nota</button></form>}</article>)}</div> : <p className="reports-empty">Nenhum registro NPS neste período. Eles aparecem depois de atendimentos concluídos que atendam às regras configuradas.</p>}<button className="report-link" onClick={() => onNavigate('Tarefas')}>Ver tarefas de acompanhamento</button></section>
      {role === 'TENANT_ADMIN' && <details className="reports-disclosure reports-nps-settings"><summary><strong>Configurar quando o sistema deve preparar o registro NPS</strong><span>{config.enabled ? 'Ativado' : 'Desativado'}</span><span className="reports-disclosure-indicator" aria-hidden="true"/></summary><section className="reports-panel reports-nps-config"><p className="reports-nps-explainer">Ao concluir um atendimento nativo, o sistema pode criar um registro pendente para a equipe coletar a nota depois. Isso só ocorre com paciente ativo, unidade e procedimento elegíveis e consentimento registrado para pesquisa de satisfação. Nenhuma mensagem é enviada.</p><form onSubmit={(event) => void saveConfig(event)}>
        <label className="reports-toggle"><input type="checkbox" checked={Boolean(config.enabled)} onChange={(e) => changeConfig('enabled', e.target.checked)}/> Preparar registros NPS após atendimentos elegíveis</label>
        <label>Unidade<select value={String(config.unitId ?? '')} onChange={(e) => changeConfig('unitId', e.target.value)}><option value="">Todas as unidades permitidas</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <fieldset className="reports-procedures"><legend>Procedimentos incluídos (nenhum selecionado = todos)</legend>{procedures.filter((procedure) => !config.unitId || !procedure.unitId || procedure.unitId === config.unitId).map((procedure) => <label key={procedure.id}><input type="checkbox" checked={(config.eligibleProcedureIds ?? []).includes(procedure.id)} onChange={(event) => changeConfig('eligibleProcedureIds', event.target.checked ? [...(config.eligibleProcedureIds ?? []), procedure.id] : (config.eligibleProcedureIds ?? []).filter((id: string) => id !== procedure.id))}/>{procedure.name}</label>)}{procedures.length === 0 && <small>Nenhum procedimento disponível.</small>}</fieldset>
        <label>Preparar registro após a conclusão (horas)<input type="number" min="0" max="720" value={config.delayHours ?? 24} onChange={(e) => changeConfig('delayHours', e.target.value)}/></label>
        <label>Pergunta que a equipe fará ao paciente<input maxLength={1000} value={String(config.question ?? '')} onChange={(e) => changeConfig('question', e.target.value)}/></label>
        <label className="reports-toggle"><input type="checkbox" checked={config.allowComment !== false} onChange={(e) => changeConfig('allowComment', e.target.checked)}/> Permitir que a equipe registre comentário</label>
        <label>Intervalo mínimo entre registros (dias; 0 = sem intervalo)<input type="number" min="0" max="365" value={config.repeatAfterDays ?? 0} onChange={(e) => changeConfig('repeatAfterDays', e.target.value)}/></label>
        <label>Horário inicial para a equipe coletar a nota<input type="time" value={minuteToTime(config.windowStartMinute ?? 480)} onChange={(e) => changeConfig('windowStartMinute', timeToMinute(e.target.value))}/></label>
        <label>Horário final para a equipe coletar a nota<input type="time" value={minuteToTime(config.windowEndMinute ?? 1200)} onChange={(e) => changeConfig('windowEndMinute', timeToMinute(e.target.value))}/></label>
        <label>Criar tarefa para notas iguais ou abaixo<select value={String(config.createFollowupBelow ?? '')} onChange={(e) => changeConfig('createFollowupBelow', e.target.value)}><option value="">Não criar tarefa automaticamente</option>{Array.from({ length: 7 }, (_, score) => <option key={score} value={score}>{score} ou menos</option>)}</select></label>
        {String(config.createFollowupBelow ?? '') !== '' && <><label>Prazo para concluir a tarefa (horas)<input type="number" min="1" max="720" value={config.followupDueHours ?? 24} onChange={(e) => changeConfig('followupDueHours', e.target.value)}/></label><label>Responsável pela tarefa<select value={String(config.responsibleUserId ?? userId)} onChange={(e) => changeConfig('responsibleUserId', e.target.value)}>{assignees.map((person) => <option key={person.id} value={person.id}>{person.displayName} · {person.role}</option>)}</select></label></>}
        <button className="primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar configuração'}</button>
      </form></section></details>}
      </details>
    </>}
  </div>
}

function PanelTitle({ title, detail }: { title: string; detail: string }) { return <header className="reports-panel-title"><div><h2>{title}</h2><p>{detail}</p></div></header> }
function SimpleTable({ headers, rows, values }: { headers: string[]; rows: Row[]; values: (row: Row) => unknown[] }) { return rows.length ? <div className="reports-table-wrap"><table><thead><tr>{headers.map((x) => <th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{values(row).map((value, i) => <td key={i}>{String(value ?? '—')}</td>)}</tr>)}</tbody></table></div> : <p className="reports-empty">Sem dados neste período.</p> }
function Trend({ rows }: { rows: Array<{ day: string; count: number }> }) { const max = Math.max(1, ...rows.map((x) => x.count)); return rows.length ? <div className="reports-trend" aria-label="Gráfico de tendência">{rows.map((row) => <div key={row.day} title={`${row.day}: ${row.count}`}><span>{row.count}</span><i style={{ height: `${Math.max(4, row.count / max * 100)}%` }}/><small>{row.day.slice(5)}</small></div>)}</div> : <p className="reports-empty">Sem ocorrências para desenhar a tendência.</p> }
function NpsTrend({ rows }: { rows: Array<{ day: string; responses: number; nps: number }> }) { return rows.length ? <div className="reports-nps-trend" aria-label="NPS diário">{rows.map((row) => <div key={row.day} title={`${row.day}: NPS ${row.nps}, ${row.responses} respostas`}><b>{row.nps}</b><span>NPS</span><small>{row.day.slice(5)} · {row.responses} resp.</small></div>)}</div> : <p className="reports-empty">Sem respostas para desenhar a evolução do NPS.</p> }
function delta(current: number | undefined, prior: number | undefined) { if (current === undefined || prior === undefined) return null; const d = current - prior; return `${d > 0 ? '+' : ''}${d} vs período anterior (${prior})` }
function unavailableAware(value: number | null | undefined, reason?: string | null) { return value == null && reason ? 'Indisponível' : (value ?? 0).toLocaleString('pt-BR') }
function minuteToTime(value: unknown) { const minute = Math.max(0, Math.min(1439, Number(value) || 0)); return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` }
function timeToMinute(value: string) { const [hours, minutes] = value.split(':').map(Number); return Math.max(0, Math.min(1439, hours * 60 + minutes)) }

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Request = (path: string, init?: RequestInit) => Promise<any>
type TaskRow = Record<string, any> & { id: string; title: string }
const PRIORITY_LABEL: Record<string, string> = { LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' }
const STATUS_LABEL: Record<string, string> = { TODO: 'A fazer', IN_PROGRESS: 'Em andamento', DONE: 'Concluída', CANCELLED: 'Cancelada' }

export default function TasksPanel({ request, unitId, userId, role, refreshKey, setNotice, onOpenConversation, onOpenPatient, onOpenAppointment }: { request: Request; unitId: string; userId: string; role: string; refreshKey: number; setNotice: (message: string) => void; onOpenConversation: (id: string) => void; onOpenPatient: (id: string) => void; onOpenAppointment: (id: string) => void }) {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [assignees, setAssignees] = useState<{ id: string; displayName: string }[]>([])
  const [patients, setPatients] = useState<{ id: string; fullName: string }[]>([])
  const [conversations, setConversations] = useState<{ id: string; patient?: { fullName: string } }[]>([])
  const [status, setStatus] = useState('')
  const [history, setHistory] = useState<Record<string, any>[]>([])

  const load = useCallback(async () => {
    if (!unitId) return
    try {
      const [items, people, patientResult, inboxItems] = await Promise.all([
        request('/tasks?unitId=' + encodeURIComponent(unitId) + (status ? '&status=' + status : '')),
        request('/inbox/assignees?unitId=' + encodeURIComponent(unitId)),
        request('/patients?unitId=' + encodeURIComponent(unitId) + '&pageSize=100&status=ACTIVE'),
        request('/inbox/conversations?unitId=' + encodeURIComponent(unitId)),
      ])
      setTasks(items)
      setAssignees(people)
      setPatients(patientResult.items)
      setConversations(inboxItems)
    } catch (error) { setNotice((error as Error).message) }
  }, [request, unitId, status, setNotice])

  useEffect(() => { void load() }, [load, refreshKey])

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      await request('/tasks', { method: 'POST', body: JSON.stringify({ unitId, title: data.get('title'), description: data.get('description'), patientId: data.get('patientId') || null, conversationId: data.get('conversationId') || null, assignedToId: data.get('assignedToId') || userId, priority: data.get('priority'), dueAt: data.get('dueAt') ? new Date(String(data.get('dueAt'))).toISOString() : null }) })
      form.reset()
      setNotice('Tarefa criada e registrada no histórico.')
      await load()
    } catch (error) { setNotice((error as Error).message) }
  }

  async function changeStatus(id: string, nextStatus: string) {
    try { await request('/tasks/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }); setNotice('Status da tarefa atualizado.'); await load() }
    catch (error) { setNotice((error as Error).message) }
  }

  async function showHistory(id: string) {
    try { setHistory(await request('/tasks/' + id + '/history')) }
    catch (error) { setNotice((error as Error).message) }
  }

  return <div className="tasks-layout">
    <form className="module-form task-form" onSubmit={createTask}>
      <strong>Nova tarefa operacional</strong>
      <label className="task-field task-field-wide">Título<input required name="title" minLength={2} maxLength={160} placeholder="Ex.: retornar contato" /></label>
      <label className="task-field task-field-wide">Detalhes<textarea name="description" maxLength={2000} placeholder="Descreva o que a equipe precisa fazer" /></label>
      <label className="task-field">Paciente<select name="patientId" onChange={(event) => { if (!event.target.value) return; const peer = event.currentTarget.form?.elements.namedItem('conversationId'); if (peer instanceof HTMLSelectElement) peer.value = '' }}><option value="">Sem paciente vinculado</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}</option>)}</select></label>
      <label className="task-field">Conversa<select name="conversationId" onChange={(event) => { if (!event.target.value) return; const peer = event.currentTarget.form?.elements.namedItem('patientId'); if (peer instanceof HTMLSelectElement) peer.value = '' }}><option value="">Sem conversa vinculada</option>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.patient?.fullName ?? 'Conversa'} · {conversation.id.slice(0, 8)}</option>)}</select></label>
      <label className="task-field">Responsável<select name="assignedToId" defaultValue={userId} disabled={role === 'OPERATOR'}>{assignees.map((person) => <option key={person.id} value={person.id}>{person.displayName}{person.id === userId ? ' (você)' : ''}</option>)}</select></label>
      <label className="task-field">Prioridade<select name="priority" defaultValue="NORMAL"><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
      <label className="task-field">Prazo<input name="dueAt" type="datetime-local" /></label>
      <button className="primary">Criar tarefa</button>
    </form>
    <section className="task-list-panel"><div className="task-toolbar"><h2>Tarefas</h2><select aria-label="Filtrar status de tarefas" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todas</option><option value="TODO">A fazer</option><option value="IN_PROGRESS">Em andamento</option><option value="DONE">Concluídas</option><option value="CANCELLED">Canceladas</option></select></div>
      <div className="record-list">{tasks.map((task) => <article className="task-card" key={task.id}><b>{task.title}</b><span>{task.patient?.fullName ?? 'Sem paciente'} · {task.unit?.name} · Responsável: {task.assignee?.displayName}</span>{task.description && <p>{task.description}</p>}<small>{PRIORITY_LABEL[task.priority] ?? task.priority} · {task.dueAt ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(task.dueAt)) : 'Sem prazo'} · {STATUS_LABEL[task.status] ?? task.status}</small><div><select aria-label={'Status de ' + task.title} value={task.status} onChange={(event) => void changeStatus(task.id, event.target.value)}><option value="TODO">A fazer</option><option value="IN_PROGRESS">Em andamento</option><option value="DONE">Concluída</option><option value="CANCELLED">Cancelada</option></select><button type="button" className="small-action" onClick={() => void showHistory(task.id)}>Histórico</button></div><div className="task-context-links" aria-label="Abrir contexto relacionado">{task.conversation?.id && <button type="button" onClick={() => onOpenConversation(task.conversation.id)}>Abrir conversa</button>}{(task.patient?.id ?? task.conversation?.patientId) && <button type="button" onClick={() => onOpenPatient(String(task.patient?.id ?? task.conversation.patientId))}>Abrir paciente</button>}{task.appointment?.id && <button type="button" onClick={() => onOpenAppointment(task.appointment.id)}>Abrir agendamento · {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(task.appointment.startsAt))}</button>}</div></article>)}{tasks.length === 0 && <article><span>Nenhuma tarefa neste filtro.</span></article>}</div>
    </section>
    {history.length > 0 && <aside className="task-history"><h3>Histórico da tarefa</h3><button type="button" aria-label="Fechar histórico" onClick={() => setHistory([])}>Fechar</button>{history.map((event) => <article key={event.id}><b>{event.action}</b><small>{event.actor?.displayName} · {new Date(event.occurredAt).toLocaleString('pt-BR')}</small></article>)}</aside>}
  </div>
}

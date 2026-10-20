import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Patient = { id: string; fullName: string; phone?: string | null; email?: string | null; active: boolean; unit?: { name: string } | null; appointments: { id: string; startsAt: string; status: string; procedure?: { name: string } | null; unit?: { name: string } | null }[]; conversations: { id: string; status: string; lastMessageAt: string }[] }
export default function InboxPatientSummary({ request, patientId, conversationId, unitId, onOpenPatient, onOpenCalendar, onOpenAppointment, onTaskCreated }: { request: (path: string, init?: RequestInit) => Promise<any>; patientId: string; conversationId: string; unitId: string; onOpenPatient: (id: string) => void; onOpenCalendar: (patientId: string) => void; onOpenAppointment: (id: string) => void; onTaskCreated: () => void }) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [error, setError] = useState('')
  const [taskOpen, setTaskOpen] = useState(false)
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskError, setTaskError] = useState('')
  useEffect(() => {
    let active = true
    setPatient(null); setError('')
    request(`/patients/${encodeURIComponent(patientId)}`).then((row) => { if (active) setPatient(row) }).catch((cause: Error) => { if (active) setError(cause.message || 'Não foi possível carregar o perfil.') })
    return () => { active = false }
  }, [patientId, request])
  if (error) return <aside className="inbox-patient-summary" aria-label="Resumo do paciente"><h3>Paciente</h3><p role="alert">{error}</p></aside>
  if (!patient) return <aside className="inbox-patient-summary" aria-label="Resumo do paciente"><h3>Paciente</h3><p role="status">Carregando perfil…</p></aside>
  const now = Date.now()
  const upcoming = patient.appointments.filter((item) => new Date(item.startsAt).getTime() >= now && ['PENDING', 'CONFIRMED'].includes(item.status)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
  const lastCompleted = patient.appointments.find((item) => item.status === 'COMPLETED')
  const dt = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setTaskBusy(true); setTaskError('')
    try {
      await request('/tasks', { method: 'POST', body: JSON.stringify({ unitId, conversationId, title: form.get('title'), description: form.get('description') }) })
      setTaskOpen(false); onTaskCreated()
    } catch (cause) { setTaskError(cause instanceof Error ? cause.message : 'Não foi possível criar a tarefa.') }
    finally { setTaskBusy(false) }
  }
  return <aside className="inbox-patient-summary" aria-label="Resumo do paciente">
    <div className="inbox-patient-heading"><span aria-hidden="true">{patient.fullName.slice(0, 1).toUpperCase()}</span><div><small className="inbox-section-label">Resumo do paciente</small><h3>{patient.fullName}</h3><small>{patient.active ? 'Cadastro ativo' : 'Cadastro arquivado'}</small></div></div>
    <dl><dt>Telefone</dt><dd>{patient.phone || 'Não informado'}</dd><dt>E-mail</dt><dd>{patient.email || 'Não informado'}</dd><dt>Unidade preferencial</dt><dd>{patient.unit?.name || 'Não definida'}</dd></dl>
    <section><h4>Próximo atendimento</h4>{upcoming ? <><p><b>{dt(upcoming.startsAt)}</b><br/>{upcoming.procedure?.name ?? 'Atendimento'} · {upcoming.status === 'CONFIRMED' ? 'Confirmado' : 'A confirmar'}</p><button type="button" className="inbox-summary-link" onClick={() => onOpenAppointment(upcoming.id)}>Abrir / reagendar atendimento</button></> : <><p>Nenhum atendimento futuro agendado.</p><button type="button" className="inbox-summary-link inbox-summary-primary" onClick={() => onOpenCalendar(patient.id)}>Agendar para este paciente</button></>}</section>
    <section><h4>Último atendimento concluído</h4>{lastCompleted ? <p>{lastCompleted.procedure?.name ?? 'Atendimento'}<br/><small>{dt(lastCompleted.startsAt)}</small></p> : <p>Nenhum atendimento concluído registrado.</p>}</section>
    <section><h4>Tarefas da conversa</h4><button type="button" className="inbox-summary-link" onClick={() => setTaskOpen((open) => !open)}>{taskOpen ? 'Fechar criação de tarefa' : 'Criar tarefa para a equipe'}</button>{taskOpen && <form className="inbox-task-form" onSubmit={(event) => void createTask(event)}><label>Título<input name="title" required minLength={2} maxLength={160} placeholder="Ex.: Retornar pedido de reagendamento"/></label><label>Contexto<textarea name="description" maxLength={2000} placeholder="Resumo operacional para a equipe"/></label>{taskError && <p role="alert">{taskError}</p>}<button type="submit" disabled={taskBusy}>{taskBusy ? 'Salvando…' : 'Salvar tarefa'}</button></form>}</section>
    <button type="button" className="inbox-summary-profile" onClick={() => onOpenPatient(patient.id)}>Abrir perfil completo</button>
  </aside>
}

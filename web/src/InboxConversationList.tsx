import type { FormEvent } from 'react'

type Row = Record<string, any> & { id: string }
type Props = {
  rows: Row[]
  patients: Row[]
  selectedId?: string
  userId: string
  query: string
  filter: string
  onQueryChange: (value: string) => void
  onFilterChange: (value: string) => void
  onSelect: (row: Row) => void
  onCreate: (event: FormEvent<HTMLFormElement>) => void
}

const conversationStatusLabel: Record<string, string> = {
  OPEN: 'Em andamento',
  WAITING_HUMAN: 'Aguardando equipe',
  CLOSED: 'Encerrada',
}

export default function InboxConversationList({ rows, patients, selectedId, userId, query, filter, onQueryChange, onFilterChange, onSelect, onCreate }: Props) {
  const queryText = query.trim().toLocaleLowerCase('pt-BR')
  const visibleRows = rows.filter((row) => {
    const patientName = String(row.patient?.fullName ?? '')
    const preview = String(row.messages?.[0]?.body ?? '')
    const queryMatches = !queryText || `${patientName} ${preview}`.toLocaleLowerCase('pt-BR').includes(queryText)
    const filterMatches = filter === 'ALL' || (filter === 'QUEUE' ? !row.assignedToId : filter === 'MINE' ? row.assignedToId === userId : row.status === filter)
    return queryMatches && filterMatches
  })

  return <section className="record-list inbox-conversation-list" aria-labelledby="inbox-conversation-heading">
    <header className="inbox-list-heading"><div><h2 id="inbox-conversation-heading">Conversas</h2><span>{visibleRows.length} de {rows.length}</span></div><details className="inbox-create"><summary>Iniciar conversa</summary><form className="module-form stacked" onSubmit={onCreate}>
      <label htmlFor="inbox-new-patient">Paciente</label><select id="inbox-new-patient" required name="patientId" aria-label="Paciente para nova conversa">
        <option value="">Selecione um paciente</option>
        {patients.map((patient) => <option key={patient.id} value={patient.id}>{String(patient.fullName)}</option>)}
      </select>
      <button className="primary">Abrir atendimento</button>
    </form></details></header>
    <div className="inbox-list-filters">
      <label>Buscar conversas<input aria-label="Buscar conversas" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Paciente ou mensagem"/></label>
      <label>Mostrar<select aria-label="Mostrar conversas" value={filter} onChange={(event) => onFilterChange(event.target.value)}>
        <option value="ALL">Todas</option><option value="QUEUE">Sem responsável</option><option value="MINE">Atribuídas a mim</option>
        <option value="WAITING_HUMAN">Aguardando a equipe</option><option value="OPEN">Em andamento</option><option value="CLOSED">Encerradas</option>
      </select></label>
    </div>
    {visibleRows.map((row) => <button type="button" aria-current={selectedId === row.id ? 'true' : undefined} className={`conversation-row ${selectedId === row.id ? 'selected' : ''}`} key={row.id} onClick={() => onSelect(row)}>
      <b>{String(row.patient?.fullName ?? 'Paciente')}</b>
      <small>{conversationStatusLabel[String(row.status)] ?? 'Status não identificado'}{row.humanResponseDueAt ? ` · prazo ${new Date(String(row.humanResponseDueAt)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</small>
      <small>Responsável: {String(row.assignedTo?.displayName ?? 'Fila compartilhada')}</small>
      <span>{String(row.messages?.[0]?.body ?? 'Sem mensagens recentes')}</span>
    </button>)}
    {!visibleRows.length && <p className="empty-state">Nenhuma conversa corresponde à busca e aos filtros.</p>}
  </section>
}

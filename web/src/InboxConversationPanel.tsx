import { useEffect, useRef, useState, type ReactNode } from 'react'
import { statusLabel } from './status-labels.js'

type Row = Record<string, unknown> & { id: string }
type SideTool = 'quick' | 'ai' | 'patient'

const dateTime = (value: unknown) => value
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(value)))
  : ''

export default function InboxConversationPanel({ selected, messages, drafts, draftPurposes, composerBody, setComposerBody, setDraftPurpose, quickReplies, patientSummary, loading, error, aiDraftError, onGenerateDraft, onReviewDraft, onSendDraft }: {
  selected: Row | null
  messages: Row[]
  drafts: Row[]
  draftPurposes: Record<string, string>
  composerBody: string
  setComposerBody: (value: string) => void
  setDraftPurpose: (id: string, purpose: string) => void
  quickReplies: ReactNode
  patientSummary: ReactNode
  loading: boolean
  error: string
  aiDraftError: string
  onGenerateDraft: () => void
  onReviewDraft: (id: string, approved: boolean, purpose?: string) => void
  onSendDraft: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const [activeTool, setActiveTool] = useState<SideTool | null>(null)
  const [replyPurpose, setReplyPurpose] = useState('SERVICE_REPLY')
  const messageListRef = useRef<HTMLDivElement>(null)
  const hasPatientMessage = messages.some((message) => message.direction === 'INBOUND' && message.actor === 'PATIENT')
  const sidePanelOpen = Boolean(selected && activeTool && (activeTool !== 'patient' || patientSummary))
  const toggleTool = (tool: SideTool) => setActiveTool((current) => current === tool ? null : tool)
  useEffect(() => setReplyPurpose('SERVICE_REPLY'), [selected?.id])
  useEffect(() => {
    const list = messageListRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [selected?.id, messages.length])

  return <section className={`chat-panel${sidePanelOpen ? ' has-side-panel' : ''}`} aria-label="Atendimento da conversa">
    {!selected && !loading && !error && <div className="inbox-selection-empty">
      <h2>Abra uma conversa para começar</h2>
      <p>Escolha um paciente na lista para ler as mensagens e responder neste painel.</p>
    </div>}
    {loading && <p className="inbox-panel-state" role="status">Carregando conversa…</p>}
    {error && <p className="inbox-panel-error" role="alert">{error}</p>}
    {selected && <>
      <header className="inbox-chat-header"><div><span className="inbox-section-label">Atendimento</span><h2>{String((selected.patient as Record<string, unknown> | undefined)?.fullName ?? 'Conversa')}</h2><span>{statusLabel(selected.status)}{selected.assignedTo && typeof selected.assignedTo === 'object' ? ` · ${String((selected.assignedTo as Record<string, unknown>).displayName ?? '')}` : ''}</span></div></header>

      <section className="inbox-message-history" aria-label="Histórico de mensagens">
        <div className="inbox-history-heading"><h3>Histórico</h3><div className="inbox-history-tools" role="group" aria-label="Ferramentas do atendimento">
          <button type="button" aria-pressed={activeTool === 'quick'} onClick={() => toggleTool('quick')}>Usar resposta rápida</button>
          <button type="button" aria-pressed={activeTool === 'ai'} onClick={() => toggleTool('ai')}>Ajuda da IA (opcional)</button>
          {patientSummary && <button type="button" aria-pressed={activeTool === 'patient'} onClick={() => toggleTool('patient')}>Resumo do paciente</button>}
        </div></div>
        <div className="inbox-message-list" aria-live="polite" ref={messageListRef}>
          {messages.map((message) => {
            const status = String(message.status ?? '')
            const simulated = status === 'SIMULATED'
            const queued = status === 'QUEUED' || status === 'PENDING'
            const messageStatusLabel = simulated ? 'Simulada · não entregue' : queued ? 'Na fila · não enviada' : status === 'RECEIVED' ? 'Recebida' : status === 'DELIVERED' ? 'Entregue' : status === 'READ' ? 'Lida' : statusLabel(status)
            const approver = message.approvedBy as Record<string, unknown> | null
            const outgoing = message.direction === 'OUTBOUND'
            return <article className={outgoing ? 'inbox-message is-outgoing' : 'inbox-message is-incoming'} key={message.id}>
              <b className="inbox-message-sender">{outgoing ? 'Equipe' : 'Paciente'}</b>
              <p>{String(message.body)}</p>
              <footer className="inbox-message-meta"><small>{messageStatusLabel}{Boolean(approver?.displayName) && ` · aprovada por ${String(approver?.displayName)}`}</small><time dateTime={String(message.createdAt ?? '')}>{dateTime(message.createdAt)}</time></footer>
            </article>
          })}
          {!loading && messages.length === 0 && <p className="inbox-panel-state">Ainda não há mensagens nesta conversa. Escreva abaixo para iniciar o atendimento.</p>}
        </div>
      </section>

      <form className="inbox-reply-form" onSubmit={onSendDraft}>
        <label htmlFor="human-message-body">Escreva sua resposta</label>
        <textarea id="human-message-body" required name="body" maxLength={4000} aria-describedby="human-message-validation" value={composerBody} onChange={(event) => { setComposerBody(event.target.value); event.currentTarget.setCustomValidity('') }} onInvalid={(event) => { event.preventDefault(); event.currentTarget.setCustomValidity('Escreva uma resposta antes de registrar na fila.'); event.currentTarget.reportValidity() }} onInput={(event) => event.currentTarget.setCustomValidity('')} placeholder="Digite a resposta para o paciente"/>
        <div className="inbox-reply-footer"><div className="inbox-reply-channel"><span>Canal</span><strong>WhatsApp</strong></div><label>Tipo de mensagem<select name="purpose" required value={replyPurpose} onChange={(event) => setReplyPurpose(event.target.value)}><option value="SERVICE_REPLY">Resposta ao paciente</option><option value="MARKETING">Marketing e divulgação</option><option value="POST_CARE">Pós-atendimento</option><option value="APPOINTMENT_REMINDER">Lembrete de agendamento</option></select></label><button className="primary">Registrar resposta</button></div>
        <small id="human-message-validation">{replyPurpose === 'SERVICE_REPLY' ? hasPatientMessage ? 'Resposta a uma mensagem recebida nesta conversa.' : 'Resposta ao paciente exige uma mensagem recebida nesta conversa. Para iniciar contato, escolha outra finalidade.' : 'Esta finalidade exige consentimento de WhatsApp registrado para o paciente.'} Registro local: nenhuma mensagem é enviada pelo WhatsApp.</small>
      </form>
      {sidePanelOpen && <aside className="inbox-side-panel" aria-label="Ferramentas do atendimento">
        {activeTool === 'quick' && <section className="inbox-side-section"><header><h3>Resposta rápida</h3><button type="button" aria-label="Fechar respostas rápidas" onClick={() => setActiveTool(null)}>Fechar</button></header>{quickReplies}</section>}
        {activeTool === 'ai' && <section className="inbox-side-section"><header><h3>Ajuda da IA</h3><button type="button" aria-label="Fechar ajuda da IA" onClick={() => setActiveTool(null)}>Fechar</button></header><p>A IA prepara um rascunho para revisão. Ela não envia mensagens.</p><button className="small-action" type="button" onClick={onGenerateDraft}>Gerar rascunho</button>{aiDraftError && <p role="alert">{aiDraftError}</p>}
          {drafts.map((draft) => <article className="inbox-ai-draft" key={draft.id}><b>Rascunho · {statusLabel(draft.status)}</b><p>{String(draft.body)}</p>{draft.status === 'PENDING' && <div className="inbox-ai-review"><label>Tipo de mensagem<select aria-label="Tipo de mensagem do rascunho" value={draftPurposes[draft.id] ?? ''} onChange={(event) => setDraftPurpose(draft.id, event.target.value)}><option value="">Selecione</option><option value="SERVICE_REPLY">Resposta ao paciente</option><option value="MARKETING">Marketing e divulgação</option><option value="POST_CARE">Pós-atendimento</option><option value="APPOINTMENT_REMINDER">Lembrete de agendamento</option></select></label><button type="button" disabled={!draftPurposes[draft.id]} onClick={() => onReviewDraft(draft.id, true, draftPurposes[draft.id])}>Aprovar para a fila</button><button type="button" onClick={() => onReviewDraft(draft.id, false)}>Rejeitar</button></div>}</article>)}
        </section>}
        {activeTool === 'patient' && patientSummary && <section className="inbox-side-section inbox-patient-details"><header><h3>Resumo do paciente</h3><button type="button" aria-label="Fechar resumo do paciente" onClick={() => setActiveTool(null)}>Fechar</button></header>{patientSummary}</section>}
      </aside>}
    </>}
  </section>
}

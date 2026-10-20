import { useState } from 'react'
import './InboxKanban.css'

type Row = Record<string, any> & { id: string }
type Campaign = { id: string; name: string; body: string; mode: string; status: string }
type Stage = { id: string; name: string; position: number; active: boolean; campaignId: string | null; inactivityDays: number | null; campaign: { id: string; name: string; body: string; provider: string } | null }
type Assignee = { id: string; displayName: string; role: string }
type StageInput = { name: string; position: number; campaignId: string | null; inactivityDays: number | null }

const statusColumns = [
  { id: 'OPEN', name: 'Aberta' },
  { id: 'WAITING_HUMAN', name: 'Aguardando equipe' },
  { id: 'CLOSED', name: 'Encerrada' },
]

export default function ConversationKanban({ rows, stages, campaigns, assignees, userId, isAdmin, assigneeFilter, onAssigneeFilter, onSelect, onMove, onMoveStage, onClaim, onAssign, onCreateStage, onUpdateStage, onOpenCampaigns }: {
  rows: Row[]; stages: Stage[]; campaigns: Campaign[]; assignees: Assignee[]; userId: string; isAdmin: boolean; assigneeFilter: string
  onAssigneeFilter: (value: string) => void; onSelect: (row: Row) => void; onMove: (id: string, status: string) => void
  onMoveStage: (id: string, stageId: string, enrollCampaign?: boolean) => void; onClaim: (id: string) => void; onAssign: (id: string, assigneeId: string | null) => void
  onCreateStage: (data: StageInput) => void; onUpdateStage: (id: string, patch: Record<string, unknown>) => void; onOpenCampaigns: () => void
}) {
  const [view, setView] = useState<'STATUS' | 'PIPELINE'>('STATUS')
  const [configOpen, setConfigOpen] = useState(false)
  const [pendingMove, setPendingMove] = useState<{ row: Row; stage: Stage } | null>(null)
  const [newStage, setNewStage] = useState('')
  const [newCampaignId, setNewCampaignId] = useState('')
  const [newDays, setNewDays] = useState(0)
  const [compact, setCompact] = useState(false)
  const [dragTarget, setDragTarget] = useState<string | null>(null)
  const availableCampaigns = campaigns.filter((campaign) => campaign.mode === 'STAGE' && campaign.status === 'APPROVED')
  const columns = view === 'STATUS' ? statusColumns : stages
  const columnFor = (row: Row) => view === 'STATUS' ? String(row.status) : String(row.pipelineStageId ?? stages[0]?.id ?? '')

  function move(row: Row, targetId: string) {
    if (columnFor(row) === targetId) return
    if (view === 'STATUS') { onMove(row.id, targetId); return }
    const stage = stages.find((item) => item.id === targetId)
    if (!stage) return
    if (stage.campaignId) { setPendingMove({ row, stage }); return }
    onMoveStage(row.id, targetId)
  }

  function openStageEditor() { setView('PIPELINE'); setConfigOpen(true) }

  return <div className="conversation-kanban-wrap">
    <div className="kanban-toolbar">
      <div className="inbox-toolbar" role="group" aria-label="Organização do quadro">
        <button type="button" className={view === 'STATUS' ? 'active' : ''} aria-pressed={view === 'STATUS'} onClick={() => setView('STATUS')}>Estado da conversa</button>
        <button type="button" className={view === 'PIPELINE' ? 'active' : ''} aria-pressed={view === 'PIPELINE'} onClick={() => setView('PIPELINE')}>Etapas do funil</button>
      </div>
      <div className="kanban-toolbar-actions">
        <label>Responsável<select value={assigneeFilter} onChange={(event) => onAssigneeFilter(event.target.value)}><option value="">Todas as conversas</option><option value="QUEUE">Fila compartilhada</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
        <button type="button" className={'kanban-density-button' + (compact ? ' active' : '')} onClick={() => setCompact((value) => !value)}>{compact ? 'Ver mais detalhes' : 'Compactar cartões'}</button>
        {isAdmin && <button type="button" className="kanban-settings-button" onClick={openStageEditor}>+ Criar etapa</button>}
      </div>
    </div>
    <p className="kanban-help">{view === 'STATUS' ? 'Acompanhe o estado das conversas. Para criar uma coluna e vincular uma campanha, use Etapas do funil.' : 'Arraste o cartão de um paciente para outra etapa ou use o seletor. Uma etapa com campanha sempre pede confirmação antes de incluir o paciente.'}</p>
    <div className={'conversation-kanban' + (compact ? ' is-compact' : '')} key={view}>
      {columns.map((column) => {
        const stage = view === 'PIPELINE' ? stages.find((item) => item.id === column.id) : null
        const columnRows = rows.filter((row) => columnFor(row) === column.id)
        return <section className={'kanban-column' + (dragTarget === column.id ? ' is-drop-target' : '')} key={column.id} onDragOver={(event) => { event.preventDefault(); setDragTarget(column.id) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragTarget(null) }} onDrop={(event) => { event.preventDefault(); setDragTarget(null); const row = rows.find((item) => item.id === event.dataTransfer.getData('text/plain')); if (row) move(row, column.id) }}>
            <div className="kanban-column-header"><div><b>{column.name}</b>{stage?.campaign && <small>{stage.campaign.name} · {stage.inactivityDays === 0 ? 'ao entrar na etapa' : `${stage.inactivityDays} ${stage.inactivityDays === 1 ? 'dia' : 'dias'} sem resposta`}</small>}</div><span aria-label={`${columnRows.length} conversas`}>{columnRows.length}</span></div>
          {columnRows.map((row) => {
            const patientName = String(row.patient?.fullName ?? 'Paciente sem identificação')
            const latestMessage = row.messages?.[0]?.body ? String(row.messages[0].body) : 'Sem mensagens recentes'
            const unread = Number(row.unreadCount ?? row.unreadMessages ?? 0)
            const lastActivity = row.lastMessageAt ? new Date(String(row.lastMessageAt)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
            const enrollment = row.stageCampaignEnrollments?.[0]
            const enrolledHere = stage?.campaignId && enrollment?.stageId === stage.id && !['CANCELLED', 'SUPPRESSED', 'FAILED'].includes(String(enrollment.status))
            return <article className={'conversation-card' + (compact ? ' is-compact' : '')} draggable key={row.id} onDragStart={(event) => { event.dataTransfer.setData('text/plain', row.id); event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDragTarget(null)}>
              <button type="button" className="card-open" aria-label={`Abrir conversa de ${patientName}`} onClick={() => onSelect(row)}>
                <span className="conversation-card-person"><span className="conversation-avatar" aria-hidden="true">{patientName.slice(0, 1).toLocaleUpperCase('pt-BR')}</span><span className="conversation-card-identity"><strong>{patientName}</strong><small>{String(row.patient?.phone ?? 'Telefone não informado')}</small></span>{unread > 0 && <span className="conversation-unread" aria-label={`${unread} mensagens não lidas`}>{unread}</span>}</span>
                <span className="conversation-card-meta"><span>{String(row.unit?.name ?? 'Unidade não identificada')}</span>{lastActivity && <time>{lastActivity}</time>}</span>
                <span className="conversation-card-preview" title={latestMessage}>{latestMessage}</span>
                <span className="conversation-card-badges"><span className={`conversation-status status-${String(row.status).toLowerCase()}`}>{statusColumns.find((item) => item.id === row.status)?.name ?? String(row.status)}</span>{enrolledHere && <span className="conversation-campaign-badge" title={String(enrollment.reason ?? '')}>{enrollment.status === 'PENDING' ? `Acompanhar ${new Date(String(enrollment.dueAt)).toLocaleDateString('pt-BR')}` : enrollment.status === 'SIMULATED' ? 'Mensagem simulada' : 'Na fila da campanha'}</span>}{row.humanResponseDueAt && <span className="conversation-sla">Prazo {new Date(String(row.humanResponseDueAt)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}</span>
              </button>
              <div className="conversation-card-assignee"><span className="assignee-avatar" aria-hidden="true">{String(row.assignedTo?.displayName ?? 'Fila').slice(0, 1).toLocaleUpperCase('pt-BR')}</span><span>Responsável: <strong>{String(row.assignedTo?.displayName ?? 'Fila compartilhada')}{row.assignedToId === userId ? ' (você)' : ''}</strong></span>{!row.assignedToId && <button type="button" onClick={() => onClaim(row.id)}>Assumir</button>}</div>
              <div className="conversation-card-controls"><label>Responsável<select aria-label={`Responsável de ${patientName}`} value={String(row.assignedToId ?? '')} onChange={(event) => onAssign(row.id, event.target.value || null)}><option value="">Fila compartilhada</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label><label>{view === 'STATUS' ? 'Estado' : 'Etapa'}<select aria-label={`Mover ${patientName}`} value={columnFor(row)} onChange={(event) => move(row, event.target.value)}>{columns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
            </article>
          })}
          {columnRows.length === 0 && <p className="kanban-empty-column">Nenhum atendimento nesta {view === 'STATUS' ? 'situação' : 'etapa'}.</p>}
        </section>
      })}
    </div>

    {pendingMove && <div className="stage-config-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingMove(null) }}><section className="stage-campaign-dialog" role="dialog" aria-modal="true" aria-labelledby="stage-campaign-title"><h3 id="stage-campaign-title">Incluir {String(pendingMove.row.patient?.fullName ?? 'paciente')} na campanha?</h3><p>O cartão será movido para <strong>{pendingMove.stage.name}</strong>. A campanha <strong>{pendingMove.stage.campaign?.name}</strong> prepara esta mensagem {pendingMove.stage.inactivityDays === 0 ? 'ao entrar na etapa' : `após ${pendingMove.stage.inactivityDays} ${pendingMove.stage.inactivityDays === 1 ? 'dia' : 'dias'} sem resposta do paciente`}:</p><blockquote>{pendingMove.stage.campaign?.body}</blockquote><small>Canal: {pendingMove.stage.campaign?.provider === 'EVOLUTION_BAILEYS' ? 'Evolution / Baileys (não oficial)' : 'Meta Cloud'}. Antes de entrar na fila, o sistema confere resposta do paciente, conversa em andamento, outras mensagens no dia, consentimento e canal. O envio externo está desativado neste ambiente.</small><div className="stage-dialog-actions"><button type="button" onClick={() => setPendingMove(null)}>Cancelar</button><button type="button" onClick={() => { onMoveStage(pendingMove.row.id, pendingMove.stage.id, false); setPendingMove(null) }}>Mover sem campanha</button><button type="button" className="primary" onClick={() => { onMoveStage(pendingMove.row.id, pendingMove.stage.id, true); setPendingMove(null) }}>Mover e incluir na campanha</button></div></section></div>}

    {configOpen && <div className="stage-config-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfigOpen(false) }}><section className="stage-config-dialog kanban-stage-editor" role="dialog" aria-modal="true" aria-labelledby="stage-config-title"><header><div><h3 id="stage-config-title">Etapas do funil</h3><p>Crie uma coluna para organizar pacientes e, se quiser, vincule uma campanha de acompanhamento.</p></div><button type="button" aria-label="Fechar configuração" onClick={() => setConfigOpen(false)}>×</button></header>
      <form className="stage-new-form" onSubmit={(event) => { event.preventDefault(); if (newStage.trim().length < 2) return; onCreateStage({ name: newStage.trim(), position: stages.length, campaignId: newCampaignId || null, inactivityDays: newCampaignId ? newDays : null }); setNewStage(''); setNewCampaignId(''); setNewDays(0) }}><h4>Criar etapa</h4><label>Nome da coluna<input required minLength={2} maxLength={60} placeholder="Ex.: Aguardando retorno" value={newStage} onChange={(event) => setNewStage(event.target.value)}/></label><label>Campanha vinculada<select value={newCampaignId} onChange={(event) => setNewCampaignId(event.target.value)}><option value="">Sem campanha</option>{availableCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>{newCampaignId && <label>Iniciar após quantos dias sem resposta? (0 = ao entrar)<input type="number" min="0" max="90" required value={newDays} onChange={(event) => setNewDays(Number(event.target.value))}/></label>}<button type="submit" className="primary" disabled={newStage.trim().length < 2 || Boolean(newCampaignId) && (!Number.isInteger(newDays) || newDays < 0 || newDays > 90)}>Criar etapa</button><p className="stage-form-help">O vínculo da campanha não inclui automaticamente os pacientes. Cada movimentação pede confirmação.</p>{availableCampaigns.length === 0 && <p className="stage-form-help">Para vincular uma campanha, crie uma campanha do tipo “Mensagem individual do funil” em Campanhas. <button type="button" className="stage-text-button" onClick={() => { setConfigOpen(false); onOpenCampaigns() }}>Abrir Campanhas</button></p>}</form>
      <div className="stage-config-list"><h4>Etapas existentes</h4>{stages.map((stage) => <form className="stage-config-row" key={stage.id} onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); const campaignId = String(values.get('campaignId') ?? ''); onUpdateStage(stage.id, { name: values.get('name'), position: Number(values.get('position')), campaignId: campaignId || null, ...(campaignId ? { inactivityDays: Number(values.get('inactivityDays')) } : {}) }) }}><label>Nome<input name="name" defaultValue={stage.name} required minLength={2} maxLength={60}/></label><label>Ordem<input name="position" type="number" min="0" max="100" defaultValue={stage.position}/></label><label>Campanha<select name="campaignId" defaultValue={stage.campaignId ?? ''}><option value="">Sem campanha</option>{availableCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Dias sem resposta (0 = ao entrar)<input name="inactivityDays" type="number" min="0" max="90" defaultValue={stage.inactivityDays ?? 0}/></label><div className="stage-row-actions"><button type="submit">Salvar</button><button type="button" className="stage-disable-button" onClick={() => onUpdateStage(stage.id, { active: false })}>Desativar</button></div></form>)}{stages.length === 0 && <p>Nenhuma etapa configurada.</p>}</div>
      <footer><button type="button" onClick={() => setConfigOpen(false)}>Concluir</button></footer>
    </section></div>}
  </div>
}

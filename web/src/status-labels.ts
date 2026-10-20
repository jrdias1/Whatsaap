const labels: Record<string, string> = {
  ACTIVE: 'Ativo', PAUSED: 'Pausado', DRAFT: 'Rascunho', TRIAL: 'Em avaliação',
  OPEN: 'Aberta', CLOSED: 'Encerrada', WAITING_HUMAN: 'Aguardando equipe',
  PENDING: 'Pendente', CONFIRMED: 'Confirmado', COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado', NO_SHOW: 'Falta registrada', FAILED: 'Falhou',
  SUPPRESSED: 'Suprimida', SIMULATED: 'Simulada (não entregue)', OUTBOXED: 'Na fila (sem envio externo)',
  META_CLOUD: 'Meta Cloud', EVOLUTION_BAILEYS: 'Evolution API',
  RESPONDED: 'Resposta recebida', TODO: 'A fazer', IN_PROGRESS: 'Em andamento', DONE: 'Concluída',
  APPROVED: 'Aprovada', REJECTED: 'Recusada', ENDED: 'Encerrada',
}

export function statusLabel(value: unknown) {
  const key = String(value ?? '')
  return labels[key] ?? key.replaceAll('_', ' ').toLocaleLowerCase('pt-BR')
}

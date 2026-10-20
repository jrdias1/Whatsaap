# Fase 9 - relatórios gerenciais, NPS interno e follow-up

**Estado local:** implementado e validado no escopo abaixo; nao habilita contato externo. Resultados efetivos no fim deste documento.

## Inventario e fontes

- Agendamentos fornecem unidade, inicio/fim, procedimento, profissional/recurso, status, criacao e `completedAt`; `AuditEvent` registra transicoes e reagendamentos. Relatorios contam transicoes por evento e nao repetem o status atual como se fosse cada acao.
- `Patient.unitId` e unidade preferencial, nao unidade do atendimento. Relatorios rotulam esse campo como preferencial e usam `Appointment.unitId` para metricas do atendimento.
- Inbox usa `Conversation`, `Message` e `Task`. Respostas humanas so contam com ator/origem humanos e estado `SENT`, `DELIVERED` ou `READ`; rascunho de IA nao e resposta. A media so aparece se o pareamento inbound/resposta for calculavel.
- Automacoes usam `AutomationExecution` e a outbox existente. A outbox nao possui `unitId`; para gerente ou filtro de unidade seus estados ficam indisponiveis, sem atribuicao pela unidade preferencial do paciente. `SIMULATED` nunca e entrega.
- Indicacoes usam eventos distintos de clique, lead, qualificacao e conversao; conversao nao e faturamento. Emissao/uso/expiracao de voucher usam os eventos e datas proprios.
- `SatisfactionSurvey` de cinco opcoes continua separado do novo NPS de 0 a 10.

## Relatorios e exportacao

`GET /api/reports/overview` agrega no PostgreSQL e limita o intervalo a 366 dias. `GET /api/reports/export.csv` aplica o mesmo escopo e registra `REPORT_EXPORTED`; exporta apenas metricas agregadas, em UTF-8 com BOM, protege valores iniciados como formulas e limita o resultado a 1.000 linhas. Administrador ve o tenant; gerente ve somente unidades atribuidas; operador e Superadmin nao usam este relatorio clinico.

Semantica de datas exibida na interface e API:

- Criados: `createdAt`; tendencia de agenda e distribuicao por procedimento/profissional: `startsAt` e exclui cancelados.
- Confirmados/cancelados/faltas/reagendamentos: eventos auditados em `occurredAt`; conclusao: `completedAt`. Estado atual por data do atendimento fica separado.
- Pacientes novos: `createdAt`; ativos: fotografia atual; arquivados/inativos atualizados: `updatedAt`, explicitamente aproximado porque nao ha timestamp proprio de arquivamento.
- Conversas/tarefas/mensagens: criacao no periodo; tarefas vencidas, conversas em fila/atribuidas e follow-ups pendentes sao estados atuais.
- NPS: somente resposta `STAFF_RECORDED`, com nota 0-10 e `respondedAt` no periodo. NPS e `% notas 9-10 - % notas 0-6`, arredondado ao inteiro; 7-8 sao passivos. A API inclui quantidade, distribuicao e serie diaria de pontuacao. Nao calcula taxa de resposta.

## NPS interno e acompanhamento

### Explicação de uso para a clínica

Na interface, “NPS da clínica” significa um indicador interno calculado a partir das notas de 0 a 10 que a equipe registra após ouvir o paciente. “Privado” descrevia que o registro é interno, mas o termo foi retirado da tela por ser ambíguo. O NPS não é enviado pelo sistema: a tela de Relatórios mostra a pergunta configurada, e a equipe conversa com o paciente e registra a nota recebida. A pesquisa de satisfação com cinco opções continua sendo outro recurso.

Em Configuração, a clínica escolhe se o sistema deve preparar um registro pendente após um atendimento nativo concluído, para quais unidades e procedimentos, após quantas horas e em quais horários a equipe poderá coletar a nota. Também pode definir a pergunta, permitir comentário, evitar nova pesquisa por um intervalo e criar uma tarefa para notas baixas. O sistema só planeja o registro quando o paciente está ativo e há consentimento válido para pesquisa de satisfação; não cria mensagem na fila nem envia WhatsApp. A configuração nasce desativada.

A migration `20261019150000_phase9_reports_nps_followup` adiciona `NpsSettings` e `NpsSurvey`, com escopo de tenant/unidade, unicidade por agendamento, indices de consulta e constraint de nota 0-10. A configuracao nasce desligada. Ao concluir agendamento `NATIVE`, o sistema planeja registro interno na mesma transacao somente se NPS estiver habilitado, paciente ativo, procedimento/unidade elegiveis e houver preferencia `GRANTED` para `WHATSAPP/SATISFACTION_SURVEY`. O horario segue atraso configurado e janela local `America/Sao_Paulo`; a politica de repeticao verifica respostas anteriores.

Neste incremento nao existe emissor NPS nem resposta recebida por webhook: nenhuma mensagem entra em outbox e nenhum canal e chamado. Uma pessoa autorizada registra a resposta que recebeu por um meio privado; o sistema exige a pesquisa ja programada, bloqueia duplicidade sob lock, audita ator/origem e so entao calcula o NPS. A execucao futura pelo motor BullMQ/outbox e qualquer homologacao de canal permanecem pendentes; os registros `PLANNED` nao significam envio.

Notas baixas so geram tarefa humana se o administrador ativar um limiar 0-6 e designar responsavel. A tarefa usa `Task`/`TaskHistory`, fica vinculada ao paciente/agendamento e aparece na central ja existente e no dashboard. A resposta e serializada por linha e o estado RESPONDED impede tarefa duplicada. Revogar consentimento de pesquisa, desativar NPS, cancelar ou reagendar atendimento cancela pesquisas ainda planejadas. O perfil de paciente mostra estado/nota e se ha follow-up, sem expor comentario no dashboard agregado.

## Estado da entrega

- **Implementado:** agregacoes, comparacao de periodos no frontend, filtro por unidade/periodo, exportacao CSV, NPS privado e independente da pesquisa de cinco opcoes, planejamento interno, resposta manual autenticada, tarefa de follow-up, links para central de tarefas, contador no dashboard e resumo no perfil do paciente.
- **Validado:** API E2E PostgreSQL 4/4; Playwright focado 1/1 em desktop e viewport movel; build API/Web; lint API; lint Web exit 0 com avisos React registrados; Prisma validate; migration status do desenvolvimento atualizado com 29 migrations; instalacao limpa em duas bases descartaveis com 29/29 migrations.
- **Parcial/bloqueado por operacao externa ou decisao:** envio NPS, resposta inbound autenticada e integracao do NPS com BullMQ/outbox; metricas da outbox por unidade; resposta media sem pares auditaveis; politica clinica/legal de pergunta, consentimento e retencao deve ser aprovada pela clinica. O NPS continua desligado por padrao e nao realiza contato.
- **Nao realizado:** envio Meta/Evolution, consulta/escrita Uno, cobranca, VPS, teste de carga ou limpeza da base de desenvolvimento. Os resultados anteriores da Fase 8 e Superadmin foram preservados, sem repetir suas suites completas.

## Evidencias e ocorrencias de validacao

Os testes finais rodaram serialmente contra banco descartavel recem-criado `clinic_phase9_final`; o Playwright usou o mesmo banco isolado e fixtures locais. Os quatro E2E cobrem agregados/tenant/unidade/CSV, autorizacao, nota invalida e duplicada, tarefa unica, conclusao elegivel sem outbox, opt-out e proxy falsificado. O teste do navegador cobre login, selecao de unidade, configuracao, resposta, follow-up, exportacao CSV e layout movel.

Uma primeira execucao da suite E2E passou nos casos funcionais, mas o cleanup tentou excluir evento de consentimento protegido pelo trigger imutavel. A execucao final passou em banco descartavel sem apagar registros do banco de desenvolvimento. As primeiras tentativas de Playwright encontraram seletores de teste ambiguos/inconsistentes; os seletores foram ajustados e a execucao final passou 1/1. Um erro TypeScript no acesso ao modelo de recurso foi corrigido para o modelo real `UnitResource`; o build final passou.

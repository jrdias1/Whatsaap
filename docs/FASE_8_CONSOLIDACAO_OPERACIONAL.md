# Fase 8 — consolidação operacional (19/10/2026)

**Estado: concluída no escopo incremental local.** Dashboard, inbox, navegação contextual e jornadas de navegador foram integrados e validados. Isto não representa homologação de canais externos nem liberação para dados reais.

## Entregas concluídas

- Dashboard clínico consumindo `GET /api/dashboard/overview`, com agregados PostgreSQL por tenant/unidade, datas de `America/Sao_Paulo`, agenda do dia, conversas em espera, tarefas abertas/atrasadas e falhas de outbox. O serviço agora rejeita também o ID de unidade de outro tenant para administradores; operadores continuam limitados às unidades atribuídas e às próprias tarefas.
- Inbox dividida em `InboxConversationList.tsx`, `InboxConversationPanel.tsx` e `InboxPatientSummary.tsx`. O painel central preserva timeline, autoria/origem, estado real da mensagem, rascunhos IA com revisão humana, respostas rápidas e fila lógica. Mostra estados de carregamento/erro e não apresenta `SIMULATED` ou `QUEUED` como entrega.
- Navegação usando relacionamentos persistidos: tarefa → conversa/paciente/agendamento; perfil do paciente → conversa/agendamento; resumo da inbox → perfil, agenda para agendamento e formulário de novo atendimento com o paciente selecionado. As operações continuam passando pelas APIs e autorização existentes.
- A listagem de tarefas inclui os identificadores necessários da conversa/agendamento e o paciente associado à conversa. Nenhum endpoint de CRM/calendário/tarefas foi duplicado e não houve migration.
- A inicialização de estágios da inbox permanece idempotente sob concorrência por `createMany(skipDuplicates)` dentro de transação.
- A fixture Playwright separa o endereço de cliente por spec. O modo de confiança do proxy é habilitado apenas quando `NODE_ENV=test` e `PLAYWRIGHT_TEST_TRUST_PROXY=1`; o servidor de teste só confia em loopback e a API mantém o limite de login. Nenhum limite de autenticação de produção foi alterado.
- Shell, CRM e tarefas usam os tokens de design existentes. Screenshots desktop/mobile foram revistos visualmente.

## Validação final

- API build: aprovado (`npm run build --workspace api`).
- Web build: aprovado (`npm run build --workspace web`).
- API lint: aprovado, sem avisos.
- Web lint: exit code 0; permanecem avisos React sobre atualização de estado em efeitos e uso de relógio durante render, localizados em componentes existentes, incluindo `App.tsx`, `CalendarPage.tsx`, `InboxPatientSummary.tsx`, `DashboardPage.tsx` e `TasksPanel.tsx`.
- Dashboard unitário: 2/2 aprovados.
- Dashboard PostgreSQL E2E: 2/2 aprovados; inclui agregado por tenant/unidade, data local, recorte de operador e rejeição de unidade fora do tenant/escopo.
- Playwright integral, numa única invocação serial: **8/8 aprovados** — agenda 4, dashboard/inbox responsiva 1, Superadmin 1 e indicações 2. O primeiro ciclo de correção terminou 7/8 porque dois specs ainda compartilhavam o bucket de IP; a fixture foi ajustada e a execução final completa passou sem 429.
- Prisma validate: aprovado. `prisma migrate status`: schema atualizado, 28/28 migrations. Não foi criada migration nesta fase.
- Screenshots: [dashboard desktop](./evidencias/fase8-dashboard-desktop.png), [inbox desktop](./evidencias/fase8-inbox-desktop.png) e [inbox mobile](./evidencias/fase8-inbox-mobile.png).
- Os 52/52 E2E API, 2/2 TOTP e instalação limpa 28/28 continuam como resultados anteriores; não foram repetidos integralmente nesta atualização. Não houve testes de carga.

## Inventário das bases e fixtures antigas

Consulta somente leitura em 19/10, sem exclusões:

- Banco local de desenvolvimento `clinic`: 15 tenants; 13 têm slug/nome reconhecível de teste/demo. Incluem três pares `E2E Tenant A/B`, quatro `Redis outage` e `Clinica Demo Jr` (tenant de demonstração ativo, com unidade, membership e assinatura TRIAL).
- Banco de navegador `clinic_browser_validation`: dois registros de fixture antigos (`Calendar E2E` e `Dashboard E2E`), ambos TRIAL; o segundo tem uma unidade e um membership. Não foram removidos.
- As duas bases são distintas. A configuração Playwright usa `clinic_browser_validation`; o `.env` da API local aponta para `clinic`. O teste PostgreSQL novo criou e limpou apenas seus próprios fixtures identificados por sufixo aleatório.
- Próxima ação de dados: confirmar quais tenants antigos devem ser mantidos e elaborar limpeza auditável em tarefa separada. A conta demo deve ser preservada até decisão explícita. Nenhum dado foi apagado neste incremento.

## Limites e backlog explícito

- O dashboard não apresenta atividade recente, gráficos nem “retorno pendente”: os eventos e critérios necessários não estão disponíveis como agregado confiável nesta fase; não foram inventados.
- Mensagens não lidas não têm estado persistido e anexos não estão implementados. A inbox continua fonte do histórico; entrega Meta/Evolution segue desligada.
- O resumo compacto não duplica consentimentos e timeline: esses dados continuam no perfil completo do paciente.
- Nenhuma consulta/escrita Uno, envio Meta/Evolution, cobrança, VPS ou benchmark foi executado. Dados de demonstração não devem ser tratados como dados reais.
- A fase está concluída localmente para o escopo desta entrega; as limitações acima e as pendências de segurança/privacidade/homologação ainda impedem uso em produção.

## Continuação funcional — 20/10/2026

- O Inbox passou a oferecer uma configuração de fluxo de pós-atendimento por etiqueta. Cada fluxo pode ter etapas com atraso e texto editável; a condição opcional de etiqueta é verificada no paciente. A sequência só é planejada após atendimento nativo concluído. Adicionar uma etiqueta ao paciente não dispara uma mensagem imediatamente.
- As campanhas do funil podem ser vinculadas a uma etapa e iniciar ao entrar nela ou após um período sem resposta. Ao mover o cartão, a equipe escolhe se inscreve a conversa. O processamento cancela ou suprime inscrições obsoletas e verifica conversa ativa, consentimento, atividade recente e limite diário antes de registrar na fila. Continua sem envio externo homologado.
- O compositor separa o canal WhatsApp da finalidade `Resposta ao paciente`; a finalidade não cria inscrição em campanha ou canal. Respostas são registradas na fila local.
- O resumo do paciente no Inbox mantém links para perfil e agenda; tarefas contextuais seguem associadas à conversa/paciente.

O status técnico consolidado e as referências para campanhas, etiquetas e interface estão em [`REVISAO_2026-10-20.md`](./REVISAO_2026-10-20.md) e [`REGISTRO_IMPLEMENTACAO.md`](./REGISTRO_IMPLEMENTACAO.md).

# Auditoria 360 - SaaS Clinicas (NestJS, Prisma, PostgreSQL e React/Vite)

**Data:** 18/10/2026 (America/Sao_Paulo)  
**Escopo conferido:** 37 arquivos TypeScript em `api/src`, 3 arquivos TypeScript/TSX em `web/src`, 3 testes E2E, `api/prisma/schema.prisma` (612 linhas), 7 migrations, controllers, services, guards, chamadas frontend, manifests e configuracoes de build/teste/Docker.  
**Metodo:** leitura dos modulos de aplicacao e do schema; busca por acessos `unscoped`, operacoes Prisma, rotas, chamadas `fetch/request`, catches, cron/worker e calculos financeiros; execucao de lint e builds. Prisma validate/migrate status e E2E PostgreSQL tambem foram executados nesta sessao anterior em 18/10/2026; esta continuacao reexecutou lint e builds.  
**Limite:** isto e uma revisao estatica e verificacao local; nao e pentest externo, revisao juridica, teste de carga, homologacao de provedores, nem autorizacao para producao.

## Resumo executivo

A base tem uma politica central de tenant em `api/src/prisma/prisma.service.ts`, guard global de autenticacao/sessao/tenant e aplicacao de escopo de unidade nos principais fluxos. Nao encontrei leitura ou escrita cross-tenant exploravel nos caminhos revisados. O cliente Prisma `unscoped` e usado em autenticacao/webhook e transacoes; nesses caminhos a consulta/escrita de negocio inclui `tenantId` explicitamente, com excecao de operacoes globais justificadas por email ou segredo de webhook.

A auditoria encontrou um defeito de autorizacao **cross-unit** nas campanhas. Nesta continuacao, as rotas de campanhas e automacoes foram restringidas a `TENANT_ADMIN` e as opcoes foram ocultadas para outros papeis na UI. O escopo de unidade continua sem entidade `Campaign.unitId`; se for desejado permitir campanhas por gerente no futuro, sera necessario modelar essa relacao e filtrar o publico por unidade antes de liberar esse papel.

Outros bloqueios importantes sao a falta de provisionamento do primeiro tenant/admin, inexistencia de telas para concluir fluxos essenciais e erros de conflito sem tratamento em procedimentos. Nao ha logica de comissao, margem ou multa nem tipos `Float`/`Decimal` no schema: precos estao em centavos (`Int`), sem calculos financeiros encontrados nesta versao. Nao ha cron ou worker implementado para revisar fuso/idempotencia.

## 🔴 CRITICO

**Nenhum achado classificado como critico nesta verificacao.** Isso nao equivale a aprovacao de producao. O item ALTO-1 foi mitigado por RBAC nesta continuacao; falta E2E dedicado antes de habilitar envio real.

Controles observados:

- `TenantGuard` valida UUIDs, sessao nao revogada/expirada, status de tenant, usuario e membership ativos. O papel usado na requisicao vem da membership persistida, nao do claim fornecido pelo cliente (`api/src/security/tenant.guard.ts`).
- JWT e roles sao guards globais (`api/src/app.module.ts`); rotas publicas sao marcadas explicitamente. Rotas com `@Roles` verificam o papel da sessao atual (`api/src/security/roles.guard.ts`).
- A extensao Prisma inclui filtros por tenant para modelos tenant-scoped (`api/src/prisma/prisma.service.ts`). O uso de `unscoped` nos services foi revisado; transacoes de negocio filtram `tenantId`, e o webhook Uno autentica um segredo antes de usar o `tenantId` da conexao.
- Queries SQL raw encontradas usam tagged templates parametrizados do Prisma. Nas rotinas de mensagens e campanhas, locks e queries possuem escopo tenant/paciente.
- A Inbox recusa `INBOUND` enviado por operador e autoria IA falsificada. Mensagens IA passam pelo fluxo de rascunho e aprovacao humana.

## 🟠 ALTO

### ALTO-1 - Campanhas cross-unit (mitigado por RBAC)

**Arquivos:** `api/src/campaigns/campaigns.controller.ts` e `api/src/campaigns/campaigns.service.ts`; modelo `Campaign` em `api/prisma/schema.prisma`.

As rotas `GET/POST /campaigns`, aprovacao e listagem/criacao de automacoes agora exigem `TENANT_ADMIN`. A UI oculta Campanhas e Automacoes para outros papeis. Com isso, o fluxo operacional que alcancava todas as unidades ficou reservado ao administrador do tenant. O modelo ainda nao tem `Campaign.unitId`, portanto campanhas por unidade para gerentes seguem sem suporte.

**Estado:** mitigado por RBAC e compilado; falta E2E dedicado com papel `UNIT_MANAGER` antes de considerar validado por teste.

### ALTO-2 - Nao ha provisionamento do primeiro tenant e administrador

**Arquivos:** `api/src/scripts/seed-saas-plans.ts`, `api/src/auth/auth.service.ts`, `api/src/users/users.service.ts`.

O seed atual cria planos e pode associar assinatura a um tenant ja existente. No codigo de aplicacao nao ha fluxo de onboarding/bootstrap que crie `Tenant` e `Membership(TENANT_ADMIN)`. Convites aceitam `UNIT_MANAGER` ou `OPERATOR`, nunca `TENANT_ADMIN`. `PLATFORM_SUPERADMIN` e reconhecido por varias autorizacoes, mas nao encontrei um fluxo de atribuicao. Isso bloqueia a instalacao inicial sem manipulacao manual do banco.

**Acao:** criar comando operacional seguro de bootstrap (tenant, usuario, membership e assinatura em transacao), sem senha/token em logs, com idempotencia/documentacao e verificacao de ambiente.

### ALTO-3 - Fuso de negocio da campanha ainda nao esta configurado

**Arquivos:** `web/src/App.tsx` (formato `datetime-local` enviado em `createCampaign`) e `api/src/campaigns/campaigns.service.ts` (`new Date(String(input.scheduledAt))`).

A UI agora converte o valor `datetime-local` para ISO com offset (`toISOString()`), e a API rejeita strings sem `Z`/offset. Isso remove a interpretacao dependente do fuso do processo Node. Ainda nao existe timezone configurado por tenant: a conversao usa o fuso do navegador.

**Estado:** ambiguidade servidor/cliente corrigida; definir timezone da clinica e usar essa configuracao continua pendente para usuarios/dispositivos em fusos diferentes. Teste automatizado ainda pendente.

### ALTO-4 - Backend nao tem UI para concluir fluxos operacionais essenciais

**Arquivo principal:** `web/src/App.tsx`; pagina de convite em `web/src/AcceptInvitation.tsx`.

A tela atual permite listar pacientes, mas nao criar/editar/arquivar nem registrar consentimento; logo o operador nao consegue preparar pacientes para os fluxos de comunicacao pela interface. Tambem nao ha tela para enviar convite de usuario, administrar procedimentos, nem acoes de status/reagendamento de consulta ou fechar conversa.

Rotas sem chamada frontend encontrada:

| Rota | Lacuna na interface |
|---|---|
| `POST/PATCH/DELETE /patients`, `POST /patients/:id/consents` | Cadastro, edicao/arquivamento e consentimento. |
| `GET/POST/PATCH /procedures` | Gestao de procedimentos; agendamento nao oferece `procedureId`. |
| `POST /users/invitations` | Existe somente a pagina de aceite do convite. |
| `PATCH /appointments/:id/status`, `PATCH /appointments/:id/reschedule` | Sem confirmar/cancelar/concluir/falta/reagendar. |
| `POST /inbox/conversations/:id/close` | Sem acao para encerrar conversa. |

**Acao:** priorizar cadastro/consentimento, convite e ciclo de agenda. Criar tipos/DTOs compartilhados ou contrato OpenAPI para evitar divergencia de payload.

### ALTO-5 - Conflito de nome de procedimento (corrigido, aguardando E2E)

**Arquivos:** `api/src/procedures/procedures.service.ts`, `api/prisma/schema.prisma` (`@@unique([tenantId, name])`).

Create e update agora capturam Prisma `P2002` e retornam HTTP 409 (`ConflictException`), em vez de um 500 generico. A unicidade segue por tenant, nao por unidade; confirmar se essa regra e intencional.

**Estado:** corrigido e compilado; falta E2E para duplicidade e update com nome repetido.

## 🟡 MEDIO

### MEDIO-1 - Encoding corrompido em strings exibidas ao usuario

Ha mojibake em diversos services, incluindo `api/src/campaigns/campaigns.service.ts`, `api/src/usage/usage.service.ts`, `api/src/users/users.service.ts`, `api/src/procedures/procedures.service.ts`, `api/src/inbox/inbox.service.ts`, `api/src/auth/*` e partes da UI `web/src/App.tsx`. Exemplos: `Tenant obrigat??rio`, `conte??do`, `Fa??a upgrade`. O build passa, mas erros e textos do produto ficam ilegiveis.

**Acao:** normalizar arquivos para UTF-8 sem BOM e acrescentar verificacao automatizada para padroes comuns de mojibake.

### MEDIO-2 - Tratamento silencioso reduz observabilidade

- `api/src/users/users.service.ts`: falha ao gravar o evento `USER_INVITATION_DELIVERY_FAILED` e descartada via `.catch(() => undefined)`. A falha de entrega original e retornada ao usuario, mas o rastro de auditoria pode faltar.
- `api/src/health/health.controller.ts` converte falha do banco em estado `degraded` sem log; comportamento util para healthcheck, mas sem correlacao diagnostica.
- `api/src/ai/ai.service.ts` e mailer convertem falhas de rede em erro controlado sem logger estruturado/correlation id. Isso evita expor segredos, mas dificulta suporte.
- Frontend ignora falha de refresh silenciosamente em `web/src/App.tsx`; aceitavel como fallback de sessao, mas sem telemetria.

**Acao:** adicionar logger estruturado e correlation id, sanitizando PII, tokens e chaves; manter respostas externas genericas.

### MEDIO-3 - Listagens cortam resultados sem cursor ou sinal de pagina

`PatientsService.list` limita a 200, `AppointmentsService.list` a 500, Inbox conversations a 200, mensagens a 500, campanhas/automa??es a 100. Nenhuma dessas respostas retorna cursor/total. A UI pode interpretar uma lista parcial como completa.

**Acao:** implementar cursor/paginacao consistente e indicar total ou existencia de proxima pagina.

### MEDIO-4 - Avisos do linter React e chamadas de efeito

`npm run lint --workspace web` passou com tres avisos `react(set-state-in-effect)` em `web/src/App.tsx` (linhas 53, 72 e 77 na revisao). Revisar inicializacao de sessao/dados e sincronizacao de unidade para evitar render em cascata e requests redundantes.

### MEDIO-5 - Extensao Prisma recriada a cada acesso

`PrismaService.scoped` chama `$extends()` toda vez que o getter e lido. Nao encontrei falha de isolamento causada por isso, mas gera clients estendidos repetidos e torna o caminho de seguranca mais dificil de inspecionar. Considerar cache por contexto tenant/request depois de medir.

### MEDIO-6 - Ativos e dependencias possivelmente residuais

- `web/src/assets/vite.svg`, `react.svg` e `hero.png` nao tem referencia em `web/src` nesta versao.
- `@nestjs/mau` aparece em `api/package.json`, mas nao encontrei uso no codigo/configuracao. Confirmar se ferramenta local ainda e necessaria antes de remover.
- `vite-tsconfig-paths` e usado pelo `api/vitest.config.e2e.ts`; nao classificar como orfao. `rxjs` e dependencia da plataforma Nest e nao deve ser removido apenas por nao aparecer em import direto.
- Diretorios `incomplete-lodash-install/`, `incomplete-rxjs-install/` e `package-lock.pre-repair.json` descritos em uma auditoria anterior **nao estavam presentes na raiz** nesta verificacao; nao ha acao de remocao pendente para eles.

### MEDIO-7 - Sem cron/worker; fuso e idempotencia ainda nao podem ser avaliados

Busca em `api/src` nao encontrou `@Cron`, `ScheduleModule`, `CronExpression`, `setInterval` ou worker. Isso e consistente com o MVP: outbox, automacoes, NPS e recorrencias ainda nao enviam/processam. Ao implementar, usar fila duravel, chaves idempotentes, timezone do tenant e estrategia de retry/reconciliacao.

### MEDIO-8 - Escala por instancia e confianca em proxy precisam de decisao de deploy

`ThrottlerModule` usa configuracao local padrao; nao foi observada store compartilhada para multiplas replicas. `main.ts` nao configura confianca de proxy. Se a API rodar atras de load balancer/multiplas instancias, confirmar IP real do cliente e rate limit distribuido, especialmente para login.

## Precisao financeira e tratamento de erros

- Nao foram encontrados campos Prisma `Float`/`Decimal`, calculos de comissao, margem, multa ou baixa financeira. `Plan.priceCents` e `Int`; valores de transacoes Uno chegam como payload selecionavel e nao sao calculados no backend nesta versao.
- Portanto, nao ha erro de arredondamento financeiro identificado no codigo atual. Antes de adicionar cobranca/comissao, manter valores monetarios em centavos inteiros ou tipo decimal do banco e testar limites/arredondamento.
- Nao foram encontrados blocos vazios `catch {}` sem conversao/fallback. Os catches encontrados tem comportamento definido; o descarte da auditoria de falha de convite e a excecao de observabilidade descrita em MEDIO-2.

## Mapeamento Frontend - Backend

O frontend usa `fetch`/`request` diretamente em `web/src/App.tsx` e `AcceptInvitation.tsx`; nao existe arquivo separado `api.js`. As chamadas existentes correspondem aos contratos manuais observados: login, refresh/logout/me, unidades, lista/criacao de agendamento, pacientes listados para seletores, Inbox, mensagens OUTBOUND humanas, campanhas, rascunhos IA, Uno e uso/plano. Nao ha DTO classes/validacao declarativa; services validam `Record<string, unknown>` manualmente, aumentando risco de drift.

Rotas sem chamada de UI estao listadas em ALTO-4. O timezone do navegador ja e enviado explicitamente para campanhas; a configuracao de timezone por tenant segue pendente em ALTO-3. Nenhuma incompatibilidade de payload foi confirmada nas chamadas que existem; campos omitidos, como `procedureId`, sao opcionais no backend.

## 📝 PLANO DE ACAO

Ordem sugerida para fechar os achados desta auditoria:

1. **Escopo de campanha:** RBAC em `api/src/campaigns/campaigns.controller.ts` e navegacao por papel em `web/src/App.tsx` feitos. Falta E2E para gerente e modelagem `unitId` se campanhas por gerente/unidade forem requisito.
2. **Provisionamento inicial seguro:** criar `api/src/scripts/seed-tenant-admin.ts` e documentar no `api/README.md`/registro. Transacao idempotente e sem segredo em log.
3. **Timezone:** serializacao ISO explicita em `web/src/App.tsx` e validacao no `api/src/campaigns/campaigns.service.ts` feitas. Falta decidir/configurar timezone por tenant.
4. **Fechar fluxos de paciente:** adicionar componentes/telas (preferivel extrair de `web/src/App.tsx`) para `POST/PATCH/DELETE /patients` e `POST /patients/:id/consents`; confirmar que consentimento e evidencia ficam auditaveis.
5. **Gestao de usuarios:** criar tela/componente chamando `POST /users/invitations`, respeitando papel e unidades permitidas.
6. **Procedimentos:** traducao `P2002` para 409 em `api/src/procedures/procedures.service.ts` feita. Falta E2E, confirmar unicidade por tenant/unidade e criar tela CRUD/selecao opcional no agendamento.
7. **Acoes de agenda/Inbox:** `web/src/App.tsx` ou componentes dedicados para status, reagendamento e fechamento de conversa.
8. **Observabilidade:** `api/src/main.ts`, services de convite/IA/Uno e health; adicionar logger estruturado/correlation id com redacao de segredos.
9. **Escala de rate limit:** rever `api/src/app.module.ts`, `api/src/main.ts` e configuracao de deploy para proxy/IP e store distribuida se houver replicas.
10. **Qualidade/legado:** corrigir encoding nos services e UI; avaliar/remover ativos Vite/React nao referenciados e `@nestjs/mau` somente apos confirmar uso; resolver avisos React; considerar paginacao.
11. **Preparar workers:** definir fila, timezone, retries, idempotencia, reconciliacao e metricas antes de ativar envio/outbox; nao e implementado nesta entrega.
12. **Gate de producao:** complementar E2E/matriz RBAC e executar revisao de seguranca externa, backup/restore, homologacao de Uno/Meta, politica de retencao/base legal, ensaio de carga e plano de resposta a incidente.

## Evidencias desta continuacao

- Alterados `api/src/campaigns/campaigns.controller.ts`, `api/src/campaigns/campaigns.service.ts`, `api/src/procedures/procedures.service.ts` e `web/src/App.tsx`.
- `npm run lint --workspace api`: passou.
- `npm run lint --workspace web`: passou com 3 avisos React registrados em MEDIO-4.
- `npm run build --workspace api`: passou.
- `npm run build --workspace web`: passou.
- Testes E2E nao foram adicionados nem executados nesta continuacao. E2E PostgreSQL e validacao/migrations passaram na revisao anterior registrada em 18/10/2026; as novas alteracoes precisam de testes focados antes de producao.

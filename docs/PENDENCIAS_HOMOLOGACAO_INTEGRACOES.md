# Pendências objetivas para homologação de integrações

**Revisão:** 18/10/2026. Pesquisa documental e planejamento apenas. Nenhuma credencial foi solicitada, nenhuma chamada externa foi executada e nenhum envio foi realizado. A escrita na Uno permanece desabilitada.

## Uno

### Dados e acessos que o cliente/Uno precisa fornecer

- Credenciais de API autorizadas **por unidade/conta Uno** (`x-uno-access-token` e `x-uno-secret-key`, conforme documentação consultada); canal seguro para entrega e rotação.
- `franchiseIdentifier`/identificador equivalente para cada unidade e confirmação de ambiente (produção, homologação ou conta de testes).
- Usuário administrador autorizado a configurar webhooks e eventos no painel Uno.
- URL pública HTTPS de callback, segredo aleatório para `X-UNO-Webhook-Token`, eventos permitidos e contato operacional para revogação/incidentes.
- Consentimento do cliente para cada categoria de dado e finalidade, incluindo se dados de venda/status financeiros podem ser processados.

### Endpoints documentados e limites

- `GET /v1/scheduler/hours`: consulta de horários; validar data, serviço, unidade e fuso reais da conta.
- `POST /v1/scheduler/create`: cria agendamento; validar duplicidade, efeito de `allowUpdateAppointment`, confirmação e comportamento quando a resposta expira.
- `POST /v1/lead`: cria lead; validar resposta e estratégia de deduplicação.
- Webhooks documentados: `APPOINTMENT_CREATED`, `APPOINTMENT_UPDATED`, `APPOINTMENT_REMOVED`, `ORDER_CREATED`, `ORDER_UPDATED`. Exigem configuração no painel Uno.
- A documentação consultada não comprovou listagem/importação histórica de pacientes/agendamentos, endpoint dedicado para cancelamento/reagendamento, leitura completa de sessões/saldo ou detalhes de parcelas/pagamentos.
- Webhook documentado usa token em header, sem assinatura do corpo; entrega at-least-once, sem retry automático, sem ID de entrega e timeout de 10 s. Exigir TLS, comparação segura do segredo, deduplicação/replay, persistência rápida em inbox durável e alerta de falhas.

### Decisões de produto/homologação ainda necessárias

1. Para cada unidade, escolher fonte de verdade `NATIVE` ou `UNO`; nunca manter ambas como mestres simultâneos.
2. Aprovar separadamente leitura de disponibilidade, ingestão de eventos, criação de lead e escrita de agendamento. Escrita/reagendamento/cancelamento ficam desligados até testes com conta autorizada.
3. Confirmar mapeamento de unidade, profissional, sala, serviço e paciente; payload de agendamento pode não conter telefone, então não associar por nome apenas.
4. Confirmar semântica real de `APPOINTMENT_UPDATED`, `allowUpdateAppointment`, remoção/cancelamento, status `PAID`/`COMPLETED`, timezone e conflitos.
5. Definir campos que a clínica autoriza processar, retenção dos dados/eventos, quem administra credenciais e quem atende falhas.
6. Obter exemplos de payload reais anonimizados e procedimento de teste/replay; confirmar limites/rate, suporte e endpoint de sandbox.

## Meta WhatsApp Cloud API

### Credenciais, ativos e permissões

- Definir modelo de integração: app próprio da Essencial como Tech Provider/Embedded Signup, configuração direta por cliente, ou BSP. Isso define onboarding, titularidade da WABA/número, faturamento e revisão de aplicativo.
- App ID/segredo da Meta e acesso ao Business Portfolio/WABA; WABA ID e Phone Number ID para cada conexão; token de acesso de longa duração com rotação/revogação segura (não usar token temporário de desenvolvimento em produção).
- Validar Advanced Access/App Review e permissões mínimas para o fluxo escolhido: `whatsapp_business_messaging` para mensagens; `whatsapp_business_management` para ativos/templates; `business_management` quando o fluxo de onboarding/gestão empresarial exigir.
- Número de telefone habilitado, verificação/registro, titularidade, coexistência com WhatsApp Business App se necessária, qualidade/rate limits, cobrança e templates aprovados.
- Webhooks Meta configurados para WABA e eventos de mensagens/status; callback HTTPS público, verify token e validação da assinatura do corpo com o App Secret. Segredos, tokens e payloads pessoais não devem aparecer em logs.

### Endpoints principais documentados

- `POST /{Phone-Number-ID}/messages`: envio de texto, mídia ou template, com token Bearer e permissão de mensageria.
- `GET /{WABA-ID}/phone_numbers`: enumeração de números do ativo autorizado.
- `POST /{WABA-ID}/subscribed_apps`: inscrição do app nos webhooks da WABA.
- Seleção explícita da versão Graph API suportada e prova de recebimento de webhooks de mensagem e status. Não usar chamada de envio até credenciais, consentimento e política de canal estarem aprovados.

### Decisões ainda necessárias

1. Quem será titular e pagador da WABA, número, templates e tarifas; quem atende bloqueios/qualidade.
2. Fluxo direto/Embedded Signup/BSP e responsabilidades de App Review/Tech Provider.
3. Categorias de mensagem, templates aprovados, janela de atendimento e regra de opt-in/opt-out por finalidade.
4. Políticas de armazenamento de conteúdo/anexos/status, retenção e tratamento de dados que possam revelar saúde.
5. Ambientes e números de teste; processo de rotação de token, revogação, incidente e suporte.
6. MKP permanece exclusivamente no canal oficial Meta. Evolution/Baileys é conexão distinta e não substitui a Cloud API oficial.

## Fontes

- [Uno — credenciais e API](https://ajuda.unobject.com.br/pt-br/articles/65-documentacao-da-api-de-criacao-de-leads-e-agendamentos), [horários](https://readme.unobject.com.br/reference/get_scheduler-hours), [criação de agendamento](https://readme.unobject.com.br/reference/post_scheduler-create), [leads](https://readme.unobject.com.br/reference/post_lead), [webhooks](https://readme.unobject.com.br/reference/webhook).
- [Meta — WhatsApp Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) (endpoints, permissões e exemplos).
- [Meta — WhatsApp Embedded Signup collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup) (onboarding; publicação exige App Review e Advanced Access de `business_management` e `whatsapp_business_management` no fluxo Embedded Signup).\n- [Meta — Webhook Payload Reference](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference) e [assinatura de webhook do SDK oficial](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/) (endpoint HTTPS público, assinatura e inscrição da WABA).

Essas fontes são documentação pública; credenciais, contratos e capacidades específicas da conta do cliente precisam ser confirmados durante homologação.

## Situação conferida no código — 18/10/2026

| Capacidade | Evidência documental pública | Estado no código local | O que falta para homologar |
|---|---|---|---|
| Uno: consulta de horários | Endpoint documentado `GET /v1/scheduler/hours`. | `UnoService` possui chamada de teste de credencial/horários com timeout; não seleciona Uno como fonte de verdade. | Credenciais autorizadas, unidade/serviço/profissional de teste, limites e confirmação do payload real. |
| Uno: pacientes/histórico e sessões/saldo | As referências públicas consultadas não comprovam listagem/importação histórica completa nem saldo detalhado de sessões. | Não implementado. | Contrato/endpoints e permissões fornecidos pela Uno/cliente; campos e retenção autorizados. |
| Uno: criar lead/agendamento | `POST /v1/lead` e `POST /v1/scheduler/create` são documentados. | Escrita na Uno está bloqueada; a agenda nativa segue como fonte. | Sandbox, semântica dos estados, idempotência, conflito e autorização explícita por unidade. |
| Uno: cancelar/reagendar | Não foi confirmado endpoint dedicado nem semântica de atualização/cancelamento para a conta do cliente. | Não implementado para Uno. | Endpoint, payload, autorização, estados, concorrência e reconciliação confirmados pela Uno. |
| Uno: webhooks | Documentação pública lista eventos de agenda/vendas. | Endpoint local valida token/hash, filtra campos e deduplica; não roda em fila durável nem atualiza a agenda como fonte autoritativa. | URL pública HTTPS, segredo configurado, payloads anonimizados reais, replays, ordem/retentativa e política de dados. |
| Meta: envio Cloud API | `POST /{Phone-Number-ID}/messages`; ID retornado permite acompanhar status. | Nenhum adaptador de envio Meta ativo; nenhum disparo foi feito. | WABA/Phone Number ID, token seguro, Graph API version, permissões aprovadas, template, consentimento e número de teste. |
| Meta: webhook inbound/status | Payload contém `entry/changes/value`, `metadata.phone_number_id`, `messages` e `statuses`. | Endpoint valida HMAC sobre raw body e GET challenge; persiste no PostgreSQL antes do sucesso; job BullMQ com ID determinístico, marcação `enqueuedAt` e reconciliação dos jobs ausentes/`PROCESSING` vencidos; retry até 8 tentativas, backoff e estado terminal durável. Limita um tenant a 8 de 32 slots de worker. Associa inbound a paciente existente, grava opt-out exato `SAIR`/`STOP`/`CANCELAR` e suprime outbox pendente. Status monotônicos sob lock. E2E local: HMAC, dedupe, opt-out/supressão, status fora de ordem, worker interrompido. Ensaio local de 5.000 + 100 eventos concluiu com 5.100 `PROCESSED` e 0 erro HTTP; métricas em `TESTE_CARGA_WEBHOOK.md`. | App Secret/verify token reais, callback HTTPS, inscrição da WABA, conexão/fixtures autorizadas, ensaio de parar e restaurar Redis real, teste de integração externo e cadência/SLO. Nenhum envio está implementado/habilitado. |

### Checklist de homologação que bloqueia tráfego real

1. Cliente/Uno deve entregar credenciais e conta de homologação, identificar IDs de unidade, serviços, profissionais e autorizar cada operação/campo.
2. Confirmar por escrito se a Uno oferece consulta/importação de pacientes, histórico, sessões/saldo, criação, alteração, reagendamento, cancelamento e pagamentos; não inferir capacidades por nome de evento.
3. Aprovar dono dos ativos Meta (Business Portfolio, WABA, telefone), modelo de onboarding, faturamento, token permanente/rotação, permissões e versão Graph API.
4. Disponibilizar número/template de teste, callback HTTPS público, App Secret e processo de teste de status/retry.
5. Validar inbox/outbox, idempotência, assinatura, dedupe, fila, consentimento/opt-out, logs sem PII e plano de rollback sem efetuar disparos para pacientes.

Até esses itens serem aprovados, nenhum envio externo é realizado e a escrita Uno permanece desligada.

### Atualização de confiabilidade local — 18/10/2026

O teste de interrupção/retorno real do Redis local e o reinício de um worker outbox foram executados com fixtures sintéticas; os resultados estão no [registro de implementação](./REGISTRO_IMPLEMENTACAO.md). O webhook grava no PostgreSQL antes de responder sucesso e a repetição após restabelecer Redis não duplicou evento nem mensagem inbound. O dispatcher consome a outbox existente apenas em `dry-run` e grava resultado `SIMULATED`; não existe adaptador ativo que envie à Meta. Carga dry-run 5.000/5.000 está detalhada em [TESTE_CARGA_OUTBOX_DRY_RUN.md](./TESTE_CARGA_OUTBOX_DRY_RUN.md). Isso atualiza o requisito anterior de ensaiar a parada real do Redis, mas não constitui homologação externa nem valida a cadência Meta. Seguem pendentes RSS confiável da API, falha Redis durante o dispatch, contrato de template/janela, credenciais autorizadas e número de teste. Nenhum disparo ou escrita Uno foi feito.

## Evolution API já instalada — checklist de homologação

### Inventário reutilizado do CRM Turismo

O código local em `E:\Documentos\Crm Turismo programa\server\src\whatsapp\` registra Evolution API 2.3.7 (referência encontrada em 26/05/2026; não confirma a VPS atual). O serviço usa header `apikey`, consulta `GET /instance/connectionState/{instance}` e `GET /instance/fetchInstances`, obtém QR via `GET /instance/connect/{instance}`, envia texto por `POST /message/sendText/{instance}` com `{ number, text }`, configura webhook por `POST /webhook/set/{instance}`, cria instância via `POST /instance/create` e tem rotinas de logout/delete. O CRM também faz retry/reconexão, mas usa `storeId`, payloads e semântica que não são contrato do SaaS. A rotina de entrada observa `MESSAGES_UPSERT`/`CONNECTION_UPDATE` e `key.remoteJid`; não demonstra tratamento idempotente suficiente de eco/status para porte direto. Desde 20/10/2026, o SaaS implementa criacao de instancia, QR, consulta de estado, configuracao de webhook e logout pelo servidor. O fluxo ainda depende de configurar o servidor e homologar com a Evolution instalada; delete remoto nao foi implementado.

### Dados que precisam ser confirmados por canal seguro

- Versão exata em execução, imagem/tag/digest e confirmação de Baileys versus Cloud.
- URL HTTPS, porta/reverse proxy, certificado, conectividade da API clínica e política de allowlist/firewall. Não enviar API key por chat comum.
- Para instâncias existentes: definir se a conexão deve ser reutilizada ou substituída; o fluxo novo cria e administra a instância por filial ao solicitar o QR.
- Esquema de autenticação (header `apikey`, `Authorization` ou outro), escopo da chave e eventual credencial por instância.
- Endpoints/payloads suportados nessa versão para status, QR, texto e webhook; método de desconexão e seu efeito na sessão.
- Eventos exatos e amostras anonimizadas para `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, incluindo `fromMe`, IDs, timestamps, status e eco.
- O endpoint local autentica o webhook com um segredo determinístico por conexão, derivado da chave de integração do servidor e comparado em tempo constante. Isso autentica posse do segredo, mas não equivale a HMAC do raw body. TLS, proxy autenticado e restrição de rede devem ser verificados antes do tráfego.
- Limites/ritmo por instância, política de sessão, retenção de mídia e regras operacionais. Baileys é WhatsApp Web não oficial; campanhas MKP/massa ficam bloqueadas.
- Callback público (`API_PUBLIC_URL`) e autorização para configurar webhook. O código pode configurar a Evolution ao solicitar QR; nenhuma chamada à VPS ou alteração remota foi feita nesta revisão.

### Estado local

Configuração cifrada por tenant/unidade, receptor autenticado por conexão, validação de instância quando presente no payload, persistência PostgreSQL antes da fila, dedupe e dry-run estão implementados. Inbound de paciente existente, eco `fromMe` sem duplicação, status e mudança de conexão têm tratamento local baseado nos formatos encontrados nos sistemas legados. O painel Canais inicia pelo servidor as operações de instância, QR e estado, com credenciais em variáveis de ambiente; o `EvolutionInspectionClient` segue restrito à leitura de contatos. O QR não foi validado contra a VPS nesta entrega. O envio de mensagens externas continua desativado. `EVOLUTION_CLOUD` é reservado e rejeitado até o contrato e o modo instalado serem confirmados.

## Meta Cloud API oficial — checklist separado

- Escolher titularidade/onboarding: app Essencial/Embedded Signup/Tech Provider, configuração por cliente ou BSP; definir pagador da Business Portfolio, WABA, número e tarifas.
- App ID/App Secret, verify token, WABA ID, Phone Number ID e token de sistema com rotação/revogação em secret manager; nunca expor segredos em ticket, chat ou navegador.
- Confirmar permissões para o fluxo (`whatsapp_business_messaging`, `whatsapp_business_management` e `business_management` quando o onboarding exigir), App Review/Advanced Access e versão Graph.
- Número/ambiente de teste, templates aprovados, categorias/idiomas, janela de atendimento, consentimento e throughput por número.
- Callback HTTPS, GET challenge, HMAC com App Secret, inscrição na WABA por `POST /{WABA-ID}/subscribed_apps` e eventos de mensagens/status.
- Nesta entrega a configuração é local e cifrada e o webhook inbound/status Meta existente é separado. Não chama `POST /{Phone-Number-ID}/messages`, testa credencial real, registra número ou submete template.

## Estado da entrega e dependências externas

Código local, build, E2E, teste de carga e integração homologada são estados diferentes. As conexões e adapters estão em dry-run; Evolution tem fixture autenticada, Meta mantém testes próprios de HMAC. Não ocorreu envio real, leitura/modificação da VPS, configuração remota de webhook Evolution ou escrita Uno.

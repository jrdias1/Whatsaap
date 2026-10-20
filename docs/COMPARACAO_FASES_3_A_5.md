# Comparação das referências — Fases 3 a 5

**Revisão:** 17/10/2026. A leitura foi feita nos caminhos citados abaixo. Nenhum módulo foi copiado literalmente; o projeto novo usa tenant/unidade e consentimento, enquanto as referências usam modelos e contratos diferentes.

**Estado em 17/10/2026:** painel web básico foi acrescentado para agenda, inbox, Uno, campanhas e automações. O envio externo e a execução de automações continuam desativados. O ledger de cotas agora é descrito em [comparação das Fases 6–7](./COMPARACAO_FASES_6_A_7.md).

## Decisão por módulo

| Referência | Código inspecionado | O que aproveitamos como padrão | O que não copiamos |
|---|---|---|---|
| CRM Turismo | `server/src/bookings/capacity-guard.service.ts`, `bookings.service.ts`, `calendar-events/calendar-events.service.ts` | Serialização transacional para capacidade/conflito, estados e auditoria de operação. | `tripId`, `storeId`, vendedores, passageiros e regras de excursão. A agenda clínica criada é `Appointment` e trava por tenant/unidade em Postgres. |
| CRM Turismo | `server/src/whatsapp/whatsapp.service.ts`, `whatsapp.controller.ts` | Separação entre fachada, conexão e envio; histórico e reconhecimento de eventos. | Rota pública que confia em `storeId` do payload, logs de mensagens e envio direto sem verificação local de consentimento. |
| CRM Turismo | `server/src/campaigns/campaigns.service.ts`, `campaign-processor.service.ts`, `campaign-scheduler.service.ts`, `campaign-automation.service.ts` | Rascunho, público-alvo, templates, status de entrega e automações configuráveis. | Segmentos e atributos de viagem, tentativas sem consentimento como gate, contagem acumulada e mensagens vinculadas ao contato turístico. O novo projeto cria Campaign/Outbox e exige consentimento de marketing. |
| PetControl | `Essencial_Pet/server/src/agenda/agenda.service.ts` | Estados pending/processing/sent/failed e claim atômico antes de processar. | Loop local com `setInterval`, envio imediato no serviço e reset de `processing` ao reiniciar sem reconciliar possível envio já aceito pelo provedor. |
| PetControl | `Essencial_Pet/server/src/campaigns/queue/campaign.bull.processor.ts` e `campaigns/queue/campaign-queue.module.ts` | Fila concorrente com tentativas limitadas e backoff. | Worker BullMQ ainda não entrou: precisa de chave idempotente e reconciliação de resultado externo antes de reentregar para não duplicar mensagens. |
| PetControl | `Essencial_Pet/server/src/whatsapp/whatsapp.service.ts`, `whatsapp-sender.service.ts`, `whatsapp-connection.service.ts` | Fachada desacoplada para conexão e sender. | Conexão Baileys não é canal oficial Meta; precisa ficar separada das campanhas MKP e da integração oficial Cloud API. |
| OS v4 | `app/blueprints/agenda.py`, `app/blueprints/whatsapp.py`, `app/services/whatsapp_automation.py`, `app/services/whatsapp_service.py`, `docs/PADRAO_WHATSAPP.md` | Regras operacionais de janela, tentativas, agendamento e supressão/opt-out para orientar requisitos. | Código Flask/Python, tabelas e configuração por tenant próprios; reescrita em Nest/Prisma foi necessária. |
| agendamento-main | `painel/templates/post_form.html`, `post_ver.html` e estrutura do painel Flask | Revisão/aprovação explícita antes de publicar conteúdo. | É fluxo de publicação/social, não agenda de pacientes nem WhatsApp. Só reaproveitamos o conceito de aprovação humana. |

## Mapeamento para os módulos novos

- `api/src/appointments/`: transação e advisory lock por tenant/unidade; valida unidade atribuída e paciente no escopo; rejeita sobreposição; registra auditoria.
- `api/src/uno/`: conexão por unidade, credenciais AES-GCM, token de webhook, seleção local de categorias/campos, consulta autenticada de disponibilidade como teste e persistência deduplicada dos eventos filtrados. A fonte de agenda segue nativa; nenhum evento altera Appointment ainda.
- `api/src/inbox/`: conversas/mensagens tenant/unidade, prazo SLA 15 min, distinção de ator, consentimento na saída e opt-out recebido. Não chama provedor externo.
- `api/src/campaigns/`: MKP Meta-only, público com consentimento de marketing, aprovação para `OutboxMessage` idempotente; configurações de automação iniciam como rascunho.

## Pontos que a comparação expôs

1. A base de Turismo estável ajuda na estrutura Nest, mas os campos de negócio e o escopo `storeId` não servem como domínio clínico.
2. Scheduler local não é substituto de uma fila distribuída para mensagens externas. Mensagens aceitas pelo provedor e respostas perdidas precisam de reconciliação.
3. Aprovação e envio são etapas diferentes: esta entrega prepara outbox, mas desabilita envio até o adaptador e os webhooks de status existirem.
4. Webhook Uno não tem assinatura do corpo nem identificador de entrega; usamos token aleatório validado em tempo constante, dedupe pelo recurso/payload filtrado e persistência mínima. A equipe do cliente ainda precisa testar reenvios e versões reais dos payloads.
5. O CRM Turismo e o PetControl têm diversos arquivos complementares de UI e provider que ainda devem ser revisados antes de implementar as telas e os conectores.

# Comparacao e decisoes de reaproveitamento - Fases 6 e 7

**Data:** 17/10/2026 (horario local)  
**Escopo:** comparar referencias antes de implementar IA e limites do MVP clinico.

## Fase 6 - IA operacional

| Referencia | Evidencia | Decisao |
|---|---|---|
| Imobiliaria `server/src/ia/openai.client.ts` | Cliente HTTP via `fetch`, timeout e tratamento de falhas. O orquestrador imobiliario usa tools e dados de contratos. | Adaptar o cliente HTTP e timeout; nao portar tools, prompts, dados ou funcoes de escrita. A IA clinica produz apenas rascunho textual sem executar acoes. |
| Imobiliaria `ia.service.ts`, `ia-config.service.ts` | Configuracao separada da orquestracao. | Adaptar separacao de responsabilidades. Chave cifrada pelo utilitario AES compartilhado com Uno. |
| agendamento-main | Revisao explicita antes de publicar conteudo. | Adaptar para `AiDraft`, com revisor e auditoria. A aprovacao exige consentimento e cota e somente enfileira uma mensagem. |
| CRM Turismo | Padroes gerais de estrutura e logs. | Usar como referencia organizacional sem importar logica de turismo. |

## Fase 7 - SaaS e cotas

| Referencia | Evidencia | Decisao |
|---|---|---|
| CRM Turismo e Imobiliaria `server/src/usage/usage.service.ts` | Resumo de limites; contagem acumulada e `increment()` nao representam reserva ciclica. | Usar `Subscription` e `UsageEntry` para reserva idempotente por ciclo. |
| PetControl `server/src/usage/usage.service.ts`, `limits/limits.guard.ts` | Separacao de checagem e consumo; defaults ligados a loja. | Adaptar integracao com servicos de dominio; nao herdar `storeId`, cache ou defaults que ignorem assinatura ausente. |
| Schema da clinica | `Plan`, `Subscription`, `UsageEntry`, `AuditEvent` ja cobrem os modelos necessarios. | Estender os servicos e usar migration incremental, sem tabelas duplicadas. Seed versionado com os precos propostos. |

## Limites e verificacoes

- Ledger registra aprovacao de campanhas e reserva de mensagens. Worker e reconciliacao ainda nao existem.
- Pacientes e convites usam lock por tenant/metrica, contagem e criacao na mesma transacao. Isso impede duas requisicoes concorrentes de consumir a mesma ultima vaga.
- Consentimento de Inbox, aprovacao de rascunho IA, campanha e revogacao manual bloqueiam a linha do paciente e revalidam consentimento dentro da transacao antes de inserir outbox/mensagem.
- Campanha consulta no maximo 10.001 alvos na transacao e falha explicitamente acima de 10.000; nao aprova parcialmente nem contabiliza um publico truncado.
- Nao ha endpoint para criar unidades ou ativar automacoes; cotas desses recursos ainda nao sao aplicadas por mutacao.
- `connectionLimit` e para WhatsApp. Nao existe provedor/modelo WhatsApp implementado; Uno nao entra nessa cota.
- Trial pode ser atribuido pela CLI; cobranca/renovacao, painel Superadmin e onboarding ainda faltam.
- Nao foram feitos teste real de OpenAI, avaliacao especifica de prompt injection, ensaio de custo ou revisao visual no navegador.

**Fases 8 e 9:** nao estao definidas no plano. As secoes 10 e 11 sao criterios de aprovacao e ciclo de engenharia, nao fases adicionais.

# Fase 11 — jornadas operacionais fictícias

**Data:** 19/10/2026  
**Banco:** `clinic_phase11_ops_20261019`, PostgreSQL descartável local; 30/30 migrations aplicadas do zero. O banco `clinic` e a Clínica Demo Jr não foram usados nem limpos.

As jornadas usam fixtures pequenas e aleatórias criadas pelos testes. As jornadas de API e navegador cobrem os mesmos domínios em execuções isoladas; não formam uma única sessão contínua com o mesmo paciente/tenant em todos os módulos.

| Jornada | Evidência desta fase | Resultado |
|---|---|---|
| 1. Onboarding da clínica | Playwright `platform-admin.spec.ts`; API `platform-onboarding.db.e2e-spec.ts` | Passou: Superadmin com TOTP, clínica/unidade/plano, convite local, aceite, primeira sessão administrativa e ausência de navegação global para admin clínico. |
| 2. Equipe e permissões | Playwright `phase10-admin.spec.ts`; API `phase10-security.db.e2e-spec.ts` | Passou: convite, papel/unidade, sessão revogada, recuperação assistida e bloqueio de promoção/escopo indevido. |
| 3. Pacientes e consentimento | API `tenant-isolation.db.e2e-spec.ts` | Passou: criação/edição, consentimento auditável, importação, deduplicação, isolamento tenant/unidade e arquivo XLSX inválido/fórmula recusados. |
| 4. Agenda e recepção | Playwright `appointments.spec.ts`; API `tenant-isolation.db.e2e-spec.ts` | Passou: criar, consultar, reagendar, confirmar, concluir, recursos, concorrência entre dois atendentes e bloqueio de unidade fora do escopo. |
| 5. Central de atendimentos | Playwright `dashboard.spec.ts`; API `tenant-isolation.db.e2e-spec.ts` | Passou: dashboard, filtros/lista de inbox, resumo do paciente, tarefas contextuais, navegação entre tarefa/conversa/agendamento/paciente e escopo do operador. |
| 6. Automações e canais | API `tenant-isolation.db.e2e-spec.ts`, com fakes e dry-run | Passou nos cenários exercitados: consentimento/cota/canal revalidados, opt-out, assinatura Meta, evento repetido/fora de ordem, recuperação da outbox, resposta autenticada e confirmação somente após resposta exata. Nenhum provedor foi chamado. |
| 7. NPS e follow-up | API `reports.db.e2e-spec.ts`; Playwright `reports.spec.ts` | Passou: pesquisa interna elegível, nota inválida/duplicada, tarefa de nota baixa, filtros e exportação. Planejamento não é tratado como envio. |
| 8. Relatórios e exportação | API `reports.db.e2e-spec.ts`; Playwright `reports.spec.ts` | Passou: período/unidade, agregados, CSV e auditoria, sem cruzamento de tenant; UI desktop/celular. |
| 9. Indicação e fidelidade | API `tenant-isolation.db.e2e-spec.ts`; Playwright `referrals.spec.ts` | Passou no escopo: link/lead idempotente, consentimento não inferido por clique, qualificação, aprovação humana, voucher e resgate concorrente/escopado. Benefício é apenas interno/fictício. |
| 10. Privacidade e auditoria | API `phase10-security.db.e2e-spec.ts`; Playwright `phase10-admin.spec.ts` | Passou: solicitação registrada/auditada, isolamento e evento de consentimento imutável; paciente não foi apagado. |

## Totais e regressões

- API E2E desta fase: **64/64** em oito arquivos, cada arquivo em processo separado e sem paralelismo entre arquivos.
- Regressão final `tenant-isolation.db.e2e-spec.ts` após o caso de XLSX malformado: **43/43**.
- Unitários: dashboard **2/2**; TOTP **2/2**. Total unitário: **4/4**.
- Playwright completo: **10/10**, um worker. A execução final ocorreu após as correções de interface e seletores.
- Nenhuma interrupção por infraestrutura/OOM ocorreu nas execuções finais.

Uma fixture unitária do dashboard estava sem o mock de `npsSurvey`, modelo consultado desde a Fase 9. O mock/expectativa foi atualizado e passou 2/2. Os dois primeiros seletores de browser após regiões `aria-live` foram corrigidos para mirar o diálogo/aviso local; a suíte completa final passou 10/10.

## Restrições observadas

Dados foram fictícios. Não houve WhatsApp, e-mail, cobrança, OpenAI, consulta/escrita Uno, VPS, envio externo, benchmark ou teste de carga. A operação Superadmin/convite foi local e não enviou e-mail.

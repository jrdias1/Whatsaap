# Proposta de retenção e governança de dados

**Status:** proposta para aprovação jurídica e operacional; não define prazos legais nem executa eliminação.

| Categoria | Finalidade/origem | Dependências e governança propostas | Prazo |
|---|---|---|---|
| Usuários, memberships, convites, sessões | Autenticação, autorização e auditoria operacional. | Remover acesso ao terminar vínculo; preservar evidência mínima de segurança conforme política aprovada. Tokens de recuperação são hash e expiram/consomem. | A definir conforme contrato, segurança e obrigações. |
| Pacientes e consentimentos | Relacionamento e preferências de canal/finalidade; entrada manual/importação/inbound. | Consentimento é evento auditável e imutável; correção por novo evento. Excluir/desvincular somente após análise de obrigações e relações. | A definir com clínica/controladora e jurídico. |
| Conversas e mensagens | Histórico de atendimento e prova operacional. | Fonte de auditoria para inbox; minimizar conteúdo sensível, limitar acesso, avaliar anexos e contexto enviado à IA. | A definir por finalidade e necessidade. |
| Agendamentos/procedimentos/recursos | Operação de agenda e reconciliação. | Procedimento pode revelar dado de saúde; limitar finalidade, unidade e acesso. Preservar trilha de transição sem assumir retenção indefinida. | A definir conforme obrigação e finalidade. |
| Tarefas e automações/outbox | Pendências, follow-up e entrega/reconciliação. | Evitar duplicar conteúdo de mensagens; guardar estado técnico/idempotência e suprimir/cancelar no opt-out. | A definir por tipo e evidência exigida. |
| Pesquisas, NPS e indicações | Medir experiência e executar regras consentidas. | Separar nota privada de convite público; restringir dashboards e acesso individual. | A definir; diferenciar dados identificáveis e agregados. |
| Auditorias, privacidade e segurança | Evidenciar acesso, mudança, exportação, consentimento e atendimento de direitos. | Restringir leitura, proteger contra alteração e registrar acesso sensível. Não apagar auditorias por pedido sem análise. | A definir com jurídico/segurança. |
| Arquivos importados/exportados | Entrada de dados e entrega autorizada. | Minimizar cópias, avaliar remoção temporária após processamento/entrega; logs não devem conter conteúdo ou segredo. | A definir junto ao fluxo de armazenamento, atualmente sem repositório seguro de logo. |
| Configurações e integrações | Operação por tenant/unidade; segredos cifrados. | Separação por tenant, rotação/revogação e auditoria. Remover credenciais quando integração é desligada após plano de resposta. | Enquanto necessário à integração e segundo política aprovada. |

## Regras de governança a aprovar

1. Definir finalidade, controlador/operador e base aplicável por categoria e canal.
2. Aprovar prazos por categoria, eventos que suspendem eliminação, retenção legal e procedimento de exceção.
3. Definir processo de acesso/correção/exportação/exclusão/anonimização com verificação de identidade e revisão humana.
4. Avaliar dados relacionados após remoção de identificadores; hash simples não torna dado anônimo.
5. Definir acesso Superadmin, logging, segregação, revisão periódica e atendimento a incidentes.
6. Definir minimização de mensagens/dados enviados ao provedor de IA, consentimento/base apropriada e retenção do provedor.
7. Definir expurgo de arquivos temporários, backups, logs e cópias secundárias, inclusive prazo para propagação.

Não há prazos inventados, cron de exclusão nem declaração de conformidade integral com LGPD nesta proposta.

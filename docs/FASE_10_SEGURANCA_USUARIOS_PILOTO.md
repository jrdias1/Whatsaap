# Fase 10 — segurança, usuários e preparação para piloto

**Data:** 19/10/2026 · **Estado:** concluída no escopo local da fase; não aprovada para dados reais ou produção.

## Entregas

- Inventário das skills/ferramentas em `SKILLS_E_FERRAMENTAS_AGENTE.md`; skills foram lidas e usadas como guias, não como certificação. Semgrep, OSV-Scanner e as skills opcionais ausentes não foram instalados.
- Modelo de ameaças e auditoria classificados em `SEGURANCA_MODELO_DE_AMEACAS.md` e `AUDITORIA_SEGURANCA_FASE_10.md`.
- Matriz de papel/escopo em `MATRIZ_PERMISSOES.md`.
- Administração clínica de equipe: listagem/filtros, convite, papel, unidade, status, histórico e revogação de sessão; backend impede promoção para Superadmin, restringe gerente e protege o último admin.
- Recuperação clínica assistida: reautenticação do admin, método/motivo de identidade registrados, token aleatório de 32 bytes, hash no banco, expiração de 20 min, uso único/atômico, rate limit, auditoria e revogação de sessões. Superadmin excluído do fluxo.
- Configurações tenant/unidade e tema limitado; nomes/textos permitidos, cor HEX com contraste mínimo contra branco, sem HTML/CSS/JS arbitrário ou upload de logo.
- Assistente de primeiro acesso usa dados realmente persistidos; não ativa canais ou automações externas.
- Solicitações de privacidade vinculadas a paciente/tenant com eventos históricos imutáveis e motivo/status; não executa apagamento ou anonimização.
- Migration aditiva `20261019180000_phase10_privacy_recovery_branding`; schema atual tem 30 migrations. Migrations históricas não foram editadas.
- Ensaio local `pg_dump`/`pg_restore` em base de origem/restauração descartáveis, ambas contendo 30 migrations; contagens conferidas para tenant, usuário, paciente, consentimento, agendamento, tarefa, auditoria, pedido e eventos de privacidade.
- O restore preservou os triggers de imutabilidade de `ConsentEvent` e `PrivacyRequestEvent`; no banco restaurado, tentativa de alterar o consentimento de fixture foi bloqueada pelo trigger e o valor permaneceu intacto.

## Verificações finais

| Validação | Resultado |
|---|---|
| API build | Aprovado |
| API lint | Aprovado |
| Web build | Aprovado |
| Web lint | Exit 0, avisos React de hooks/dependências permanecem |
| Prisma validate | Aprovado |
| Prisma migrate status do banco `clinic` | Schema atualizado, 30 migrations aplicadas |
| Instalação limpa | 30/30 migrations aplicadas em banco descartável |
| API PostgreSQL Fase 10 | 6/6 aprovados |
| API PostgreSQL proxy/rate limit | 4/4 aprovados; trust proxy falso por padrão e limite de login preservado |
| TOTP | 2/2 aprovados |
| E2E Superadmin/onboarding/MFA | 2/2 aprovados; MFA exigido, replay negado e provisionamento idempotente no escopo testado |
| Playwright Fase 10 | 1/1 aprovado, serial; convite/aceitação, permissões, sessão, recuperação, configuração, tema, privacidade e viewport móvel |
| Backup/restore fictício | Contagens iguais antes/depois; inclui consentimento, agendamento, tarefa, auditoria e privacidade |

O Playwright teve uma tentativa inicial apontada à base `clinic_browser_validation`, cujo schema era anterior à migration 30. Falhou antes do teste por coluna ausente. Selecionar explicitamente a base descartável atual (`clinic_phase10_e2e_20261019`) fez a execução final passar. Instalação limpa aplicada do zero em `clinic_phase10_clean_20261019` (30/30) e backup restaurado em `clinic_phase10_restore_final_20261019`; a base de desenvolvimento `clinic` não foi resetada.

Capturas de evidência: `docs/evidencias/fase10-equipe-desktop.png` e `docs/evidencias/fase10-equipe-mobile.png`. Em celular, a tabela mantém colunas legíveis numa região horizontalmente rolável, com rótulo acessível por teclado/leitor de tela.

## Limites e decisão

- Skills são instruções, não scanners; não houve pentest, scanner de dependências ou revisão independente.
- Há risco residual de token em `sessionStorage`, dependência de proxy/TLS no deploy, política de retenção/base legal, logs/monitoramento e recuperação da infraestrutura.
- Logo ainda não pode ser enviada; não existe storage seguro homologado.
- Convite real por SMTP e recuperação por canal de e-mail não foram homologados; em desenvolvimento o link/token é handoff local autorizado.
- Meta/Evolution, Uno, IA externa, cobranças e VPS não foram acessadas. Nenhuma mensagem ou e-mail externo foi enviado.
- Restore local não demonstra RPO/RTO ou recuperação de produção.

## Próximo passo recomendado

Revisão humana de privacidade/retencão, endurecimento e ensaio de infraestrutura em ambiente isolado, avaliação independente de segurança e homologação controlada de integrações. Não iniciar a Fase 11 automaticamente e não usar dados reais até aprovação apropriada.

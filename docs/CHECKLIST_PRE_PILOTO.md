# Checklist pré-piloto

**Revisão local de 20/10/2026:** as pendências da Agenda e de Campanhas recebidas após o limite de uso foram implementadas e auditadas. Registro e evidências em `REVISAO_2026-10-20.md`. Esta revisão não altera os bloqueios de piloto com dados reais e produção descritos abaixo.

## Atualização — revisão dos 48 itens — 19/10/2026

- [x] Build API/Web e lint API/Web (avisos React conhecidos no lint Web).
- [x] Prisma validate e migrate status no banco descartável (31 migrations, nenhuma nova).
- [x] E2E PostgreSQL focal 68/68; Playwright da suíte 14/14 e reexecução de regressões focadas 2/2 (execuções separadas).
- [x] Dados fictícios e sem envio externo, Uno, VPS, cobrança ou carga.
- [x] Decidir política padrão do expediente (ID 15): validação permanece opcional por unidade.
- [ ] Completar asserts funcionais individuais para os itens que o tracker marca como verificados por revisão/build ou cobertura visual geral.
- [ ] Confirmar TLS, headers/CSP do host Web, secret manager/rotação, backups, logs e throttling distribuído na produção.
- [ ] Completar leitura humana de acessibilidade e idioma antes de dados reais.

**Estado:** o produto está apto para avaliação manual interna/local com dados fictícios. Ainda não liberar piloto de cliente com dados reais nem produção.

O estado abaixo descreve validação local em 19/10/2026. Não autoriza piloto com dados reais nem produção.

**Atualização Fase 11 (19/10/2026):** journeys locais simuladas passaram (API E2E 64/64, unitários 4/4 e Playwright 10/10); instalação limpa 30/30. A aprovação integral segue bloqueada: não há resultados de Semgrep/OSV-Scanner e o papel runtime `clinic` do PostgreSQL local tem privilégios de superusuário e criação de bancos. Antes de piloto, separar papel de migração/owner do runtime, validar grants mínimos e executar scanners aprovados em ambiente com rede autorizada. Veja `FASE_11_ESTABILIZACAO_E_PILOTO_SIMULADO.md`.

## Concluídos localmente

- Gestão de equipe clínica, convite, edição de papel/unidade, ativação/desativação, revogação de sessões e histórico.
- Recuperação clínica assistida com prova operacional, token de uso único e expiração; nenhum fluxo de recuperação para Superadmin.
- Dados básicos/tema por clínica, validação de cor/contraste, unidade e progresso calculado a partir de registros salvos.
- Registro e acompanhamento auditável de solicitações de privacidade, sem eliminação automática.
- Migration aditiva aplicada no banco `clinic`; sem reset e sem alteração de migrations antigas.

## Validados tecnicamente

- API build, Web build, API lint, Prisma validate e Prisma migrate status: aprovados; Web lint termina com avisos React.
- API PostgreSQL Fase 10: 6/6; proxy/rate limit: 4/4; TOTP: 2/2; E2E Superadmin/onboarding/MFA: 2/2.
- Playwright Fase 10 serial: 1/1, incluindo convite/aceitação, isolamento, equipe, revogação, recuperação, tema, privacidade e viewport móvel.
- Instalação limpa de 30/30 migrations em `clinic_phase10_clean_20261019`; status de `clinic`: 30 migrations, schema atualizado.
- Backup/restore `pg_dump`/`pg_restore` em databases descartáveis: contagens idênticas de tenants, usuários, pacientes, consentimentos, agendamentos, tarefas, auditorias e solicitações/eventos de privacidade; triggers de imutabilidade preservados e verificados no restore.
- Dados de teste fictícios. Nenhum envio externo, e-mail, cobrança ou operação Uno.

## Pendentes de revisão humana

- Base legal, contratos controlador/operador, processo de atendimento de direitos, prazos de retenção e descarte; validar com assessoria jurídica/privacidade.
- Verificação de identidade do processo administrativo de recuperação, segregação de funções e recuperação de MFA Superadmin por runbook humano.
- Revisão independente de segurança/pentest; avaliação de XSS e estratégia do access token em `sessionStorage`.
- Revisão de logs, dados pessoais, exportações e fórmula CSV para todos os formatos.
- Avaliação dos avisos de hooks React e política de aprovação das permissões.

## Pendentes de homologação externa

- Meta WhatsApp Cloud, Evolution/Baileys, Uno e provedor IA: contrato, credenciais, assinatura, limites, callbacks e teste controlado.
- SMTP e entrega de convite/recuperação: domínio, reputação, configuração e jornada de destinatário; nenhum e-mail real foi enviado.
- Custo e limites comerciais/canais, sem alterar os preços existentes.

## Pendentes de infraestrutura

- TLS e headers no host web/gateway; CORS e proxy confiável real.
- Segredos/rotação, IAM, firewall, segmentação, observabilidade, alertas, incident response e retenção de logs.
- Backups externos criptografados, janela/RPO/RTO aprovados e restauração periódica automatizada em ambiente isolado. O ensaio local não valida produção.
- Alta disponibilidade, monitoração de Redis/PostgreSQL/worker, capacidade, deploy/migração e rollback.
- Avaliar scanners `Semgrep`/`OSV-Scanner` com política de privacidade; não estavam instalados e não foram executados.

**Decisão:** pode avançar para revisão e planejamento de piloto fictício/local. Não usar dados reais nem declarar prontidão de produção enquanto pendências acima permanecerem.

## Continuação da revisão geral — 19/10/2026

**Registro histórico de uma rodada anterior; foi supersedido pela reconciliação atual em `QA_CLAUDE_48_ACHADOS.md` e `QA_CLAUDE_FECHAMENTO_CORRECOES.md`. O anexo foi tratado conforme orientação do usuário: usar as verificações nele listadas.**
## Revalidação final após atualizar os roteiros — 19/10/2026

- A suíte Playwright completa passou **14/14**, um worker, na base descartável `clinic_browser_validation`, usando portas locais isoladas. Os seis erros da primeira rodada foram investigados; eram uma combinação de URLs/endereços do harness, seletores desatualizados, fixture Superadmin com slug fixo, jornada de convite obsoleta e um acesso MFA preenchido no mecanismo errado. Os roteiros foram alinhados ao produto atual e repetidos.
- API build/lint e Web build/lint passaram nesta rodada. O Web lint mantém avisos React de efeitos/dependências e leitura de relógio durante renderização.
- Prisma validate passou; migrate status confirmou o banco de desenvolvimento `clinic` atualizado com **31 migrations**.
- O Playwright cobriu Agenda (5), Dashboard (1), primeiro acesso/MFA (2), Equipe/Privacidade (1), Superadmin (1), Indicações (2), Relatórios/NPS (1) e visualização responsiva (1). Os 57 E2E API focais registrados nesta revisão passaram em execuções isoladas anteriores desta mesma continuação; não foram repetidos nesta última rodada.
- Registro histórico da execução anterior: 14/14 corrigiu 8/14. A reconciliação atual dos 48 itens e a decisão do expediente estão nos documentos QA; consulte-os para o estado vigente.
- Nenhuma migration ou alteração na base `clinic`; sem chamadas externas, VPS, Uno, cobranças ou carga.


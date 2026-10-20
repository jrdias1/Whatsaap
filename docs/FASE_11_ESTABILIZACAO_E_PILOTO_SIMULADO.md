# Fase 11 — estabilização e piloto operacional simulado

**Data:** 19/10/2026  
**Resultado:** validação local concluída nos itens executáveis. **A Fase 11 não está integralmente aprovada**: Semgrep e OSV-Scanner não foram executados, e o papel PostgreSQL runtime observado é superusuário no ambiente local. Não usar com dados reais nem avançar para homologação externa com base apenas nestas evidências.

## Regressão local dos 48 itens — 19/10/2026

- E2E API focais 68/68; Playwright serial 14/14.
- API/Web build e lint passaram; Prisma validate e migrate status passaram. Lint Web mantém avisos React conhecidos.
- Banco descartável `clinic_browser_validation` atualizado com 31 migrations; nenhuma migration criada.
- A revisão separa correções de código das validações funcionais. Política padrão do expediente aguarda decisão (ID 15); produção segue não aprovada.
- Detalhes: `QA_CLAUDE_48_ACHADOS.md`, `QA_CLAUDE_FECHAMENTO_CORRECOES.md` e `../Planejamento Sistema Clínica-threat-model.md`.

## Segurança e dependências

- Semgrep: ausente; nenhuma regra estática foi executada. Busca manual por sinks e revisão focal registradas em `FASE_11_SEMGREP.md`.
- OSV-Scanner: ausente; nenhuma CVE foi avaliada. `package-lock.json` foi identificado como lockfile resolvido, mas não houve consulta online nem base offline.
- Achado alto condicional: usuário da API local `clinic` tem `rolsuper=true` e `rolcreatedb=true`. Não foi encontrada configuração de papéis de produção que prove separação. Antes de piloto real, criar papel runtime sem privilégios de DDL/superusuário e papel separado para migrations; testar least privilege.
- Achado médio já conhecido: access token em `sessionStorage`, sujeito a roubo por XSS no mesmo origin.
- Upload: limite 5 MiB/um arquivo, extensão `.xlsx`, parsing ExcelJS, limite de abas/linhas/colunas e rejeição de fórmula; arquivo pequeno malformado foi testado e rejeitado. Arquivos construídos para consumo de recursos não foram testados.
- Nenhuma vulnerabilidade crítica de código foi confirmada pela revisão manual focal; sem scanner/pentest isto não significa ausência de vulnerabilidades.

## Jornadas

As dez áreas operacionais descritas em `FASE_11_JORNADAS_OPERACIONAIS.md` foram exercitadas com APIs reais contra PostgreSQL e browser local, em fixtures fictícias, sem saída externa. O fluxo completo em uma única sessão/tenant não foi executado; as suítes isolam fixtures por domínio.

## Interface

- Impeccable, Web Interface Guidelines, Vercel React e PostgreSQL/security skills foram consultadas conforme escopo.
- Foram capturados 14 screenshots desktop/mobile em `docs/evidencias/fase11-*`.
- Mensagens globais passaram a usar live region; campos do login receberam `name`/autocomplete; Playwright verificou os atributos.
- O detector Impeccable registrou 3 avisos estilísticos; detalhes e limites em `FASE_11_AUDITORIA_VISUAL.md`.
- Web lint termina com 28 avisos React, exit 0. Persistem efeitos com atualização síncrona/dependências e uma leitura de relógio durante render. Sem teste de carga ou benchmark.

## Validação final comprovada

| Verificação | Resultado |
|---|---|
| API lint | Aprovado, exit 0 |
| API build | Aprovado, exit 0 |
| Web lint | Aprovado, exit 0; 28 avisos React |
| Web build | Aprovado, exit 0 |
| Prisma validate | Aprovado |
| Prisma migrate status | Schema atualizado, 30 migrations |
| Instalação limpa | `clinic_phase11_ops_20261019`: 30/30 migrations aplicadas e status atualizado |
| API E2E | 64/64 em oito arquivos; serial entre arquivos |
| Regressão de isolamento/upload | 43/43 após adicionar arquivo XLSX pequeno malformado |
| Unitários | Dashboard 2/2; TOTP 2/2 |
| Playwright final | 10/10, 1 worker |
| Memória/servidores | Aproximadamente 1.971 MiB livres antes da rodada longa; sem OOM final; portas 3002/5173 sem listeners e sem processos Node após o Playwright |

Uma tentativa unitária inicial revelou fixture defasada do dashboard (faltava `npsSurvey` no mock). Corrigida e repetida com 2/2. A primeira rodada Playwright depois do live region encontrou dois seletores ambíguos; os seletores foram limitados a seus componentes, e a rodada completa final passou. Essas falhas intermediárias não foram de infraestrutura.

## Migrations, serviços e dados

- Não foi criada migration nesta fase. A instalação limpa desta fase usou as 30 migrations atuais.
- Nenhum reset, alteração ou limpeza foi feito na base `clinic` ou na Clínica Demo Jr.
- PostgreSQL/Redis já estavam ativos; Playwright iniciou e encerrou seus próprios servidores API/Vite. Não restaram listeners/processos Node do teste.
- Nenhum envio real, conexão externa, escrita Uno, VPS, cobrança, benchmark ou carga foi realizado.

## Decisão e pendências antes de piloto

1. Executar Semgrep local somente depois de instalação oficial e revisão de regras/flags; garantir telemetria/upload desligados.
2. Executar OSV-Scanner com base offline oficial ou pedir autorização específica para consulta de metadados.
3. Definir e comprovar `app_runtime` sem superuser/createdb, separado do owner/migrator; repetir E2E sob o papel runtime.
4. Resolver access token em `sessionStorage` ou aprovar mitigação de hosting/CSP, threat model e expiração/revogação.
5. Definir retenção/base legal, configuração proxy/TLS/CORS, segredos/rotação, observabilidade, incident response, backup externo e RPO/RTO.
6. Resolver os avisos React com regressões próprias e testar navegação/gestos em dispositivo ou leitor de tela quando adequado.
7. Continuar sem dados reais até credenciais, políticas, integração Meta/Evolution/Uno/IA, SMTP e canal passarem por homologação explícita.

Ver `FASE_11_SEMGREP.md`, `FASE_11_DEPENDENCIAS.md`, `FASE_11_AUDITORIA_VISUAL.md`, `FASE_11_JORNADAS_OPERACIONAIS.md` e `CHECKLIST_PRE_PILOTO.md`.

## Complemento visual — tipografia e legibilidade (19/10/2026)

- Web build: aprovado após os ajustes visuais.
- Playwright visual focalizado: 1/1 aprovado com um worker; capturou 16 telas fictícias em desktop/mobile e viewports efetivos equivalentes a zoom ampliado. Ver `FASE_11_AUDITORIA_VISUAL.md`.
- Impeccable detector local: `[]`; Web Interface Guidelines foram aplicadas à tipografia, foco, conteúdo longo, tabelas e acessibilidade. Não houve instalação adicional.
- Nenhum E2E operacional/API, scanner, benchmark ou jornada operacional da Fase 11 foi repetido. Nenhuma mudança de API ou migration foi feita. A base de browser dedicada recebeu as duas migrations pendentes para compatibilidade com o schema atual; o banco de desenvolvimento permaneceu intacto.
- A Fase 11 continua **sem aprovação para piloto com dados reais/produção** pelas pendências de segurança e operação listadas acima. Este complemento encerra a validação visual desta entrega; não altera aquelas pendências.
## Continuação da revisão geral — 19/10/2026

**Registro histórico de uma rodada anterior; foi supersedido pela reconciliação atual em `QA_CLAUDE_48_ACHADOS.md` e `QA_CLAUDE_FECHAMENTO_CORRECOES.md`. O anexo foi tratado conforme orientação do usuário: usar as verificações nele listadas.**
## Revalidação final após atualizar os roteiros — 19/10/2026

- A suíte Playwright completa passou **14/14**, um worker, na base descartável `clinic_browser_validation`, usando portas locais isoladas. Os seis erros da primeira rodada foram investigados; eram uma combinação de URLs/endereços do harness, seletores desatualizados, fixture Superadmin com slug fixo, jornada de convite obsoleta e um acesso MFA preenchido no mecanismo errado. Os roteiros foram alinhados ao produto atual e repetidos.
- API build/lint e Web build/lint passaram nesta rodada. O Web lint mantém avisos React de efeitos/dependências e leitura de relógio durante renderização.
- Prisma validate passou; migrate status confirmou o banco de desenvolvimento `clinic` atualizado com **31 migrations**.
- O Playwright cobriu Agenda (5), Dashboard (1), primeiro acesso/MFA (2), Equipe/Privacidade (1), Superadmin (1), Indicações (2), Relatórios/NPS (1) e visualização responsiva (1). Os 57 E2E API focais registrados nesta revisão passaram em execuções isoladas anteriores desta mesma continuação; não foram repetidos nesta última rodada.
- Registro histórico da execução anterior: 14/14 corrigiu 8/14. A reconciliação atual dos 48 itens e a decisão do expediente estão nos documentos QA; consulte-os para o estado vigente.
- Nenhuma migration ou alteração na base `clinic`; sem chamadas externas, VPS, Uno, cobranças ou carga.


# Fase 11 — auditoria visual e de interface

**Data:** 19/10/2026  
**Modo:** telas operacionais; revisão manual em Chromium, viewports de 1280 × 900 e 390 × 844. Dados usados nas telas são fixtures fictícias com sufixos aleatórios.

## Regressão responsiva dos 48 itens — 19/10/2026

- Playwright capturou telas principais nas larguras 1440, 1280, 768, 390 e 320 px, com checagem de overflow horizontal global. Agenda: `evidencias/qa48-agenda-*.png`; outras páginas: `evidencias/qa48-*.png`.
- Superadmin e agenda também foram revisados com foco/teclado e viewports emulados para zoom. Largura emulada não equivale a zoom real nem a teste em dispositivo físico.
- A suíte focada passou 14/14, serial; a revisão visual foi 1/1.
- Contraste foi amostrado; não cobre todos os estados nem substitui leitor de tela/auditoria WCAG completa.

## Skills e ferramentas

- `impeccable` 4.6.0: contexto carregado e detector executado localmente sobre `web/src/`. A versão instalada não reconheceu o subcomando `audit`; portanto, não há score formal de auditoria do Impeccable.
- `web-design-guidelines`: regras atuais consultadas na fonte oficial Vercel e aplicadas à leitura do React, formulário, feedback, navegação e estados.
- `vercel-react-best-practices`: revisão manual dos componentes de dashboard, inbox, calendário, relatórios e configurações; não executamos benchmark.
- Segurança, threat model e PostgreSQL: skills usadas como guias, não como certificações.

## Capturas produzidas

As capturas foram feitas durante a execução final do Playwright, com dados fictícios e sem tokens, senhas ou conteúdo de convite:

- Agenda: `evidencias/fase11-agenda-desktop.png`, `evidencias/fase11-agenda-mobile.png`.
- Dashboard: `evidencias/fase11-dashboard-desktop.png`.
- Atendimentos: `evidencias/fase11-atendimentos-desktop.png`, `evidencias/fase11-atendimentos-mobile.png`.
- Perfil e tarefas: `evidencias/fase11-perfil-paciente-desktop.png`, `evidencias/fase11-tarefas-desktop.png`.
- Equipe: `evidencias/fase11-equipe-desktop.png`, `evidencias/fase11-equipe-mobile.png`.
- Configurações: `evidencias/fase11-configuracoes-desktop.png`.
- Relatórios/NPS: `evidencias/fase11-relatorios-desktop.png`, `evidencias/fase11-relatorios-mobile.png`.
- Superadmin e primeiro acesso: `evidencias/fase11-superadmin-desktop.png`, `evidencias/fase11-primeiro-acesso-clinica-desktop.png`.

## Problemas e correções

### Acessibilidade

- **Corrigido:** mensagens de login/operação em `web/src/App.tsx` agora são regiões `role=status` com `aria-live=polite`; o botão de dispensar tem nome acessível.
- **Corrigido:** campos de e-mail, clínica, senha e MFA têm `name` e hints de autocomplete apropriados; regressão Playwright confirma autocomplete de usuário e senha atual.
- **Observação:** alertas e diálogos específicos já usam `role=alert`/`dialog` e nomes acessíveis; ações de agenda são botões semânticos.

### Responsividade e operação

- Agenda e relatórios renderizaram em 390 × 844 sem quebra da página. A semana mantém colunas horizontais roláveis; no celular ficam visíveis apenas parte dos dias, então a recepção precisa deslizar para acessar os demais.
- A navegação principal móvel também usa faixa horizontal rolável. É funcional, mas não oferece uma navegação compacta; avaliar uma indicação visual de rolagem em revisão futura.
- Calendário mostra grade de 24 horas com área interna rolável. A captura inicial exibe o trecho visível; ela não comprova que 24 horas cabem simultaneamente na tela.
- Os estados de criação, atualização, conflito, empty/error e no-results foram exercitados pelas jornadas; o conflito concorrente mostrou uma criação e uma rejeição.

### Detector Impeccable

O detector retornou três avisos estilísticos, sem resultado funcional: fonte Inter na página de convite/recuperação e bordas laterais nos cartões de estado da agenda e do aviso de relatório. As bordas representam status com texto e cor, então o aviso é uma recomendação visual genérica, não falha funcional/acessível comprovada. A fonte é uma decisão existente do design system.

### Performance React

Web lint terminou com exit 0 e 28 avisos React: principalmente `set-state-in-effect`/dependências de effects em telas que carregam dados, além de leitura de `Date.now()` durante render em resumo de inbox. Não houve evidência de waterfall ou lista sem limite nas jornadas focalizadas; isso não é medição de desempenho. Os avisos permanecem para correção incremental com regressão.

## Limites

- Capturas em navegador Chromium local e emulação de viewport; nenhum dispositivo físico ou leitor de tela foi usado.
- A skill Impeccable instalada não ofereceu o comando `audit`; avaliação visual/manual e detector foram usados sem inventar score.
- Não foi feita auditoria WCAG automatizada completa, teste de contraste por pixel ou teste de gesto em dispositivo touch.

## Complemento: legibilidade, tipografia e conforto visual (19/10/2026)

- **Implementado:** tokens semânticos de tipografia, camada compartilhada para Superadmin e clínica, ajustes de escala em títulos, navegação, labels, conteúdo administrativo, cartões e formulários; tokens secundários de texto agora oferecem maior contraste. Textos de consentimento no cadastro de pacientes e os separadores que apareciam corrompidos foram corrigidos.
- **Capturas Playwright:** 16 arquivos em `docs/evidencias/fase11-legibilidade-*`, com dados fictícios: Superadmin (dashboard, detalhes da clínica, equipe), clínica (dashboard, agenda, atendimentos, pacientes, relatórios e equipe), além do dashboard móvel.
- **Viewport/zoom:** desktop 1440 px (100%), viewports efetivos de 1152/960/720 px para simular área disponível de 125/150/200%, e mobile 390 × 844. Chromium headless não aplicou zoom de navegador por atalho; as larguras menores são uma aproximação do viewport CSS, não uma captura de zoom real. A 720 px a navegação responsiva recolhe o menu Superadmin e o teste verifica que ele não cobre o conteúdo.
- **Verificações automatizadas:** `visual-legibility.spec.ts` passou 1/1, com um worker. O teste verifica tamanhos computados mínimos de 14 px em abas e labels, foco após Tab, rolagem horizontal global e amostras representativas de contraste; as amostras de texto ficaram acima de 4,5:1. O build Web passou. `impeccable detect --json` nos arquivos alterados retornou `[]`.
- **Skills:** Impeccable local 4.6.0, referência `typeset` e diretrizes atuais de Web Interface Guidelines foram consultados; nenhum pacote foi instalado. A versão do Impeccable não fornece o comando `audit`, então a revisão visual e o detector local foram usados.
- **Limites:** o contraste medido cobre elementos representativos, não todos os estados/cores por varredura. Chromium emulado não substitui dispositivo físico, teste completo de leitor de tela ou auditoria WCAG automatizada. As capturas validam as telas e fixtures selecionadas, não todos os comprimentos de conteúdo possíveis.
- **Base de navegador:** a base dedicada `clinic_browser_validation` estava em 28 migrations enquanto a árvore atual tem 30; foram aplicadas nela, sem reset, somente as duas migrations pendentes (`20261019150000_phase9_reports_nps_followup` e `20261019180000_phase10_privacy_recovery_branding`). Nenhuma migration nova foi criada e a base de desenvolvimento não foi alterada.
## Continuação da revisão geral — 19/10/2026

**Registro histórico de uma rodada anterior; foi supersedido pela reconciliação atual em `QA_CLAUDE_48_ACHADOS.md` e `QA_CLAUDE_FECHAMENTO_CORRECOES.md`. O anexo foi tratado conforme orientação do usuário: usar as verificações nele listadas.**
## Revalidação final após atualizar os roteiros — 19/10/2026

- A suíte Playwright completa passou **14/14**, um worker, na base descartável `clinic_browser_validation`, usando portas locais isoladas. Os seis erros da primeira rodada foram investigados; eram uma combinação de URLs/endereços do harness, seletores desatualizados, fixture Superadmin com slug fixo, jornada de convite obsoleta e um acesso MFA preenchido no mecanismo errado. Os roteiros foram alinhados ao produto atual e repetidos.
- API build/lint e Web build/lint passaram nesta rodada. O Web lint mantém avisos React de efeitos/dependências e leitura de relógio durante renderização.
- Prisma validate passou; migrate status confirmou o banco de desenvolvimento `clinic` atualizado com **31 migrations**.
- O Playwright cobriu Agenda (5), Dashboard (1), primeiro acesso/MFA (2), Equipe/Privacidade (1), Superadmin (1), Indicações (2), Relatórios/NPS (1) e visualização responsiva (1). Os 57 E2E API focais registrados nesta revisão passaram em execuções isoladas anteriores desta mesma continuação; não foram repetidos nesta última rodada.
- Registro histórico da execução anterior: 14/14 corrigiu 8/14. A reconciliação atual dos 48 itens e a decisão do expediente estão nos documentos QA; consulte-os para o estado vigente.
- Nenhuma migration ou alteração na base `clinic`; sem chamadas externas, VPS, Uno, cobranças ou carga.


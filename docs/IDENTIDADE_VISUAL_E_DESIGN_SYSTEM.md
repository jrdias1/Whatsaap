# Identidade visual e design system — Essencial Clínicas

**Revisão:** 19/10/2026  
**Escopo deste incremento:** separar a administração global do Superadmin da operação clínica e formalizar os primeiros tokens compartilhados. A autenticação MFA, os papéis e as permissões existentes foram preservados.

**Complemento Fase 10 (19/10/2026):** configurações de tenant aceitam apenas duas cores HEX de destaque validadas para contraste contra branco e texto institucional simples. O tema clínico é carregado pelo contexto autenticado do tenant; estado de plataforma mantém a identidade Essencial. Não há upload de logo até existir armazenamento seguro. Evidências e limites em `FASE_10_SEGURANCA_USUARIOS_PILOTO.md`.

## Referências consultadas

- `docs/referencias_visuais/conceito_dashboard.svg` e `conceito_atendimentos.svg`, que definem o conceito de navegação lateral, cartões claros, fundo neutro, azul-petróleo e verde-esmeralda.
- Captura do Superadmin atual do Essencial Clínicas, usada para identificar o excesso de conteúdo numa única página e a mistura visual com o contexto de clínica.
- Captura do Superadmin do CRM Turismo, consultada como referência de navegação por áreas independentes. A identidade visual e o domínio do Turismo não foram copiados.
- Implementação disponível em `E:\Documentos\Crm Turismo programa\src\layouts\SuperAdminLayout.jsx`, `src\pages\super-admin\SADashboard.jsx` e `src\pages\super-admin\SAStores.jsx`.

## Tokens

Os SVGs do produto têm prioridade sobre as cores aproximadas nas capturas.

| Token | Valor | Uso |
|---|---|---|
| `--brand-ink` | `#132C3A` | Sidebar e texto/títulos principais |
| `--brand-ink-raised` | `#1B3B49` | Blocos elevados dentro da sidebar |
| `--brand-ink-soft` | `#214653` | Seção selecionada na navegação |
| `--brand-teal` | `#0D9488` | Ação primária, foco e seleção |
| `--brand-teal-strong` | `#087E72` | Ênfase e textos interativos |
| `--brand-teal-pale` | `#E5F5F2` | Fundo de destaques de marca |
| `--surface-page` | `#F4F7F8` | Fundo de página |
| `--surface-card` | `#FFFFFF` | Cartões e superfícies |
| `--text-primary` | `#183340` | Texto principal |
| `--text-secondary` | `#607780` | Texto auxiliar |
| `--text-muted` | `#70838C` | Metadados e legendas |
| `--border-subtle` | `#E5ECEE` | Bordas discretas |
| `--state-success` | `#087E72` | Sucesso e conexão confirmada |
| `--state-warning` | `#A65A12` | Avaliação e atenção |
| `--state-danger` | `#B64B42` | Erro, suspensão e falha |
| `--state-info` | `#365F73` | Informação neutra |

Espaçamento, raios, sombras, sidebar, altura mínima de controles e pilha tipográfica estão definidos em `web/src/design-tokens.css`. O painel administrativo consome esses valores em `web/src/platform-admin.css`; evita valores dispersos para elementos recorrentes.

## Componentes e comportamento

- **Plataforma:** sidebar azul-petróleo com navegação independente para Painel, Clínicas, Planos, Assinaturas, WhatsApp e integrações, Uso e limites, Registros e auditoria e Pendências. Em telas pequenas, a sidebar vira menu sobreposto com botão de abertura e fechamento.
- **Clínica:** mantém o shell operacional da clínica, unidades, agenda e módulos existentes. A administração global não usa o seletor de unidade nem o estado da agenda clínica.
- **Cards de estatística:** superfície branca, valor em destaque, legenda e ícone simples. Cores semânticas sempre acompanham texto.
- **Tabelas e listas:** cabeçalho discreto, bordas leves, estados com badge textual e rolagem horizontal em viewport estreita.
- **Formulários:** altura consistente, foco visível, validação nativa do navegador e rótulos explícitos.
- **Auditoria e estados:** não exibir tokens, segredos de integração, conteúdo integral de mensagens ou dados clínicos nos resumos globais.
- **Tema por tenant:** a marca da clínica pode ser configurada posteriormente no contexto operacional. Seus tokens devem ficar sob escopo do tenant e nunca herdar/aplicar-se ao `.platform-shell` global.

## Dados e limites de exibição

O painel global usa contagens e registros do banco, com escopo indicado. Os últimos 30 dias são o intervalo usado para novas clínicas e reservas de cota; avaliações próximas do fim usam os próximos sete dias. Mensagens e campanhas no ledger são reservas de cota, não confirmação de envio/entrega. Contagem de conexão inclui conexões cadastradas mesmo desconectadas; o estado individual é consultado na seção da clínica.

O produto ainda não tem cobrança recorrente homologada; não apresentar MRR, receita ou inadimplência. A listagem de clínicas retorna as 200 mais recentes, enquanto os totais são contagens globais. A integração Uno é apresentada conforme o estado salvo localmente, sem consulta ao provedor. Integrações permanecem sem operação externa.

## Próximas regras para telas novas

1. Reutilizar tokens e padrões deste documento antes de criar cor, raio, sombra ou dimensão nova.
2. Manter a diferença visual entre administração da plataforma e operação clínica sem duplicar autenticação ou regras de autorização.
3. Não criar gráficos ou indicadores que não tenham consulta e definição operacional verificáveis.
4. Projetar primeiro estados carregando, vazio e erro; garantir teclado, foco visível, contraste e layout móvel.
5. Para módulos sem endpoint global, indicar que a informação é por clínica ou deixar a seção indisponível; não simular funcionalidade.

## Aplicacao do design system clinico - 19/10/2026

O shell clinico consome os tokens existentes em web/src/design-tokens.css por meio de web/src/clinic-shell.css: azul-petroleo na navegacao, esmeralda nas acoes, superficies claras, bordas discretas e foco visivel. A inbox usa tres paineis no desktop e fluxo vertical com navegacao horizontal rotulada em viewport pequeno. A camada e parcial; as telas internas antigas ainda precisam de auditoria e uniformizacao. Evidencias geradas pelo Playwright: docs/evidencias/fase8-dashboard-desktop.png, docs/evidencias/fase8-inbox-desktop.png e docs/evidencias/fase8-inbox-mobile.png.

## Tipografia e legibilidade — complemento da Fase 11 (19/10/2026)

A escala compartilhada foi formalizada em `web/src/design-tokens.css` e aplicada pelo `web/src/legibility.css`, importado depois das telas da aplicação. A camada usa Inter (a mesma família tipográfica do CRM Turismo), com pesos 400 a 900; a navegação clínica usa rótulos de 14 px em negrito e descrições de 11 px. Preserva o azul-petróleo, o verde-esmeralda, os fundos claros e os cartões atuais.

| Papel | Token | Valor |
|---|---|---:|
| Título principal | `--type-display` | 28 px |
| Seção | `--type-section` | 20 px |
| Cartão | `--type-card-title` | 18 px |
| Corpo | `--type-body` | 16 px |
| Navegação, controle e label | `--type-ui` | 14 px |
| Metadado | `--type-meta` | 13 px |
| Indicador | `--type-metric` | 30 px |

Contraste secundário e texto auxiliar foram escurecidos para `#526A74` e `#5D727B`. O foco visível passou a 3 px, controles principais usam altura mínima entre 40 e 44 px, tabelas conservam rolagem horizontal dentro de seus painéis e conteúdo longo pode quebrar sem expandir a página. Não há zoom CSS global.

A verificação Playwright capturou o Superadmin, dashboard clínico, agenda, atendimentos, pacientes, relatórios e equipe com dados fictícios. O resultado está em `docs/evidencias/fase11-legibilidade-*`; a cobertura e as limitações da verificação estão em `FASE_11_AUDITORIA_VISUAL.md`.

## Cabeçalhos padronizados — 20/10/2026

As páginas clínicas usam um cabeçalho comum no shell: título principal, descrição curta e ação no mesmo alinhamento. A marca já aparece na navegação lateral, então não é repetida acima de cada título. O contexto `Clínica / página` permanece na barra superior junto ao seletor de unidade. Visão geral e Relatórios deixaram de renderizar títulos concorrentes; ações específicas, como exportar CSV ou abrir a agenda, permanecem junto ao conteúdo em que são usadas. O Superadmin mantém shell próprio, com a mesma escala de título e descrição.

Na revisão de 20/10, os estilos globais de `header` foram limitados à barra superior do shell. Cabeçalhos semânticos internos de cartões e painéis mantêm sua altura e espaçamento próprios, sem herdar borda, padding ou alinhamento da navegação. Relatórios usam grupos recolhíveis para separar áreas e reduzir a rolagem inicial; validação registrada em [`REVISAO_2026-10-20.md`](./REVISAO_2026-10-20.md).

Implementação: `web/src/App.tsx`, `web/src/clinic-shell.css`, `web/src/DashboardPage.tsx`, `web/src/ReportsPage.tsx` e `web/src/PlatformAdminPanel.tsx`. Registro de revisão e validação em [`REVISAO_2026-10-20.md`](./REVISAO_2026-10-20.md).
## Continuação da revisão geral — 19/10/2026

**Registro histórico de uma rodada anterior; foi supersedido pela reconciliação atual em `QA_CLAUDE_48_ACHADOS.md` e `QA_CLAUDE_FECHAMENTO_CORRECOES.md`. O anexo foi tratado conforme orientação do usuário: usar as verificações nele listadas.**
## Revalidação final após atualizar os roteiros — 19/10/2026

- A suíte Playwright completa passou **14/14**, um worker, na base descartável `clinic_browser_validation`, usando portas locais isoladas. Os seis erros da primeira rodada foram investigados; eram uma combinação de URLs/endereços do harness, seletores desatualizados, fixture Superadmin com slug fixo, jornada de convite obsoleta e um acesso MFA preenchido no mecanismo errado. Os roteiros foram alinhados ao produto atual e repetidos.
- API build/lint e Web build/lint passaram nesta rodada. O Web lint mantém avisos React de efeitos/dependências e leitura de relógio durante renderização.
- Prisma validate passou; migrate status confirmou o banco de desenvolvimento `clinic` atualizado com **31 migrations**.
- O Playwright cobriu Agenda (5), Dashboard (1), primeiro acesso/MFA (2), Equipe/Privacidade (1), Superadmin (1), Indicações (2), Relatórios/NPS (1) e visualização responsiva (1). Os 57 E2E API focais registrados nesta revisão passaram em execuções isoladas anteriores desta mesma continuação; não foram repetidos nesta última rodada.
- Registro histórico da execução anterior: 14/14 corrigiu 8/14. A reconciliação atual dos 48 itens e a decisão do expediente estão nos documentos QA; consulte-os para o estado vigente.
- Nenhuma migration ou alteração na base `clinic`; sem chamadas externas, VPS, Uno, cobranças ou carga.


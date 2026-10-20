# Fase 11 — revisão geral de telas e erros

**Data:** 19/10/2026  
**Escopo:** continuação focalizada de estabilidade, sessão, agenda, responsividade e regressão local.  
**Limitação de entrada:** o texto anexado descreve escopo e critérios, mas não inclui o relatório independente com os 48 achados numerados. O `docs/AUDIT_REPORT_FINAL.md` é uma auditoria técnica anterior, não o relatório do Claude. Por isso, este documento não inventa IDs nem declara 48/48 corrigidos.

## Resultado executivo

### Atualização de escopo e estado — 19/10/2026

O anexo recebido continha a lista de verificações usada para organizar os 48 itens; a ausência de um relatório separado numerado foi registrada apenas como histórico de entrada. O tracker `QA_CLAUDE_48_ACHADOS.md` contém agora 48 linhas, uma por verificação. O responsável confirmou que o expediente continua opcional por unidade. Após a rodada de 14/14 Playwright foram adicionadas três asserções focadas; os dois specs correspondentes passaram 2/2. Assim, há 14/14 na suíte anterior e 2/2 em reexecução separada, com 68/68 E2E API nesta rodada. Itens verificados por revisão/build estão diferenciados dos que tiveram reprodução funcional. Segurança/infraestrutura de produção continua fora da homologação local.

Corrigidos e revalidados os problemas de sessão/autorização reproduzidos e o layout de seleção de recursos do agendamento. Também foram corrigidos o uso de URLs de API incorretas nos testes Playwright com portas isoladas, a contagem do dashboard para pacientes sem unidade e a quebra mobile do importador de pacientes. O fluxo focal de agenda e a verificação visual passaram após as correções.

A revisão ampla não está integralmente aprovada: a primeira execução Playwright completa teve seis falhas em roteiros desatualizados ou limitados pelo rate limit (todas resolvidas na revalidação 14/14 abaixo); alguns módulos não foram revalidados de ponta a ponta nesta rodada; e falta o inventário numerado original para fechar os 48 itens.

## Achados verificados nesta continuação

| ID | Tela/área | Problema observado | Severidade | Causa | Correção | Teste | Estado |
|---|---|---|---|---|---|---|---|
| A | Sessão/API | Sessão válida podia ser reportada como 403 genérico e falhava até reload | P1 | Guard misturava expiração/revogação/autenticação com bloqueio de acesso | 401 para token/sessão inválidos; 403 preservado para bloqueios legítimos de tenant/papel | E2E auth 6/6; isolamento 44/44; refresh simultâneo 5/5 | Aprovado com evidência |
| B | Sessão/Web | Renovações concorrentes podiam invalidar o token compartilhado; erro de rede podia apagar estado preenchido | P1 | Falta de singleflight e tratamento demasiado amplo de falha | Refresh singleflight; tratamento limitado a códigos de autenticação; formulário mantém dados na recuperação | Playwright agenda 5/5, incluindo expiração simulada durante preenchimento | Aprovado com evidência |
| C | Agendamento | Checkboxes e nomes de recursos ficavam desalinhados e recurso necessário não era claro | P2 | Estrutura visual inadequada do seletor | Cartões/linhas com label clicável, tipo e marcação de obrigatório; erro de disponibilidade exibe motivo da API | Playwright agenda 5/5; Impeccable detect `[]` | Aprovado com evidência |
| D | Pacientes/dashboard | Paciente sem unidade preferencial não aparecia em escopo de unidade e não era contado no indicador correspondente | P1 | Filtro/contagem excluía registros sem unitId | Escopo inclui pacientes sem unidade, preservando os filtros de tenant/unidade | Dashboard unitário 2/2; busca incluída na jornada de agenda | Aprovado com evidência |
| E | Pacientes mobile | Importador causava rolagem horizontal em tela estreita | P2 | Label/controle de arquivo excedia largura disponível | Quebra e largura máxima para controle em viewport estreita | Playwright visual 1/1, incluindo 390 e 320 px | Aprovado com evidência |
| F | Inbox | Estados OPEN/WAITING_HUMAN/CLOSED eram exibidos em inglês | P3 | Ausência de mapeamento de rótulos | Rótulos em português no componente de conversa | Build Web; inspeção funcional focal | Corrigido; regressão específica ainda pendente |
| G | Textos | Strings de erro/API e teste continham mojibake | P2 | Codificação textual corrompida | Strings corrigidas em conexões, equipe e spec de primeiro acesso | Busca por padrões comuns de mojibake sem resultados nos caminhos revisados; builds | Corrigido; varredura global completa pendente |
| H | Harness Playwright | Specs chamavam API/Web nas portas padrão apesar de servidores isolados em portas alternativas | P1 para confiabilidade do teste | URLs não propagadas para chamadas diretas dos specs | Configuração central publica `PLAYWRIGHT_API_URL`/`PLAYWRIGHT_WEB_URL` a partir das portas reais | Agenda 5/5 em portas 3013/5175 | Aprovado com evidência |
| I | Canais e outros módulos | A revisão ampla solicitada não tem evidência nova completa nesta rodada | P1/P2 conforme caso | Rodada completa interrompida por falhas dos roteiros e limite do escopo recebido | Sem alteração especulativa | Suíte total 8/14; 6 falharam | Pendente |

## Autenticação e sessão

- **Causa confirmada do 403 relatado:** `TenantGuard` usava `Forbidden` para condições de sessão inválida/expirada/revogada. A semântica foi separada: autenticação inválida ou ausente retorna 401; tenant suspenso e falta real de permissão permanecem 403.
- O cliente React coordena renovação com uma única promessa, sincroniza o access token compartilhado e só renova para códigos de autenticação esperados. Rejeições 403 de autorização não acionam refresh.
- O teste de browser preenche o formulário de agendamento, troca o access token por um inválido, envia, renova e confirma o registro sem perder os dados.
- Regressões API nesta rodada: `auth.e2e-spec.ts` 6/6; `tenant-isolation.db.e2e-spec.ts` 44/44; `first-login-password.db.e2e-spec.ts` 5/5. Dashboard unitário: 2/2. Total focal API: 57 aprovações.
- Os testes usaram `clinic_browser_validation` e Redis DB 15, separados da base de desenvolvimento. Não houve escrita na base `clinic`.

## Agenda e tarefas

- Recursos na janela de criação agora aparecem juntos, com checkbox clicável e nome/tipo. A interface mostra razão retornada pela API para falha de disponibilidade; o backend segue autoridade de conflitos.
- Playwright da agenda: 5/5 — criar/reagendar/concluir, refresh com formulário preenchido, dois atendentes disputando horário, cadastro/associação de recurso e bloqueio de unidade fora do escopo.
- A contagem de dashboard agora inclui paciente sem unidade preferencial quando permitido pelo escopo.
- Expediente, tratamento completo do modal de tarefa vinculada e todos os estados de automação não foram integralmente reexecutados nesta rodada.

## Interface, idioma e acessibilidade

- A verificação visual focal passou 1/1 com viewports mobile de 390 e 320 px e checagem de overflow na tela de pacientes.
- O detector Impeccable executado nos arquivos de UI alterados retornou `[]`.
- Web build e lint passaram; lint mantém avisos React sobre efeitos/dependências e `Date.now` em renderização.
- A busca de padrões comuns de mojibake passou nos diretórios `web/src`, `api/src` e `browser-tests`; isto não equivale a revisão linguística humana linha por linha em todas as telas.
- Não foi executado zoom real do navegador em dispositivo físico nem auditoria WCAG completa com leitor de tela.

## Primeira execução Playwright ampla — diagnóstico (revalidada abaixo)

A primeira execução completa foi serializada e terminou em 8/14; as seis falhas foram corrigidas nos roteiros/harness e passaram na revalidação completa 14/14 registrada no final. O diagnóstico inicial identificou:

1. Limite de tentativas de login (HTTP 429) no primeiro acesso após muitas autenticações na mesma suíte. O rate limit não foi reduzido/desabilitado. Precisa-se de uma estratégia de fixture isolada que mantenha o controle de produção.
2. Um teste Superadmin ainda aguarda campos de login em uma jornada que não chegou à tela esperada; investigar após estabilizar isolamento/limite da suíte.
3. Fixture do teste Superadmin usa slug fixo `essencial-platform` e falhou por unicidade quando o registro já existe.
4. Teste de equipe/privacidade depende de autenticação antiga e terminou esperando o formulário de login.
5. Teste de indicações usa rótulo/fluxo de UI desatualizado.
6. Teste de relatórios usa `Relatorios` sem acento embora a UI apresente `Relatórios`.

Não foi alterado o produto para atender a seletores antigos. Esses pontos são reprovações do harness ou bloqueios de validação até confirmação individual; não são declarados como bugs funcionais resolvidos.

## Validação técnica atual

| Verificação | Resultado desta execução |
|---|---|
| API build | Aprovado |
| API lint | Aprovado |
| Web build | Aprovado |
| Web lint | Aprovado com avisos React conhecidos |
| Prisma validate | Aprovado |
| Prisma migrate status | `clinic` atualizado, 31 migrations |
| E2E API focalizados | 57/57 aprovados, em arquivos separados |
| Playwright agenda | 5/5 aprovados |
| Playwright visual mobile | 1/1 aprovado |
| Playwright completo | 8/14; 6 falhas descritas acima |

Sem migration nova. Não houve reset de bancos, VPS, Uno real, provedores externos, mensagens, cobranças, benchmarks ou carga.

## Pendências para fechamento integral

- Receber o relatório original do Claude com os 48 itens numerados; o anexo atual não inclui os itens originais.
- Aguardar o relatório original do Claude com os 48 itens numerados para mapear e aprovar cada achado sem inventar correspondências.
- Concluir validação funcional visual de Canais, Automações, IA, Integração Uno apenas local/fake, configurações, privacidade e demais perfis que não tiveram jornada completa atual.
- Completar revisão de idioma e acessibilidade de todas as telas, com evidência abrangente.

**Status:** continuação parcialmente concluída. Não aprovada como revisão integral nem como piloto com dados reais.
## Revalidação final após atualizar os roteiros — 19/10/2026

- A suíte Playwright completa passou **14/14**, um worker, na base descartável `clinic_browser_validation`, usando portas locais isoladas. Os seis erros da primeira rodada foram investigados; eram uma combinação de URLs/endereços do harness, seletores desatualizados, fixture Superadmin com slug fixo, jornada de convite obsoleta e um acesso MFA preenchido no mecanismo errado. Os roteiros foram alinhados ao produto atual e repetidos.
- API build/lint e Web build/lint passaram nesta rodada. O Web lint mantém avisos React de efeitos/dependências e leitura de relógio durante renderização.
- Prisma validate passou; migrate status confirmou o banco de desenvolvimento `clinic` atualizado com **31 migrations**.
- O Playwright cobriu Agenda (5), Dashboard (1), primeiro acesso/MFA (2), Equipe/Privacidade (1), Superadmin (1), Indicações (2), Relatórios/NPS (1) e visualização responsiva (1). Os 57 E2E API focais registrados nesta revisão passaram em execuções isoladas anteriores desta mesma continuação; não foram repetidos nesta última rodada.
- Registro histórico da execução anterior: 14/14 corrigiu 8/14. A reconciliação atual dos 48 itens e a decisão do expediente estão nos documentos QA; consulte-os para o estado vigente.
- Nenhuma migration ou alteração na base `clinic`; sem chamadas externas, VPS, Uno, cobranças ou carga.

## Reconciliação dos 48 itens do anexo — 19/10/2026

O anexo contém as verificações usadas como os 48 itens, conforme orientação do usuário. O tracker agora registra uma linha individual por ID; não se presume que o relato independente prove que o problema permanecia na versão atual.

- API/Web build, API/Web lint, Prisma validate e status de migrations foram executados nesta continuação.
- E2E API focais: 68/68 aprovados no banco descartável. Playwright, um worker: 14/14 aprovados.
- A execução inicial encontrou fixtures que concluíam atendimentos futuros e expectativas antigas para status técnicos/401. A regra de conclusão futura foi mantida; fixtures e expectativas foram alinhados e as execuções repetidas passaram.
- A matriz diferencia testes funcionais de revisão estática. ID 15 depende de decisão; a revisão total e o piloto com dados reais não estão aprovados.
- Ver `QA_CLAUDE_48_ACHADOS.md` e `QA_CLAUDE_FECHAMENTO_CORRECOES.md`.


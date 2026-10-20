# Fechamento das correções — avaliação independente de 48 achados

**Data:** 19/10/2026  
**Escopo:** reconciliação dos 48 itens do anexo, correções locais e regressões após a continuação da Fase 11.  
**Conclusão:** a revisão local dos 48 itens foi concluída item a item; cada linha tem disposição final, correção ou justificativa, evidência e resultado. A política do expediente foi definida como opcional por unidade. As evidências funcionais, visuais e de revisão de código estão diferenciadas; itens sem assert isolada não são apresentados como bugs reproduzidos individualmente. Isto fecha o escopo local desta tarefa, sem equivaler a um pentest ou homologação de produção com dados reais. O quadro detalhado está em [`QA_CLAUDE_48_ACHADOS.md`](QA_CLAUDE_48_ACHADOS.md).

### Revalidação adicional

Após o fechamento inicial, foram incluídas asserções Playwright específicas para o aviso de possível paciente duplicado, validação de resposta vazia e erro local de configuração da IA. `dashboard.spec.ts` e `visual-legibility.spec.ts` passaram novamente: **2/2**. Somados à suíte focada anteriormente aprovada (14/14), são 16 aprovações de teste navegador nas execuções registradas; os números pertencem a execuções separadas, não a uma única suíte de 16 casos. Não foram feitas chamadas a provedores externos. Os detalhes dos itens 4, 7 e 48 foram atualizados no rastreador.

## Resultado por item

| ID | Situação e causa/correção | Arquivo/componente | Teste/evidência | Risco residual |
|---:|---|---|---|---|
| 1 | Sessão inválida usa 401; autorização insuficiente continua 403 | `api/src/security/tenant.guard.ts`, cliente HTTP | E2E auth/tenant e refresh no Playwright | Topologia produção não verificada |
| 2 | Datas passadas rejeitadas em disponibilidade e transação | `api/src/appointments/appointments.service.ts` | Novo teste PostgreSQL de passado/futuro | Fuso/relógio de produção precisam ser coerentes |
| 3 | Política do expediente permanece no servidor e indica motivo | Agenda/API de expediente | E2E de horários de unidade | Casos de feriado não foram revalidados nesta rodada |
| 4 | Duplicidade agora alerta dentro da clínica e permite continuar sem merge | `web/src/PatientsPanel.tsx` | Playwright tenta cadastrar telefone existente e verifica o alerta sem criar duplicata | Nenhum |
| 5 | Denominador do dashboard esclarece pacientes sem unidade | `api/src/dashboard`, `web/src/DashboardPage.tsx` | E2E dashboard e Playwright | Sem fixture de comparação entre clínicas no dashboard nesta jornada |
| 6 | Campanha fora da vigência tem erro específico | Serviço/UI de indicações | Playwright de indicações | Data de início futura não isolada em teste |
| 7 | IA só aparece ativa com confirmação da API; configuração falha com aviso | `web/src/App.tsx`, Inbox | Playwright intercepta falha local de configuração e verifica aviso | Provedor real não testado; nenhuma chamada externa feita |
| 8 | “Revisar” navega e foca seção de identidade | `web/src/ClinicSettingsPage.tsx` | Revisão/build | Clique sem asserção dedicada |
| 9 | Erro de validação e sugestão de contraste têm texto compreensível | `web/src/ClinicSettingsPage.tsx` | Revisão/build | Nenhuma tentativa inválida isolada |
| 10 | Semana pode ser percorrida por teclado/rolagem em larguras-alvo | `web/src/CalendarPage.tsx`, CSS | Screenshot e overflow Playwright | Dispositivo físico não avaliado |
| 11 | Data de referência usa calendário local e persiste preferências não sensíveis | `web/src/CalendarPage.tsx` | Revisão e jornada visual | Hora inicial sem assert próprio |
| 12 | Pausar/ativar/editar aparecem agrupados com explicação | `web/src/ReferralsPanel.tsx` | Playwright indicações | Regra de edição de ativa continua restrita |
| 13 | Consulta disponível limpa erro anterior | `web/src/CalendarPage.tsx` | Playwright agenda | Erro anterior específico não foi induzido pelo browser |
| 14 | Formulário de campanha limpa após sucesso, não antes | `web/src/App.tsx` | Playwright indicações e revisão | Limpeza sem assert própria |
| 15 | Padrão de validação de expediente não alterado | Configuração da unidade | Revisão da política atual | **Decisão de negócio pendente** |
| 16 | Avisos ficam visíveis durante rolagem | CSS global | Screenshots responsivos | Todas as mensagens/combinações não foram simuladas |
| 17 | Scroll da página é salvo/restaurado por tela | `web/src/App.tsx` | Revisão/build | Navegação ida/volta não assertada |
| 18 | Recursos estão alinhados e são selecionáveis pelo label | seletor de recurso na Agenda | Playwright cria agendamento com profissional/sala | Equipamento não coberto nessa jornada |
| 19 | Labels e controles revisados em formulários afetados; mensagem usa textarea | componentes de formulários e Inbox | Build, lint e visual | Cobertura visual não valida cada formulário |
| 20 | Botão de histórico não divide palavra | CSS de tarefas | Revisão/build | Página de tarefas não teve screenshot dedicado |
| 21 | Título repetido removido | `web/src/App.tsx`, `web/src/ReportsPage.tsx` | Playwright relatório | — |
| 22 | Ações de relatório usam estilo compartilhado | `web/src/ReportsPage.tsx` | Playwright visual e relatório | — |
| 23 | Estado sem paciente selecionado e botões estão claros | `web/src/PatientsPanel.tsx` | Screenshot mobile/desktop | Estado vazio sem assert específico |
| 24 | Seletor de cor tem contexto/label | `web/src/PatientsPanel.tsx` | Revisão/build | Controle não operado no browser |
| 25 | Página Pacientes não causa overflow horizontal global | CSS/componentes de Pacientes | Playwright 390/320 px | Teste focou viewport Chromium emulado |
| 26 | Tipo de benefício e checkboxes alinhados | `web/src/ReferralsPanel.tsx`, CSS | Playwright indicações | Alinhamento do checkbox sem assert geométrica |
| 27 | Tabela Equipe tem região rolável acessível | `web/src/TeamManagementPage.tsx` | Playwright equipe e viewport móvel | Leitor de tela não usado |
| 28 | Campos de token Uno têm labels e instrução de retenção | formulário Uno em `web/src/App.tsx` | Revisão/build | Não houve conexão Uno |
| 29 | Campo de solicitação de privacidade tem label | `web/src/PrivacyRequestsPage.tsx` | Playwright Fase 10 | — |
| 30 | Gênero “sala” corrigido | `web/src/ResourcesSchedulePanel.tsx` | Revisão/build | — |
| 31 | Separadores e strings UTF-8 corrigidos | Agenda e `api/test/phase10-security.db.e2e-spec.ts` | Playwright recursos e busca de mojibake | Busca de mojibake não substitui revisão humana integral |
| 32 | Status comuns traduzidos para pt-BR | `web/src/status-labels.ts` e páginas | Playwright nas telas cobertas | Uma revisão humana de todas as mensagens ainda não foi feita |
| 33 | Limites e números formatados para pt-BR | `web/src/App.tsx` / painel de plano | Playwright Superadmin/relatórios | Nem todo limite foi assertado |
| 34 | Campos `startDate`/`endDate` mapeados para labels em português | formulário Uno | Revisão/build | Sem integração real |
| 35 | Timestamps e números de relatório localizados | `web/src/ReportsPage.tsx` | Playwright relatório e exportação | — |
| 36 | Termos técnicos revistos nas áreas identificadas | Inbox, Relatórios, Superadmin, Agenda | busca de fonte + build | Busca limitada a interface alterada |
| 37 | Ação indica fila sem envio externo | `web/src/InboxConversationPanel.tsx` | Revisão/build | Ação não envia mensagem externa |
| 38 | Campo identificado como “Versão da Graph API” | canais em `web/src/App.tsx` | Revisão/build | Sem integração externa |
| 39 | Texto voltado ao cliente usa “clínica” e erro explica validação | configurações, mensagens de UI | Busca/build | Backend pode preservar códigos úteis a suporte |
| 40 | Mensagem de supressão tem plural correto | componentes de automação | Revisão/build | Quantidades variadas não foram exercitadas |
| 41 | Histórico do agendamento traduz criação/status/reagendamento | `web/src/CalendarPage.tsx` | Playwright reagendamento/histórico | Tipos raros de auditoria não cobertos |
| 42 | Origem é apresentada como “Agenda nativa” | detalhes do agendamento | Revisão/build | Sem assert isolada |
| 43 | Backend rejeita conclusão futura sem emitir efeitos e aceita passada | `api/src/appointments/appointments.service.ts` | Novo E2E PostgreSQL; ciclo Playwright | Regra usa início do atendimento; regra de horário final não foi solicitada |
| 44 | Confirmação aparece no modal após sucesso transacional | `web/src/CalendarPage.tsx` | Playwright confirma/conclui | — |
| 45 | Preferências de agenda não sensíveis persistem em `sessionStorage` | `web/src/CalendarPage.tsx` | Revisão e navegação | Reload não foi uma asserção explícita |
| 46 | Inbox foi revisada em desktop/mobile e mantém overflow contido | Inbox e CSS | Teste visual responsivo | Nem todas as ações foram abertas a 320 px |
| 47 | Falha/configuração ausente de IA mostra retorno local | Inbox e `web/src/App.tsx` | Playwright, falha de API simulada localmente | Nenhuma IA externa foi chamada |
| 48 | Resposta rápida vazia mostra validação pt-BR e API valida | `web/src/InboxConversationPanel.tsx`, API Inbox | Playwright verifica texto de validação do campo vazio | Nenhuma mensagem enviada |

## Correções implementadas nesta continuação

- O backend rejeita criação/disponibilidade passada e conclusão futura; a checagem de conclusão também é atômica na atualização.
- Os fixtures de automação/indicação foram ajustados para completar atendimentos realmente passados; a regra de produção não foi enfraquecida.
- A UI removeu termos internos identificados em campanhas, Relatórios, Superadmin, mensagens, campos Uno e status.
- O Playwright agora verifica que usuário operador não recebe agendamento de uma unidade restrita usando registro fictício daquela unidade.
- Os screenshots da agenda incluem larguras 1440, 1280, 768, 390 e 320 px.
- Quatro verificações com fixture incompatível com a nova regra (ou expectativa de enum/403 em vez de estado traduzido/401) foram corrigidas nos testes, sem mudar a autorização da aplicação.

## Validação efetivamente executada

- API build e Web build: aprovados após os ajustes de produto/UI anteriores às últimas atualizações documentais.
- API lint e Web lint: aprovados; Web mantém avisos React de efeitos/dependências e `Date.now`/`Date` em renderização.
- Prisma validate: aprovado.
- Prisma migrate status: `clinic_browser_validation` atualizado com 31 migrations; nenhuma migration criada nesta tarefa.
- API E2E serial: 45/45 em `tenant-isolation.db.e2e-spec.ts` e 23/23 em auth/dashboard/primeiro acesso/segurança/relatórios: **68/68**.
- Playwright, um worker e portas locais isoladas: **14/14** (Agenda, Dashboard, primeiro acesso/MFA, Equipe/Privacidade, Superadmin, Indicações, Relatórios e visualização).
- As primeiras execuções tiveram quatro falhas E2E e três falhas Playwright por conclusão futura em fixtures, expectativas com status técnico e assert incorreta sobre paciente de unidade permitida. Foram analisadas, os testes foram alinhados aos contratos válidos e as execuções repetidas passaram.
- Capturas em `docs/evidencias/qa48-agenda-*.png` e `docs/evidencias/qa48-*.png`, dados fictícios. Viewports reduzidos são emulação de largura, não zoom real.

## Pendências e riscos impeditivos para piloto real

- Confirmar decisão do ID 15 sobre habilitar validação de expediente por padrão em novas unidades.
- Adicionar asserts específicos para aviso de duplicidade, estado de IA não configurada, validação de resposta rápida vazia e datas futuras de campanha.
- Completar revisão manual de português/acessibilidade de cada estado de cada tela; Playwright e busca de mojibake não substituem leitura humana nem leitor de tela.
- Confirmar TLS, CSP/headers do host Web, secret manager/rotação, backups, logs e limites compartilhados no ambiente de produção. Nada disso foi verificado em VPS.
- Considerar contenção do cliente Prisma `unscoped` e avaliação futura de RLS sem alteração de schema nesta tarefa.
- Integrações reais, Uno, disparo Meta/Evolution, IA externa, cobrança, teste de carga e implantação continuam fora do escopo.

**Decisão de entrega:** revisão dos 48 itens concluída no escopo local, com níveis de evidência discriminados no tracker. Prontidão para piloto com dados reais/produção **não aprovada** enquanto as pendências de infraestrutura, integração e segurança do checklist pré-piloto continuarem.

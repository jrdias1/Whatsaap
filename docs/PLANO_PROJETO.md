# Plano detalhado — SaaS de atendimento e gestão de clínicas

**Reconciliação das mudanças de 20/10/2026:** veja a [revisão diária](./REVISAO_2026-10-20.md) para o que foi retomado e verificado; a [matriz funcional](./MATRIZ_FUNCIONALIDADES.md) para o estado por módulo; e o [registro de implementação](./REGISTRO_IMPLEMENTACAO.md) para os detalhes técnicos. Esses documentos também apontam para a Fase 8 (Inbox/campanhas), Identidade Visual (cabeçalhos) e Integridade dos Textos.

## Fase 11 — regressão de interface e segurança (19/10/2026)

A revisão dos 48 itens foi organizada em `QA_CLAUDE_48_ACHADOS.md` e validada localmente com 68 E2E API e 14 Playwright. Builds, lint, Prisma validate e migration status passaram. Ainda não liberar dados reais: falta decisão sobre expediente, alguns testes individuais e validação da infraestrutura de produção. Ver `QA_CLAUDE_FECHAMENTO_CORRECOES.md` e o modelo de ameaças na raiz do projeto.

**Atualização:** decisão ID 15 registrada como opcional por unidade. Novas verificações Playwright focadas de paciente duplicado, erro local de IA e resposta rápida vazia passaram 2/2 (em execução separada da suíte 14/14). Ver evidências/resultados no rastreador. A validação continua local; pendências de infraestrutura e segurança de produção permanecem no checklist pré-piloto.

**Administração global de equipe (19/10/2026):** o painel Superadmin agora tem aba Equipe por clínica para convidar Administrador/Gerente/Operador, editar nome/papel/unidades/status, revogar sessões e emitir recuperação de senha assistida. Não atribui papel Superadmin a membros da clínica; a reautenticação usa a senha da conta global autenticada. Builds API/Web aprovados; E2E desta alteração ainda não executado. Sem migration.

**Fase 11 — fechamento local (19/10/2026):** estabilização e piloto operacional simulado concluídos para os itens verificáveis localmente. PostgreSQL descartável recebeu 30/30 migrations; API E2E 64/64 (o arquivo de isolamento, com regressão de XLSX inválido, foi repetido e passou 43/43); testes unitários 4/4; Playwright serial 10/10. API/Web build, API lint e Prisma validate/status passaram; Web lint terminou sem erros, com 28 avisos React. Não há nova migration nem integração externa. **Fase 11 não integralmente aprovada:** Semgrep e OSV-Scanner não estão instalados e não foram executados; a conexão local da API usa papel PostgreSQL superusuário/criador de bancos e precisa de desenho least-privilege antes de piloto. Veja [relatório de estabilização](./FASE_11_ESTABILIZACAO_E_PILOTO_SIMULADO.md), [jornadas](./FASE_11_JORNADAS_OPERACIONAIS.md), [Semgrep](./FASE_11_SEMGREP.md), [dependências](./FASE_11_DEPENDENCIAS.md) e [checklist pré-piloto](./CHECKLIST_PRE_PILOTO.md). Sem VPS, dados reais, envios, cobrança, Uno ou carga.

**Fase 10 — estado final local (19/10/2026):** gestão clínica de usuários, recuperação administrativa limitada, personalização tenant/unidade, progresso de onboarding e solicitações auditáveis de privacidade implementados. Migration aditiva 30 aplicada sem reset; instalação limpa 30/30. API E2E 6/6, proxy/rate limit 4/4, TOTP 2/2, Playwright focado 1/1; backup/restore em bancos descartáveis preservou contagens de dados fictícios. API/Web builds e API lint aprovados; Web lint exit 0 com avisos React. Skills e ferramentas em `docs/SKILLS_E_FERRAMENTAS_AGENTE.md`; auditoria e riscos em `docs/AUDITORIA_SEGURANCA_FASE_10.md`, modelo de ameaças, matriz de permissões, governança/retencão e checklist pré-piloto. Sem uso real, VPS, mensagens, e-mail, cobrança ou Uno. **Não aprovada para dados reais/produção**: ver [fechamento da Fase 10](./FASE_10_SEGURANCA_USUARIOS_PILOTO.md).
**Fase 8 — estado final (19/10/2026):** concluída no escopo local definido: dashboard clínico com escopo tenant/unidade, inbox componentizada e responsiva, links contextuais entre tarefas, pacientes, conversas e agendamentos, e proteção contra respostas de mensagens obsoletas. Build API/Web, lint API, testes unitários do dashboard 2/2, PostgreSQL E2E do dashboard 2/2, Playwright integral serial 8/8, Prisma validate e migrate status (28 migrations) aprovados. Web lint terminou com avisos React existentes. Não houve migration. Os 52 E2E API, TOTP 2/2 e instalação limpa 28/28 são resultados anteriores, não repetidos nesta fase. Sem envios externos, consulta/escrita Uno, VPS ou cobrança. Evidências, limites e backlog em [FASE_8_CONSOLIDACAO_OPERACIONAL.md](./FASE_8_CONSOLIDACAO_OPERACIONAL.md).


**Fase 9 - estado final local (19/10/2026):** relatorios agregados, CSV auditado, NPS privado separado da pesquisa de cinco opcoes e tarefas internas de follow-up implementados. API E2E PostgreSQL 4/4, Playwright focado 1/1, builds API/Web, lint API, Prisma validate, migrate status com 29 migrations e instalacao limpa em duas bases 29/29 aprovados; Web lint exit 0 com avisos React. NPS permanece desligado por padrao e so planeja registros internos; nao envia mensagens. Detalhes, semantica, limitacoes e evidencias em [FASE_9_RELATORIOS_NPS_FOLLOWUP.md](./FASE_9_RELATORIOS_NPS_FOLLOWUP.md).
**Status:** Fases 1–7 têm implementação incremental local. Fase 6 oferece rascunhos IA com aprovação humana; fase 7 aplica limites configurados via ledger e apresenta consumo. São MVPs ainda sem provedor real de WhatsApp, reagendamento Uno, renovação/cobrança automática, provisionamento comercial completo, recuperação de desastres ensaiada ou aprovação para produção. Não usar com dados reais antes das pendências de segurança, privacidade, retenção e homologação externa.  
**Data da revisao:** 19/10/2026.
**Objetivo desta revisão:** alinhar cada fase ao código e aos padrões existentes nos sistemas da Essencial, separando reaproveitamento, refatoração e criação necessária. Estado e evidências em [REGISTRO_IMPLEMENTACAO.md](./REGISTRO_IMPLEMENTACAO.md); comparações: [fases 1–2](./COMPARACAO_AUTH_E_USUARIOS.md), [fases 3–5](./COMPARACAO_FASES_3_A_5.md) e [fases 6–7](./COMPARACAO_FASES_6_A_7.md).

**Matriz atualizada:** [MATRIZ_FUNCIONALIDADES.md](./MATRIZ_FUNCIONALIDADES.md).

**Estado da agenda nativa (19/10/2026):** recursos por unidade (profissionais, salas e equipamentos), requisitos por procedimento, filtros, expediente semanal com intervalos, excecoes e bloqueios. API E2E 50/50; Playwright focado 1/1; migration 27 aplicada e instalacao limpa 27/27. A suite completa Playwright posterior da Fase 8 passou 8/8; o resultado detalhado esta no resumo inicial e no relatorio da Fase 8. Nenhuma consulta/escrita Uno ou envio externo.

**Incremento Superadmin e onboarding (19/10/2026):** código implementado para painel global, provisionamento transacional/idempotente de tenant + primeira unidade + assinatura de avaliação + convite local, MFA TOTP para conta Superadmin, controles de status/limites/plano e auditoria. Migration 28 aplicada na base de desenvolvimento; instalação limpa descartável validada em 28/28. Build completo da API e build Web aprovados. A regressão de provisionamento passou 2/2: código do plano armazenado em minúsculas foi aceito pela API que normaliza a entrada para maiúsculas; plano inexistente/desativado continua rejeitado e idempotência preservada. Playwright focado Superadmin 1/1 aprovado, incluindo MFA, clínica/unidade/plano, convite local, aceite, primeiro login e ausência da navegação Superadmin para o administrador da clínica. Os 52/52 E2E API e 2/2 TOTP anteriores permanecem como resultados prévios; a regressão focada foi executada adicionalmente. Integração externa e cobrança continuam inexistentes.

**Atualização visual do Superadmin (19/10/2026):** a administração global agora possui shell e navegação próprios, separada do contexto de unidade/agenda da clínica. Cadastro foi movido para Clínicas; dashboard, planos, assinaturas, integrações, uso, auditoria e pendências usam dados/endpoints existentes, com novos agregados explícitos no endpoint global. Builds da API e Web aprovados após as mudanças. Não foi executada automação visual nesta revisão; sem migration, chamadas externas ou alteração de permissões. Tokens e referências em [IDENTIDADE_VISUAL_E_DESIGN_SYSTEM.md](./IDENTIDADE_VISUAL_E_DESIGN_SYSTEM.md).

**Acessos administrativos simplificados (19/10/2026):** o onboarding do Superadmin permite definir senha inicial do primeiro administrador; a aba Equipe cria usuários sem convite, edita papel/unidades/status e redefine senha diretamente. Novas contas e contas redefinidas recebem uma pergunta opcional para trocar a senha no primeiro acesso, com página Minha conta para troca posterior. E-mail já existente pode ser vinculado a outra clínica preservando nome/senha; redefinição afeta a conta global e encerra todas as sessões. Alterações do Superadmin dependem da sessão autenticada com MFA no login e continuam auditadas, sem pedir senha repetidamente. Migration 31 aditiva aplicada ao PostgreSQL local; builds API/Web aprovados. Testes automatizados ainda não foram executados neste incremento.


## 1. Síntese da proposta

Construir um SaaS multiempresa para clínicas, com CRM operacional, integração de agenda à Uno por unidade quando autorizada, atendimento por WhatsApp, campanhas oficiais, automações por procedimento e IA com histórico persistido e transferência para equipe humana. Cada empresa terá suas unidades, usuários, identidade, políticas de comunicação, procedimentos e automações. A especificação do módulo está em [MODULO_INTEGRACAO_UNO.md](./MODULO_INTEGRACAO_UNO.md).

A Uno já é usada pelo cliente e será uma integração importante para reduzir recadastro. A agenda pode ser operada pela Uno (fonte autoritativa por unidade) ou pelo módulo nativo, mas não pelos dois como fontes mestres simultâneas.

O produto deve nascer modular e configurável por empresa, com agenda e atendimento completos como base; depois automações e campanhas; em seguida IA mais capaz. Indicação converte no primeiro agendamento quando o estado for `PAID` ou `COMPLETED`; voucher expira 90 dias após emissão, com aprovação humana antes de concessão.

## 2. O que as respostas decidiram

- **Produto:** SaaS multiempresa, com superadmin da plataforma, administrador da empresa e operadores; incorporar papel de gerente para restringir operação a unidades específicas.
- **Agenda:** o SaaS terá fluxo/calendário e poderá operar integrado à Uno; a fonte de verdade será escolhida por unidade. A agenda nativa fica como alternativa para unidades sem Uno.
- **Integração Uno:** agenda nativa fica ativa por padrão. O administrador configura conexão, categorias/eventos e campos processados; mudar a fonte para Uno só após testes das permissões, webhooks e operações necessárias e confirmação do administrador. Checkboxes internos não concedem acesso externo.
- **Mensageria:** solução híbrida. A aplicação oferecerá Meta WhatsApp Cloud API e Evolution; cada integração deve ser identificada corretamente como oficial (Cloud API) ou conexão não oficial via WhatsApp Web/Baileys.
- **Campanhas MKP:** somente canal oficial da Meta.
- **Demais mensagens:** provedor configurável pelo cliente, dentro das opções permitidas por categoria e política do produto.
- **Automações por procedimento:** a empresa configura a duração do efeito do procedimento e quantos dias antes do fim deve iniciar contato. Exemplo dado: duração de 10 dias, aviso no 8º. Os exemplos de 18, 20 e 280 dias não são regras fixas.
- **IA:** no piloto, conversas e ações propostas pela IA passam por aprovação humana antes do envio/execução. Evolução para respostas automáticas exige definir intents pré-aprovadas, limites e exceções. Manter histórico de conversas persistido.
- **Marca:** personalização por empresa (nome, marca e demais configurações visuais/editoriais compatíveis com o produto).
- **Termos/orientações:** conteúdo configurado/aprovado pela empresa cliente antes de uso.
- **Fidelidade e indicação:** clique cria indicação pendente; no primeiro agendamento do indicado, `PAID` ou `COMPLETED` converte a indicação. Autoindicação é barrada por CPF ou telefone coincidente, quando o dado existir e seu uso estiver autorizado. Voucher expira em 90 dias após emissão. A recompensa exige aprovação humana.
- **Consentimento e opt-out:** salvar evidência de autorização por canal e categoria/finalidade; aceitar palavras de saída; bloquear proativamente campanhas/recorrências para opt-out e registrar o motivo de supressão.
- **Planos comerciais iniciais:** Starter R$97 (500 pacientes, 1.000 mensagens/ciclo, 1 usuário); Profissional R$197 (1.500 pacientes, 3.000 mensagens/ciclo, 3 usuários); Enterprise R$397 (sem limite comercial de pacientes, 10.000 mensagens/ciclo, 10 usuários). Preços e custos absorvidos são proposta, sujeitos a validação de margem.
- **Privacidade:** proposta operacional clinic=Controladora, Essencial=Operadora; anonimização em pedidos de exclusão precisa de avaliação, não será implementada como simples hash de nome/CPF.
- **Instagram:** se apropriado, a automação pode sugerir que a pessoa compartilhe sua experiência e marque a empresa, como fluxo separado de recompensa.
- **Fluxo dos robôs atuais e regras completas de indicação:** ainda precisam ser levantados.

## 3. Pesquisa e limites de integração

O cliente confirmou que quer integrar a Uno para reduzir recadastro. A documentação pública confirma consulta de horários, criação de leads/agendamentos e webhooks de agenda/vendas; não comprova importação histórica, leitura detalhada de sessões/saldo ou cancelamento/reagendamento dedicado. Fontes e especificação estão em [MODULO_INTEGRACAO_UNO.md](./MODULO_INTEGRACAO_UNO.md).

O repositório da Evolution documenta suporte a conexão WhatsApp por Baileys e também a WhatsApp Cloud API. Isso significa que “Evolution” pode nomear o gateway que unifica integrações, mas não torna a conexão Baileys oficial. A arquitetura deve tratar `Meta Cloud API` e `Evolution/Baileys` como provedores/modos distintos, com estado, credenciais, limitações e rotas explicitamente identificados. Validar versão instalada, endpoints e comportamento numa prova técnica antes da implementação. Fontes: [Evolution API](https://github.com/evolution-foundation/evolution-api) e [documentação Cloud API da Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

O CRM Turismo local registra Evolution API 2.3.7. Não assumir que essa versão, payloads ou recursos correspondem ao estado atual. O MKP continua preso ao canal Meta oficial conforme decisão do cliente, mesmo que a Evolution permita configurar Cloud API por trás dela.

## 4. Hierarquia e isolamento de acesso recomendados

“Ver tudo” é aplicado por nível. O administrador da clínica fica restrito ao próprio tenant. Por decisão do produto, o Superadmin pode acessar todos os tenants e seus dados, com auditoria de leituras/alterações sensíveis.

| Papel | Alcance padrão | Ações principais |
|---|---|---|
| **Superadmin da plataforma** | Todos os tenants e dados, incluindo dados de paciente, conforme decisão do produto. Acesso e alterações sensíveis são auditados. | Criar/suspender tenants, planos/limites, saúde de integração, suporte, auditoria técnica e acesso global administrativo. |
| **Administrador da empresa** | Toda a própria empresa, todas as unidades dela. | Configurar unidades, equipe, permissões, agenda, integrações, templates, consentimento, automações, campanhas e relatórios do tenant. Não vê outros tenants. |
| **Gerente de unidade** | Unidade(s) explicitamente atribuídas. | Gerenciar agenda, fila, distribuição de pacientes/conversas, operadores e relatórios locais; aprovar operações conforme permissões concedidas. |
| **Operador** | Unidade(s) atribuídas e dados necessários ao trabalho; conversas/pacientes atribuídos ou da fila compartilhada, conforme configuração da clínica. | Atender, cadastrar/atualizar, reagendar, executar tarefas e registrar resultado. Acesso a CPF/dados sensíveis e ações irreversíveis deve ser granular. |

### Regras para não confundir acesso

- O isolamento por **tenant** é sempre obrigatório no backend. O administrador de tenant só opera sua própria empresa.
- Unidade é uma segunda dimensão de escopo. Gerente/operador só consultam unidades atribuídas.
- “Operador vê apenas os dados dele” é configurável, mas não deve significar automaticamente que um atendente não consegue pegar conversas da fila da unidade. A clínica escolhe entre fila compartilhada, atribuição exclusiva ou modelo misto, com registro de quem acessou/assumiu cada atendimento.
- Papéis definem permissões; escopo de registro filtra tenant/unidade/atribuição. São controles diferentes e ambos são necessários.
- A tela não é controle de segurança. Cada endpoint valida tenant, unidade, papel, permissão e atribuição.
- Não implementar o acesso do Superadmin como bypass oculto. Conforme decisão do produto, ele terá acesso global; cada leitura/alteração sensível deve ser auditada com ator, tenant, alvo, horário e ação, além de autenticação forte e revisão de segurança.

### Referências internas de hierarquia

CRM Turismo e Imobiliária oferecem base JWT/Passport, usuários, tenant e isolamento; os papéis encontrados são principalmente ADMIN/OPERATOR/SELLER/SUPER_ADMIN e não resolvem sozinhos o recorte por filial. O projeto Licitação tem RBAC de telas lendo permissões no banco, mas seu guard libera ADMIN/SUPER_ADMIN por bypass e não substitui autorização por registro/unidade. Portanto, nenhuma hierarquia existente deve ser copiada literalmente. Recomendação: combinar autenticação/tenant já conhecida com RBAC por permissão e escopo de tenant/unidade/atribuição, acrescentando testes de acesso cruzado desde o primeiro módulo.

## 5. Módulos e fluxos do produto

### 5.1 Plataforma SaaS e onboarding

- Cadastro de empresa (tenant), plano, status e unidades. Fuso global do produto: `America/Sao_Paulo`.
- Configuração de identidade visual e textos por tenant.
- Provisionamento do primeiro administrador e gestão direta de usuários com senha inicial, troca opcional no primeiro acesso e redefinição pelo Superadmin. O fluxo legado de convite continua disponível em endpoints existentes, mas não é usado na interface Superadmin.
- Limites e uso por plano (empresas, unidades, usuários, pacientes, conexões, campanhas e mensagens), configuráveis pela plataforma.
- Painel de superadmin com saúde do serviço e dados operacionais mínimos.
- O Superadmin tem acesso autorizado a todos os dados da plataforma por decisão do produto; consultas e alterações a dados de paciente devem gerar auditoria, com autenticação forte e revisão de segurança.
- Planos comerciais iniciais: **Starter:** R$97/mês, 500 pacientes ativos, 1.000 mensagens/ciclo, 1 usuário, 1 unidade, 1 WhatsApp, até 3 campanhas/ciclo; **Profissional:** R$197/mês, 1.500 pacientes ativos, 3.000 mensagens/ciclo, 3 usuários, 1 unidade, 1 WhatsApp, até 20 campanhas/ciclo; **Enterprise:** R$397/mês, pacientes sem limite comercial, 10.000 mensagens/ciclo, 10 usuários, 3 unidades, 3 conexões WhatsApp, até 100 campanhas/ciclo. O painel Superadmin atribui um plano a cada tenant e ajusta limites específicos; edição do catálogo/preço e cobrança não foram incluídas.
- Para a primeira configuração, limite de automações simultaneamente ativas seguirá 3/20/100 como default editável e limite de agendamentos fica sem teto. As mensagens/campanhas são contadores de consumo por ciclo de cobrança; pacientes, usuários, unidades, conexões e automações ativas são limites de capacidade. “Sem limite comercial” não remove controles técnicos/uso justo. Essencial assume custos de Meta/Evolution incluídos no plano; monitorar custo e qualidade por tenant para não prometer envio ilimitado.
- Registrar início/fim de cada ciclo de cobrança e medir mensagens e demais consumos cíclicos por ledger idempotente. Usuários, unidades, conexões, pacientes ativos e quantidade de automações habilitadas são limites de capacidade, não contadores reiniciados mensalmente. Exceder cota de consumo bloqueia nova operação e oferece upgrade; não apaga dados existentes.
- Os limites de Essencial Turismo servem de referência para a estrutura de planos, mas seu comportamento atual não implementa cota cíclica: `usage.service.ts` conta registros sem janela de ciclo e `increment()` não faz operação. O reset cíclico é funcionalidade nova a desenhar, não código pronto a copiar. Referências de preço competitivo: [iClinic](https://iclinic.com.br/precos/) · [Clinicorp](https://www.clinicorp.com/planos). A Essencial assume os custos de Meta/Evolution dentro dos planos; precificação final depende de validar volume, tarifas, infraestrutura, suporte e margem.

### 5.2 Usuários, papéis e auditoria

- Superadmin, admin de empresa, gerente e operador como papéis-base.
- Permissões granulares por módulo/ação, unidades permitidas e regra de fila/atribuição.
- Histórico de login, mudanças de permissão, acesso a dado sensível, exportação e ações sobre agenda/campanha.
- Recuperação de acesso, expiração/revogação de sessão e proteção de login.

### 5.3 CRM de pacientes e consentimentos

- Cadastro, busca, tags, origem, unidade preferencial e deduplicação por identificadores normalizados.
- Na criação manual, registrar obrigatoriamente uma escolha de opt-in sim/não (não condicionar o cadastro à autorização); na importação, mapear a prova de consentimento por contato ou manter como desconhecido/sem opt-in. Guardar `marketing_opt_in`, `opt_in_date` como projeções de resumo e um registro auditável com canal, categoria/finalidade, origem/evidência, versão do texto, autor e timestamp.
- Consentimentos separados para categorias de mensagens aplicáveis; sem consentimento comprovável, nenhuma comunicação proativa daquela categoria. WhatsApp exige número e opt-in e manda respeitar pedidos de opt-out; preferências claras por categoria reduzem risco. Referência: [Política de mensagens do WhatsApp Business](https://whatsappbusiness.com/policy/).
- Comandos recebidos cujo texto inteiro, após normalização, seja `SAIR`, `STOP` ou `CANCELAR` gravam `unsubscribed_at`, cancelam itens futuros de campanha/recorrência e marcam disparos impedidos como `SUPPRESSED` (com motivo auditável, sem enviar resposta promocional). Como `CANCELAR` também pode significar cancelar um agendamento, oferecer fluxo de cancelamento de consulta por botão ou frase inequívoca; o comando isolado prioriza o opt-out.
- Opt-out global bloqueia campanhas e recorrências proativas até que haja novo opt-in registrado. Não apagar consentimento anterior: manter eventos e registrar nova autorização/revogação.
- Perfil enxuto de relacionamento; não transformar o MVP em prontuário clínico.
- Importação CSV/XLSX com prévia, mapeamento, erros e relatório de duplicatas.

### 5.4 Serviços, procedimentos e ficha operacional

- Catálogo configurável por tenant/unidade: duração, intervalos, recursos necessários, elegibilidade e campos operacionais.
- Distinguir duração do procedimento na agenda (minutos) da duração estimada do efeito/retorno (dias); são conceitos diferentes.
- Regras por procedimento de quando iniciar lembrete antes do retorno: prazo total em dias e antecedência configurada.
- Guardar somente evento operacional necessário: nome do procedimento, data, unidade, status e valor se necessário à operação; não armazenar prontuário, diagnóstico, evolução ou relatório médico. Procedimento e valor também podem revelar dados de saúde/financeiros, então acesso, finalidade e retenção devem ser limitados.
- Não armazenar prontuário, diagnóstico, evolução ou relatório médico. Nome de procedimento e contexto do atendimento ainda podem revelar informações sobre saúde; manter apenas o mínimo necessário e restringir seu uso em mensagens externas.

### 5.5 Agenda própria e Kanban

- Agenda clínica completa por unidade, profissional/atendente e recurso/sala, com configuração padrão editável de expediente, feriados, bloqueios, duração, buffer, disponibilidade e encaixes. Os defaults servem para a demonstração do MVP; cada cliente ajusta sua operação.
- Criar, confirmar, reagendar, cancelar, concluir, marcar falta e registrar origem do agendamento.
- Verificar conflito dentro de transação/constraint adequada; não permitir dupla reserva por corrida concorrente.
- Kanban/pipeline parte de um preset básico inspirado no fluxo operacional do CRM Turismo e é editável por tenant. Preset inicial: **Novo pedido → Aguardando confirmação → Confirmado → Em atendimento → Concluído → Pós-atendimento**, com **Reagendamento solicitado**, **Cancelado** e **Falta** como estados/saídas rastreáveis. Evitar status que misturem estado de conversa com estado de agendamento.
- Visões de calendário e Kanban são complementares: calendário resolve horário; pipeline resolve andamento e pendências.
- Histórico de transições, autor, motivo e horário.
- Agenda nativa é a fonte inicial em todas as unidades. A mudança para Uno como fonte autoritativa é uma ativação explícita após credenciais e operações necessárias passarem por homologação.

### 5.6 Integração Uno

- Tela administrativa para conexão por unidade, credenciais protegidas, teste de conexão e status/última sincronização.
- Seleção de eventos e campos que o SaaS processará/guardará. Permissões externas também precisam ser concedidas/configuradas na Uno.
- Webhooks idempotentes processados em fila durável, com mapeamento de IDs externos, monitoramento e reprocessamento.
- Consulta de disponibilidade e escrita de agendamento configuráveis separadamente; a agenda nativa permanece até os endpoints e eventos Uno serem testados. A documentação pública consultada nomeia as credenciais `x-uno-access-token` e `x-uno-secret-key`; rótulos `Client ID/Secret` dependem de confirmação do contrato real.
- Dados financeiros desligados por padrão e restritos por papel; a documentação pública não comprova detalhes de parcelas/transações nem saldo completo de sessões.
- Especificação completa em [docs/MODULO_INTEGRACAO_UNO.md](./MODULO_INTEGRACAO_UNO.md).
- A inbox da unidade também mostra a fonte ativa da disponibilidade: **Uno conectada** com momento da última sincronização ou **Agenda nativa ativa**. Conexão com erro/atraso deve ficar em alerta e nunca sugerir que horários exibidos estão atualizados.

### 5.7 Inbox, mensagens e canais híbridos

- Conversa vinculada a paciente, tenant, unidade, número/canal e fila/atendente.
- Cada conversa aberta sem resposta mostra cronômetro desde a mensagem recebida mais recente que aguarda resposta. Padrão inicial de SLA: 15 minutos, configurável pela empresa; indicar visualmente dentro do prazo e destacar quando excedido. O cronômetro para apenas quando resposta humana ou mensagem IA efetivamente enviada for registrada; rascunho aguardando aprovação não conta como resposta. O SLA é tempo corrido no piloto e pode ganhar calendário de expediente após validação operacional.
- Timeline de inbound/outbound, status (recebida, pendente, enviada, entregue/lida se disponível, falha), identificador do provedor, anexos e tentativas.
- Toda mensagem enviada exibe autoria/proveniência: **IA autônoma** com ícone identificável, **rascunho IA aprovado por [pessoa]** ou **enviada por [pessoa]**. Persistir tipo de origem, autor/modelo e aprovador quando aplicável; não inferir autonomia a partir do texto. No piloto, a marcação de IA autônoma fica indisponível, pois mensagens IA exigem aprovação humana.
- Macros/variáveis configuráveis, templates por provedor e prévia antes de envio.
- Atendimento humano pode assumir, pausar automação, transferir e encerrar conversa.
- Adaptadores separados para Meta Cloud API oficial e Evolution/Baileys; aplicação não espalha formato específico do provedor entre módulos.
- Política de roteamento configurável por uso, com regra fixa de MKP → Meta oficial. Bloquear envio quando não houver configuração/permissão/consentimento aplicável.
- A Essencial assume custos Meta/Evolution dentro dos planos. Aplicar cotas por ciclo, monitorar custo por tenant/canal e pausar/sinalizar consumo fora da cota para proteger a margem. Titularidade dos números, implementação e suporte ainda precisam de detalhamento comercial.

### 5.8 Campanhas MKP — Meta Oficial apenas

- Importar e validar sublistas; segmentar por unidade, tags, procedimento, última visita e campos permitidos.
- Rejeitar duplicatas, números inválidos e opt-outs; prévia e teste interno antes da aprovação final.
- Vincular templates oficiais aprovados, variáveis, lote, agenda, limite de ritmo e janela de envio.
- Aprovação humana do cliente/administrador antes da execução; pausar, cancelar, retomar com trilha de auditoria.
- Métricas separadas por campanha/tenant/unidade e conciliação com callback da Meta.
- Nunca enviar MKP pela Evolution não oficial.

### 5.9 Automações por procedimento e pós-atendimento

- Construtor de regras simples: evento inicial, atraso/antecedência em dias, horário, unidade, canal, template, condições, tentativas e ação após resposta.
- Exemplo: atendimento concluído hoje; procedimento tem retorno em 10 dias; avisar 2 dias antes. Duração e antecedência são editáveis por cliente.
- Gatilhos separados para confirmação, lembrete de agenda, pós-atendimento, retorno de procedimento, aniversário, fidelidade e campanhas; cada um tem seu objetivo e chave idempotente.
- Guardar execução por paciente/evento/regra e consultar antes de agendar ou enviar para evitar duplicidade.
- Fuso fixo `America/Sao_Paulo` para todas as empresas e unidades; jobs persistentes, retomáveis, canceláveis e auditáveis.
- Pergunta padrão do NPS: “De 0 a 10, como você avalia sua experiência hoje na nossa clínica?”, 24 horas após atendimento `COMPLETED` (configuração inicial editável).
- Notas 0–6 geram card privado para gerência e resposta empática sem orientação clínica; 7–8 recebem agradecimento neutro; 9–10 podem receber agradecimento, mas a nota não controla convite público.
- Se houver convite Google, usar exatamente o mesmo convite neutro para todos os pacientes elegíveis, independentemente da nota; recompensa não se vincula ao convite ou avaliação. É proibido solicitar seletivamente avaliações positivas ou oferecer benefício em troca. [Política oficial do Google Maps](https://support.google.com/contributionpolicy/answer/7400114?hl=en).
- Métricas piloto: taxa de resposta NPS acima de 20% dos convites efetivamente entregues; buscar reduzir em 30% o tempo de ociosidade da recepção em relação a uma linha de base comparável, contabilizando agendamentos confirmados no fluxo IA-assistida.
- Alvo operacional do piloto: nenhuma suspensão/bloqueio de número nos 30 dias. Este é um objetivo monitorado, não uma garantia técnica; qualidade, denúncias e decisões de enforcement do provedor também afetam o resultado. Registrar qualidade do número, mensagens entregues, opt-outs, denúncias e bloqueios.

### 5.10 Indicação, fidelidade e reputação

- Registro de indicação com token/link próprio, origem e etapas: convite, clique, lead/cadastro, conversão confirmada por humano, recompensa pendente, aprovada e concedida.
- O clique no link comprova acesso ao link, não prova por si só que uma avaliação pública foi publicada. Não exibir isso como “avaliação confirmada”.
- **Restrição de política:** não enviar convite Google apenas a promotores. Se usado, enviar o mesmo convite neutro a todos os pacientes elegíveis independentemente da nota; benefício não pode depender de avaliação. [Política oficial do Google Maps](https://support.google.com/contributionpolicy/answer/7400114?hl=en).
- Não prometer verificação automática de publicação Google. Se o cliente quiser, estudar escopo e limitações da Business Profile API, mas a política e privacidade devem ser respeitadas; a solução inicial não exige integrar avaliações.
- Conversão ocorre no primeiro agendamento do indicado quando o status for `PAID` **ou** `COMPLETED`, conforme a regra mais recente do cliente. Clique registrado muda indicação para `PENDING`. Comparar telefone normalizado e, se disponível e autorizado, CPF do indicador e indicado para barrar autoindicação; não coletar CPF exclusivamente para essa finalidade sem necessidade/avaliação. Recompensa fica pendente de aprovação humana; voucher expira 90 dias após emissão. Estorno, validade da indicação e tipos/limites de recompensa ainda serão configuráveis pela clínica. Só usar `PAID`/`COMPLETED` recebidos de fonte verificável; mapear status Uno apenas se a API confirmar sua semântica.
- A mensagem posterior sobre compartilhar no Instagram pode ser um convite opcional e independente da recompensa; registrar clique como clique, não como post publicado, salvo integração explícita permitida e validada.
- Cartão fidelidade digital pode apresentar progresso/benefício e status sem conceder automaticamente recompensa.

### 5.11 IA de atendimento e histórico

- No piloto, a IA prepara respostas e ações para revisão humana antes do envio/execução. A automação de respostas simples só entra depois de aprovação de intents, conteúdo, limiares e regras de handoff pelo cliente.
- Escopo futuro: reconhecer intenção, consultar disponibilidade e propor horários; a agenda realiza a reserva só após confirmação explícita e verificação transacional.
- Botão/condição de handoff para humano quando houver baixa confiança, pedido sensível, conflito, exceção financeira, reclamação ou solicitação explícita.
- Persistir mensagens da conversa como registros próprios ligados a tenant, paciente, unidade, canal e conversa, com metadados do provedor, estado, timestamps e relação com ação/agendamento. Definir retenção e anonimização antes da produção.
- Separar **histórico de mensagens** (fonte auditável) de **contexto/memória resumida da IA** (derivado, limitado e regenerável). Não usar log de prompt interno como histórico de conversa do paciente.
- Minimizar o que segue para o modelo; evitar CPF/dados de saúde em prompt quando não indispensáveis; nunca tomar decisão clínica/financeira.

### 5.12 Painéis e relatórios

- Superadmin: tenants, planos, falhas sistêmicas e dados dos tenants conforme autorização global do papel; consultas a dados sensíveis entram na auditoria.
- Admin da empresa: agenda consolidada do próprio tenant, equipes/unidades, campanhas, automações, volume/custo e pendências.
- Gerente: fila, agenda, carga de equipe e resultados da unidade atribuída.
- Operador: sua agenda/tarefas e fila compartilhada conforme política do tenant; somente dados necessários.
- Indicadores precisam definir fórmula e período; não expor CPF ou conteúdo integral da mensagem em dashboards.

### 5.13 Configurações, suporte e conformidade

- Configurações por empresa/unidade: identidade, expediente, procedimentos, canais, templates, políticas de consentimento, limites e integrações. O fuso do produto permanece `America/Sao_Paulo`.
- Central de status/erros de conexão, eventos de webhook, fila de falhas e ferramentas seguras de reprocessamento.
- Proposta de papéis: clínica é Controladora e Essencial é Operadora para os tratamentos executados sob instruções da clínica; validar por finalidade, contratos e assessoria jurídica.
- Em pedidos de exclusão, aplicar retenção/eliminação/anonimização conforme direitos e obrigações aplicáveis. Não tratar hash simples de nome/CPF como dado anônimo: é pseudonimização no máximo e pode permitir reidentificação. Se a preservação de IDs financeiros/agendamentos for necessária, remover/desvincular identificadores diretos e avaliar risco dos dados relacionáveis, bases e prazo de retenção; não prometer esquecimento absoluto sem análise. Referências: [LGPD — Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) · [orientações ANPD para RIPD/risco](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd).
- Criptografia, minimização, auditoria de acesso (inclusive Superadmin), revisão de segurança, backups, fluxo de incidentes e atendimento a direitos do titular precisam constar dos critérios de produção. O escopo exato de dados de saúde via WhatsApp deve ser validado conforme política do provedor e regras aplicáveis.

## 6. Referências locais e o que reaproveitar

O objetivo é **partir dos módulos que já funcionam**, testar sua aderência ao modelo de clínica e refatorar o necessário. “Criar” significa cobrir uma lacuna que não existe em nenhum dos sistemas, não reescrever um módulo equivalente sem antes comparar o código.

| Sistema disponível | O que já existe e pode ser aproveitado | Como entra no novo sistema | O que não copiar literalmente |
|---|---|---|---|
| **CRM Turismo** | Backend NestJS, Prisma/PostgreSQL, JWT+bcrypt, usuários, contatos, reservas, calendário, Kanban, WhatsApp, campanhas e planos. Principais arquivos: `server/src/auth/*`, `server/src/contacts/*`, `server/src/bookings/*`, `server/src/calendar-events/*`, `server/src/whatsapp/*`, `server/src/campaigns/*`, `server/src/usage/*`. | Base principal para extrair/refatorar auth, usuários, clientes, agenda, funil/Kanban, templates e telas administrativas. | O modelo legado `Store/storeId` não equivale a `Tenant/Membership/Unit`. Cada consulta, escrita e token precisa ser migrado e testado contra IDOR. Limites atuais não implementam ciclo mensal; cron não substitui fila durável. Rever `AUDIT_REPORT.md` antes do porte. |
| **CRM Imobiliária** | Backend NestJS/Prisma, auth/permissões, auditorias/logging, testes IDOR, proteção/criptografia de PII e recuperação de senha. Arquivos de referência: `server/src/auth/*`, `server/src/common/field-crypto.util.ts`, `server/src/common/logger/*`, `server/src/integrity-audit/*` e testes/scripts `test:idor`/`test:password-reset`. | Referência de controles de segurança, auditoria, criptografia e recuperação de conta; complementar ao CRM Turismo. | Domínio de imóveis/contratos. Revisar tenant e bypasses de Superadmin antes de reutilizar. |
| **Essencial Pet / PetControl** | Backend NestJS/Prisma, auth, WhatsApp/Evolution, agenda e automações; BullMQ/Redis; cookie/sessão e tentativas de login. Arquivos: `server/src/auth/*`, `server/src/users/*`, `server/src/agenda/*`, `server/src/automation/*`, `server/src/whatsapp/*`, `server/src/middleware/tenant.middleware.ts`. | Extrair partes compatíveis de sessão/login, mensageria, agenda e jobs; comparar automações/retries com Turismo e OS v4. | Não copiar escopo `storeId` nem tratar `prisma/rls.sql` como isolamento completo: é exemplo de política e o middleware encontrado filtra leituras ORM, sem provar cobertura de escritas. |
| **Sistema de OS v4** | Operação multiempresa, cliente/opt-out, templates, status de mensagem, janela comercial, lembretes e scheduler RQ. Referências: `app/services/whatsapp_service.py`, `app/services/whatsapp_automation.py`, `app/tasks.py`, `app/models.py`. | Reaproveitar regras/casos de borda de opt-out, envio agendado, retry e histórico. | É Flask/Python/SQLAlchemy; não importar código diretamente para NestJS. Tag/opt-out simples não substitui consentimento auditável por canal/finalidade. |
| **agendamento-main** | Publicador Python de Instagram/Facebook pela API oficial Meta, com rascunho, validação, aprovação humana e fila. Referências: `painel/app.py`, `painel/servicos.py`, `painel/robo.py`, `scripts/instagram_publisher.py`, `scripts/facebook_publisher.py`. | Reutilizar UX/regra de rascunho, aprovação e fila como referência para campanhas. | Não é agenda clínica e não integra WhatsApp Cloud API; não reaproveitar como adaptador WhatsApp. |
| **sistemafinanceiro-master** | FastAPI/SQLAlchemy, Alembic, testes, importação OFX e serviços financeiros. Referências: `backend/app/services/transaction_service.py`, `reconciliation_service.py`, `quota_service.py`, `audit_interceptor.py`, `ofx_parser.py`. | Referência de precisão monetária, conciliação, idempotência e importação apenas se Uno liberar dados financeiros. | Python e outro domínio; não é fonte de verdade de sessões/crédito/pagamento do paciente, que dependem da Uno autorizada. |
| **Conversa e prints do cliente** | Descrição dos robôs atuais (confirmação, indicação/fidelidade, pós-atendimento, MKP), volume, Meta oficial, duas unidades, necessidade de reagendar via Uno e imagens do CRM/automação em uso. | Fonte funcional para descobrir jornadas e dados que reduzem retrabalho. Usar os robôs validados como requisitos de comportamento e comparar cada fluxo ao que os sistemas Turismo/Pet/OS já fazem. | Prints e conversa não são código nem prova de acesso técnico à Uno/Meta. Não presumir credenciais, endpoints, consentimento registrado ou que a integração seja tecnicamente possível antes da homologação. |

### Regra prática de reaproveitamento

1. **Extrair/adaptar primeiro:** se um sistema já resolve o mesmo caso, iniciar pela leitura de seu módulo, serviço, modelo, tela e testes; portar o trecho útil e ajustar ao schema de clínica.
2. **Refatorar quando necessário:** alterar escopo `Store/storeId` para `Tenant/Membership/Unit`, alinhar autorização, estado, auditoria, consentimento e integração. Não replicar falhas conhecidas por fidelidade ao legado.
3. **Criar apenas a lacuna:** Uno, domínio clínico (paciente/procedimento/retorno), consentimento por canal/finalidade, histórico de conversa omnicanal e requisitos específicos ausentes.
4. **Não copiar** `.env`, tokens, dados de cliente, banco de produção ou histórico pessoal. Reutilizar código somente depois de checar dependências, licença/posse, testes e fronteiras do módulo.

## 7. Stack recomendada para a nova base

- **Decisão após prova reversível:** manter NestJS 12 + Prisma 6 nesta etapa, sem downgrade para Nest 10/Prisma 5. Uma cópia temporária compilou com Nest 10.4.20, Prisma 5.22 e TypeScript 5.7.3; portanto, versões antigas são tecnicamente compatíveis, mas não eliminam o trabalho de refatorar `storeId` para Tenant/Membership/Unit. A linha Nest 12 é a atual e Prisma 5 representa recuo sem ganho de isolamento. Como a janela de correções do Prisma 6 termina em 19/11/2026, Prisma 7 vira requisito de atualização antes de produção, com sua própria prova de migration, adapter PostgreSQL, build e testes. Não adotar Prisma 8 RC. A aplicação roda com Node 24.14; atualizar para Node 24.15+ para usar geradores do Nest CLI.
- **Frontend:** alinhar ao padrão comum React 19 + Vite 7 + Tailwind do Turismo/Pet/Imobiliária, sujeito ao mesmo build de prova; o scaffold atual está em React 19 + Vite 8 e ainda não tem a estrutura completa do CRM. Reutilizar/adaptar componentes do Turismo depois de validar tema por tenant e acessibilidade.
- **Autenticação:** comparação arquivo a arquivo registrada em [COMPARACAO_AUTH_E_USUARIOS.md](./COMPARACAO_AUTH_E_USUARIOS.md). Reaproveitar comportamento de bcrypt/JWT/DTOs do Turismo/Pet, controles de bloqueio e revogação da Imobiliária, e estrutura de testes IDOR; adaptar claims e associações para Tenant/Membership/Unit. Sessão persistida e convite com hash no banco são o modelo próprio da clínica.
- Fila: Redis + BullMQ para processamento e, futuramente, envios/automação/IA, com PostgreSQL como registro durável de eventos e estados. Eventos persistidos sem job são reenfileirados idempotentemente; eventos `PROCESSING` expirados são recuperados. O ensaio sintético local de 5.000 mensagens + 100 eventos sem job terminou com backlog drenado; isso mede uma rajada local, não uma cadência/SLO. A cadência ainda precisa de confirmação, e o teste local comprovou queda/retorno real do Redis no webhook e reinicio de worker outbox. Isso não altera cotas comerciais (1.000/3.000/10.000 mensagens por ciclo), nem define backlog simultâneo permitido. Métricas e procedimento em [TESTE_CARGA_WEBHOOK.md](./TESTE_CARGA_WEBHOOK.md); não é homologação de produção.
- Banco: PostgreSQL com migrations versionadas; organização/tenant e unidade explícitos nas entidades e constraints.
- Integrações: adaptadores independentes Uno, Meta Cloud, Evolution e futuro provedor de IA; integrações externas nunca acessam Prisma diretamente.
- Infra: Docker Compose/Nginx como padrão a validar, com API, worker, scheduler e banco/Redis separados por responsabilidade.
- Não copiar tokens, `.env`, dados nem banco de produção. Código útil pode ser extraído/refatorado após revisão; a origem, adaptação e testes devem ser registrados.

## 8. Modelo de domínio a desenhar (conceitual, não schema aprovado)

Tenant/Empresa, Unidade, Usuário, Papel, Permissão, Escopo de Unidade, Paciente, Consentimento, Procedimento, Regra de Retorno, Profissional/Recurso, Expediente/Bloqueio, Agendamento, Transição de Pipeline, Conversa, Mensagem, Anexo, Canal/Conexão, Configuração de Integração, Campo Permitido, Evento Uno, Mapeamento de ID Externo, Template, Campanha, Destinatário, Execução de Automação, Indicação, Recompensa, Aprovação Humana, Evento de Integração e Auditoria.

Entidades precisam ter escopo de tenant; dados operacionais devem ter unidade quando aplicável. Diferenciar paciente, operador e evento, evitar JSON genérico como substituto de entidades críticas e modelar retenção/soft delete de acordo com a finalidade.

## 9. Fases de execução: aproveitar, refatorar e criar

Cada fase começa com inventário do módulo equivalente, comparação de schema/fluxo e decisão registrada. Só então o código existente é portado/refatorado. Nenhuma fase começa por um scaffold equivalente em branco. “Criar” abaixo lista as lacunas próprias do produto clínico.

### Fase 0 — inventário e decisão de porte (decisão de stack/Auth registrada; auditorias por domínio continuam)

**Aproveitar:** `PLANO_PROJETO.md`, respostas em `PENDENCIAS_DESCOBERTA.md`, screenshots e conversa do cliente; módulos e documentação dos seis sistemas listados na seção 6.

**Refatorar/decidir:** inventário inicial dos sistemas-base documentado na seção 6. A comparação arquivo a arquivo de Auth/Users e a prova reversível Nest 12/Prisma 6 versus Nest 10/Prisma 5 estão concluídas; a decisão está em [COMPARACAO_AUTH_E_USUARIOS.md](./COMPARACAO_AUTH_E_USUARIOS.md). Cada domínio futuro (agenda, WhatsApp, campanhas, filas) ainda terá sua própria auditoria antes de portar código. A implementação atual conserva a stack da clínica e reaproveita comportamentos compatíveis, sem copiar módulos legados inteiros.

**Criar:** matriz inicial de reaproveitamento e diferenças de domínio já documentadas; concluir lista de dependências, prova de stack e checklist de aceitação antes de liberar produção.

**Saída concluída para Auth/Users:** stack escolhida, arquivos fonte mapeados e fronteiras de porte registradas. O desenvolvimento de Fase 1/2 abaixo está validado localmente em parte, mas não significa aceite de produção.

### Fase 1 — fundação, autenticação e tenant

**Aproveitar:** schema/migrations locais já criados para `Tenant`, `Unit`, `User`, `Membership`, `UnitMembership`, planos, ciclo/uso e auditoria; fluxo de bcrypt/JWT, controller e tela de login/usuários do Turismo e PetControl; proteções de conta/sessão e recuperação do PetControl/Imobiliária; testes IDOR do CRM Imobiliária como referência.

**Refatorar:** substituir o escopo antigo `storeId` por `tenantId + membershipId + unitScopes`; manter NestJS 12/Prisma 6 por decisão documentada; centralizar claims, RBAC e contexto, com guardas de sessão em toda chamada. A comparação arquivo a arquivo e o E2E PostgreSQL estão em [COMPARACAO_AUTH_E_USUARIOS.md](./COMPARACAO_AUTH_E_USUARIOS.md). Não copiar implementações `storeId` nem considerar o Prisma extension como RLS.

**Criar:** só o ciclo que não foi encontrado nos projetos-base e é exigido pelo schema/segurança: sessões persistidas com rotação/revogação, convites de operador/gerente vinculados ao tenant e unidade, mapeamento de permissões clínicas e auditoria de acessos sensíveis. Fluxo de primeiro Superadmin e provisionamento de tenant se não existir componente portável.

**Implementado no protótipo atual:** login JWT com bcrypt, sessão persistida e refresh rotativo, logout/revogação, convite vinculado ao tenant/unidades, guards JWT/tenant/RBAC e contexto request-scoped; escopo de tenant no adaptador Prisma; chaves compostas no banco impedem vínculos unidade/membership/paciente entre tenants. Isso reutiliza algoritmos e padrões observados nos projetos, mas mantém código adaptado à stack local.

**Ainda refatorar/criar:** provisionar primeiro tenant/administrador por procedimento operacional; implementar bloqueio progressivo de login e recuperação segura de senha; revisar autenticação forte de Superadmin, acesso raw/unscoped e cobertura de RLS. O convite é enviado por SMTP sem token na resposta HTTP. `PrismaService.unscoped` é usado em autenticação e transações explícitas; cada uso continua exigindo auditoria.

**Aceite parcial:** login/refresh/logout/convite, sessão revogada e escopo tenant/unidade têm E2E PostgreSQL; Prisma unique selectors agora mantêm tenant no filtro. Permanecem pendentes testes de concorrência de convite, matriz completa de permissões/atribuição, operação de primeiro tenant, revisão de RLS e auditoria de segurança independente.

### Fase 2 — CRM de pacientes, consentimento e procedimentos

**Aproveitar:** clientes/contatos, busca, filtros, importação, tags, deduplicação e telas do CRM Turismo; dados de cliente/mesclagem e sinalização de opt-out do OS v4; exemplos de campos e operação do CRM do cliente nos prints.

**Refatorar:** trocar cliente/reserva por paciente/atendimento sem levar dados de turismo ou oficina; adequar campos a tenant/unidade, autorização por papel, retenção e auditoria. Reaproveitar importação somente após revisão de coluna/consentimento e prova da origem. Converter opt-out legado em preferência auditável por canal/finalidade, sem inferir consentimento de uma tag.

**Criar:** modelo de consentimento/evidência, histórico de alterações, catálogo clínico de procedimentos, duração do atendimento em minutos e regra de retorno em dias. Cadastro enxuto, sem prontuário.

**Implementado e validado localmente:** schema e migrations de paciente, consentimento/eventos e procedimento; endpoints de cadastro, edição, leitura de perfil, arquivamento lógico, histórico e alteração de consentimento. Lista com busca por nome/telefone/e-mail, filtro de status/unidade, paginação de 25 (máximo 100), ordenação estável e contagem na mesma transação RepeatableRead. Edição normaliza telefone e não toca consentimento. GRANTED exige tipo e referência de evidência; evento é imutável também no PostgreSQL por trigger. DENIED/REVOKED são eventos persistidos e suprimem outbox pendente por canal/finalidade. Arquivamento preserva agendamentos/conversas e suprime envios pendentes. UI inclui cadastro, edição, confirmação de arquivo, perfil, preferências e histórico. Tags e notas append-only estão implementadas; importação CSV/XLSX tem prévia, mapeamento dos campos suportados e deduplicação. E2E API cobre isolamento tenant/unidade, operador/admin, paginação, arquivo, consentimento e importação.

**Ainda criar/refatorar:** regras avançadas de mesclagem/revisão de duplicatas, recuperação de linhas importadas, mais histórico operacional no perfil, decisão de retenção/acesso a PII e opt-out inbound autenticado. Notas são operacionais e não substituem prontuário. A importação CSV/XLSX oferece prévia e validação por linha; consentimentos não são importados e permanecem sem preferência. A UI registra tipo e referência identificável de evidência, com validação básica anti-placeholder, mas não autentica automaticamente documento/mensagem externa. Ausência de preferência significa “sem autorização registrada”; não equivale a `DENIED`.

**Aceite local atualizado:** suíte total 34/34 E2E serial em PostgreSQL (3 arquivos), incluindo cadastro/consentimento, edição, supressão, histórico imutável, arquivo, busca/paginação, isolamento tenant/unidade, tags/notas, CSV/XLSX, atribuição, tarefas, quick replies, webhook HMAC/dedupe/opt-out/status fora de ordem e recuperação de job/worker. Persistem automação de interface, concorrência de importação, retenção e homologação de canais. O cadastro não inclui prontuário. Carga 5.000 + 100 webhook e 5.000 outbox dry-run passaram localmente; consulte [TESTE_CARGA_WEBHOOK.md](./TESTE_CARGA_WEBHOOK.md) e [TESTE_CARGA_OUTBOX_DRY_RUN.md](./TESTE_CARGA_OUTBOX_DRY_RUN.md).

### Fase 3 — agenda nativa, calendário e integração Uno

**Estado atual:** calendario dia/semana e acoes nativas integrados. Recursos tipados por unidade podem ser associados a agendamentos; procedimentos exigem quantidades por tipo. Horarios simultaneos sao permitidos com recursos distintos, mas conflito de recurso compartilhado bloqueia. Agendamentos historicos sem recurso continuam bloqueando a unidade toda. Expediente semanal aceita ate quatro intervalos por dia; excecoes e bloqueios sao verificados no backend em America/Sao_Paulo. A validacao de expediente inicia desligada para preservar unidades legadas. Fonte UNO continua somente leitura local. API E2E 50/50 serial; Playwright focado 1/1; migration 27 aplicada e instalacao limpa 27/27.

**Aproveitar:** reserva, calendário, validação de capacidade, estados e componentes de agenda do CRM Turismo; agenda e horários operacionais do PetControl; detalhes de conflito/retirada/lembretes que se aplicarem no OS v4. Os prints/conversa do cliente orientam os fluxos existentes e os casos de reagendamento.

**Refatorar:** migrar booking/reservation para appointment e resource clínico; adaptar conflito concorrente, fusos, unidade, transições e autorização. Separar agenda por unidade e garantir fonte única escolhida: Uno ou agenda nativa.

**Criar:** adaptador Uno, configuração editável de credenciais/operações/campos, conexões e status, mapeamento de IDs, fila/dedupe de eventos e reconciliação. A API Uno só será habilitada após documentação e credenciais autorizadas; sem isso, seguir com a agenda nativa.

**Registro historico da agenda nativa:** 50/50 E2E API serial cobriu alocacao de profissionais/salas, conflitos compartilhados, requisitos, reagendamento ocupado, legado sem recursos, expediente, data fechada, concorrencia e escopo; Playwright focado 1/1. A suite Playwright completa 8/8 foi aprovada posteriormente na Fase 8 e esta registrada no resumo inicial e no relatorio da Fase 8.

### Fase 4 — inbox e canais WhatsApp

**Estado atual:** inbox com conversas por unidade, histórico persistido, SLA de 15 minutos, atribuição/transferência com histórico, tarefas e pipeline configurável por tenant. Respostas rápidas podem ser listadas, editadas, pré-visualizadas com variáveis permitidas e inseridas no compositor; não enviam por si só. Webhook Meta valida HMAC SHA-256 sobre raw body, persiste eventos antes de enfileirar, deduplica e atualiza inbound/status; `SAIR`/`STOP`/`CANCELAR` grava revogação e suprime outbox de marketing pendente. Redis/BullMQ processa com retry limitado, fair-share por tenant, estados PostgreSQL duráveis e reconciliador para jobs ausentes/worker interrompido. Teste local interrompeu/restaurou Redis e recuperou evento persistido sem duplicar; worker outbox foi reiniciado após claim. Dispatcher da outbox existente está implementado apenas em dry-run, com revalidação de consentimento/cota/canal e resultado `SIMULATED`; resultados indeterminados (`UNKNOWN`) não são reenviados automaticamente. Carga dry-run 5.000/5.000 em 260,71 s. Faltam template/janela Meta e homologação de cadência/canal; nenhum envio externo está implementado/ativo e escrita Uno continua desligada.

**Aproveitar:** serviços e telas de WhatsApp, templates, conexões e fluxo de mensagens do CRM Turismo/PetControl; histórico de entrega/status, retries, janela comercial e opt-out do OS v4; padrões de aprovação humana e publicação em fila do agendamento-main.

**Refatorar:** adaptar contato/conversa/mensagem à inbox clínica, separar operador/IA/sistema, Meta Oficial de Evolution/Baileys, unidade e tenant; não usar conectores de Instagram/Facebook como WhatsApp. Substituir envios frágeis/cron por fila durável quando adequado; aplicar consentimento e opt-out antes de cada envio.

**Criar:** histórico omnicanal do paciente e adaptador Meta WhatsApp Cloud API caso os sistemas-base não tenham implementação compatível com o contrato atual; handoff, fila operacional e os três ajustes de UI aprovados (SLA de 15 min, origem IA/humano, status da agenda).

**Aceite:** mensagens recebidas/enviadas com idempotência e estado reconciliado; filas não enviam após opt-out; MKP bloqueado em Evolution e só permitido em canal oficial Meta.

### Fase 5 — campanhas, automações, pós-atendimento e fidelidade

**Estado atual:** campanhas Meta-only permanecem em rascunho/outbox. O motor PostgreSQL + Redis/BullMQ suporta confirmação, pesquisa privada de satisfação após conclusão nativa e retorno por procedimento. Este último usa somente atendimentos nativos concluídos e o procedimento explicitamente associado; calcula `completedAt + (returnAfterDays - reminderAdvanceDays)`, ambos em dias, sem confundir com os minutos de agenda. Usa consentimento próprio (`PROCEDURE_RETURN`), limites de contatos por paciente, dias/horários permitidos, expiração de resposta, conteúdo editável e tarefa humana após interesse/agendamento. Revalida procedimento, status do atendimento, paciente, consentimento, conexão e cota; suprime se houver agendamento posterior. Respostas exatas autenticadas criam tarefa vinculada ao paciente/procedimento/unidade, nunca reserva automática. `SAIR`/`STOP`/`CANCELAR` inbound revoga também finalidade de retorno e suprime pendências. Mensagens continuam exclusivamente dry-run; `SIMULATED` não significa entrega.


Validacao local em 18/10: E2E API 47/47 em 4 arquivos, serial (3 usam PostgreSQL), e Playwright 2/2; API lint/build, Web build, Prisma validate e 26/26 migrations passaram. Web lint terminou com 7 avisos `react(set-state-in-effect)`. Cobertura comercial inclui qualificacao, inelegibilidade, reversao, expiracao de voucher, concorrencia de resgate e marco ficticio de 20 indicacoes.

Continuam pendentes teste de carga especifico deste motor e definicao/homologacao da cadencia. O criterio comercial real da campanha Maislaser e o limite de recompensa aguardam confirmacao; o cenario de 20 indicacoes e ficticio e local. Nenhum disparo externo ou escrita Uno ocorreu.

**Aproveitar:** campanhas, segmentos, templates e telas/fluxos do CRM Turismo; automações recorrentes, BullMQ/Redis e scheduler do PetControl; agendamento, janela comercial, retry e histórico do OS v4; fluxo de aprovação do agendamento-main.

**Refatorar:** reaproveitar serviços de execução como adaptadores/jobs isolados; introduzir evento de domínio, chave idempotente, tentativas limitadas e cota por ciclo. Não copiar contagem acumulada do CRM nem pressupor que retry significa envio seguro.

**Criar:** regras clínicas de retorno após procedimento, NPS (se aprovado separadamente), termos e integração comercial do programa de indicação conforme regras ainda pendentes. O módulo local já permite campanhas, metas por qualificações acumuladas, lead ou conclusão de agendamento nativo, recompensa interna/voucher e aprovação humana obrigatória; a qualificação `PAID` não existe no modelo local e nenhum status Uno é tratado como pagamento. A pesquisa privada de cinco classificações não é NPS nem avaliação pública. Convite público para avaliação, se houver, deve ser neutro e independente da nota; sem recompensa por review.

**Aceite restante:** cobrir falha/recovery, suppressão, cancelamento/reagendamento e idempotência dos próximos robôs; não confundir `SIMULATED` com entrega. Teste reproduzível do motor para 5.000 eventos/mensagens fictícios e cadência precisam ocorrer antes de declarar capacidade homologada.

### Fase 6 — IA de atendimento e reagendamento

**Aproveitar:** código de assistente, avaliação, logs e padrões de IA da Imobiliária/CRM somente onde o componente for independente do contrato imobiliário; o fluxo proposto pelo cliente nos áudios/conversa e a experiência de revisão humana do agendamento-main.

**Refatorar:** limitar contexto ao paciente/conversa/tenant autorizado; retirar dependências de contrato/documento imobiliário; usar adaptador do provedor, instruções por tenant, proteção de PII e trilha de decisão.

**Criar:** assistente clínico operacional sem diagnóstico, rascunho de resposta/ação, confirmação humana, consulta segura de disponibilidade Uno/nativa e solicitação transacional de reagendamento. No piloto, toda saída é aprovada por pessoa.

**Estado atual:** backend e tela de configuração de rascunhos implementados em `api/src/ai/` e `web/src/App.tsx`. Chave fica cifrada; contexto limitado às últimas oito mensagens, com mascaramento básico de e-mail/telefone/CPF; processamento exige autorização explícita do administrador. Rascunho fica persistido, pode ser rejeitado ou aprovado por humano e, se aprovado, gera apenas mensagem `QUEUED` após checar consentimento e cota. Não envia mensagem e não faz diagnóstico. Reagendamento nativo humano transacional está disponível em `AppointmentsService.reschedule`; a IA ainda não consulta slots nem propõe/executa essa ação, e registros Uno continuam bloqueados até homologação. A cota de mensagens é reservada no aceite da fila. Não foi feita chamada real ao provedor no teste.

**Aceite:** não confirma horário antes da fonte de agenda; ações são auditadas; teste de prompt injection, tenant cruzado, ausência de consentimento e falha da Uno.

### Fase 7 — SaaS, cotas, operação e produção

**Aproveitar:** Superadmin, planos e gestão de tenants do CRM Turismo/Imobiliária; estrutura de ciclo e ledger do schema da clínica; deploy, backup/restore, logs e práticas de operação dos sistemas locais; precisão decimal e idempotência do financeiro quando houver lançamento.

**Refatorar:** transformar telas e regras de plano existentes para clínicas/unidades; corrigir contagem/ciclo e autorização; consolidar telemetria, auditoria e configuração de integração sem segredos em claro. Não habilitar acesso global de Superadmin por bypass implícito.

**Criar:** operação comercial clínica que não existir em componente portável, política de retenção, atendimento de direitos, backup/restore e painel de custo/saúde de canais e Uno.

**Aceite:** restore ensaiado, cotas por ciclo consistentes, segredos protegidos, eventos sensíveis auditáveis e piloto aprovado antes de produção.

**Estado atual:** `UsageService` aplica limites efetivos de pacientes, usuários, unidades, conexões, automações ativas, campanhas e mensagens por ciclo; overrides por assinatura são protegidos por locks transacionais de capacidade/consumo. `GET /api/usage` apresenta consumo. O painel `web/src/PlatformAdminPanel.tsx` e endpoints `api/src/platform/` permitem consultar tenants, provisionar empresa/unidade/avaliação/convite local, editar plano/limites e suspender/reativar com reautenticação, auditoria, revogação de sessões e supressão de trabalhos antigos. Conta da plataforma exige TOTP, provisionada pelo script `api/src/scripts/bootstrap-platform-admin.ts`; convites clínicos não permitem atribuir papel Superadmin. Build completo da API aprovado; instalação limpa descartável aplicou 28/28 migrations. A causa da falha intermitente foi diferença de caixa: o fixture do navegador persistia sufixo hexadecimal aleatório com letras minúsculas, enquanto a API normalizava o código recebido para maiúsculas e fazia busca exata sensível a caixa. A API agora tenta a correspondência canônica exata e, se ausente, busca código sem distinção de caixa; o fixture também grava o código canônico em maiúsculas. Regressão focada API 2/2 passou (inexistente e desativado rejeitados; válido provisiona e repetição segue idempotente). Playwright Superadmin focado 1/1 passou: MFA, painel, provisionamento, unidade, plano, convite local, aceite, primeiro login clínico e ausência da navegação da plataforma para o admin clínico. Os resultados prévios 52/52 E2E API e 2/2 TOTP foram preservados. Não há cobrança recorrente/renovação automática, envio de convite por e-mail neste fluxo, custo real de canal, backup/restore ensaiado ou operação de produção. Suspensão preserva dados; reativação mantém integrações e execuções antigas desligadas. A conexão Uno não é contada como WhatsApp e não é acessada por esse painel.

**Atualização de interface (19/10/2026):** Superadmin separado da shell clínica; menu por área e dashboard executivo sem cadastro embutido. Seções reutilizam dados globais do dashboard, detalhes por clínica, planos habilitados e auditoria. Métricas acrescentadas: clínicas criadas nos últimos 30 dias; unidades e usuários ativos; conexões registradas; pacientes ativos em tenants ACTIVE/TRIAL; reservas de mensagens/campanhas no ledger nos últimos 30 dias; automações ativas/pausadas; convites válidos; trials com ciclo terminando em sete dias; falhas de outbox. Reservas são explicitamente rotuladas como não entregas; nenhum indicador de receita é exibido. Build API/Web passou; lint direcionado e navegador visual não foram executados nesta alteração. Sem migration ou alteração de autorização. Design system em `docs/IDENTIDADE_VISUAL_E_DESIGN_SYSTEM.md`.

**Fases 8 e 9:** Fase 8 concluida localmente, conforme [FASE_8_CONSOLIDACAO_OPERACIONAL.md](./FASE_8_CONSOLIDACAO_OPERACIONAL.md). Fase 9 concluida localmente no escopo de [FASE_9_RELATORIOS_NPS_FOLLOWUP.md](./FASE_9_RELATORIOS_NPS_FOLLOWUP.md); envio NPS continua nao implementado e desativado. As secoes 10 e 11 sao criterios e ciclo de engenharia, nao fases de codigo.

### Fase 9 - relatorios gerenciais, NPS privado e follow-up

**Estado atual:** implementadas agregacoes PostgreSQL com escopo tenant/unidade, comparacao de periodos, CSV agregado auditado, secao clinica de relatorios, NPS privado distinto da pesquisa de cinco opcoes e tarefas de follow-up pela central existente. NPS fica desligado por padrao; conclusao nativa elegivel cria registro interno persistente, sem outbox ou envio externo. Consentimento revogado, cancelamento/reagendamento e desligamento cancelam registros planejados. Resultados finais e limitacoes em [FASE_9_RELATORIOS_NPS_FOLLOWUP.md](./FASE_9_RELATORIOS_NPS_FOLLOWUP.md).

**Validacao local:** API E2E PostgreSQL 4/4, Playwright focado 1/1, builds API/Web, lint API, Prisma validate, estado de 29 migrations e instalacao limpa em duas bases descartaveis 29/29. Web lint terminou com avisos React. Nenhum envio externo, chamada a Uno, VPS, cobranca ou benchmark.

**Pendente para uso externo/producao:** canal e processo de resposta NPS autenticada, conexao com motor de envio duravel em dry-run antes de qualquer envio real, aprovacao de pergunta/consentimento/retencao pela clinica e revisao de seguranca/privacidade. Estados `PLANNED` nao indicam entrega.

## 10. Critérios para aprovação antes de desenvolvimento

**Situação após implementação das Fases 6–7:** ainda não aprovada para piloto/produção. Consentimento, defaults de produto e isolamento tenant/unidade estão codificados em parte; pendem validação com clínica, matriz completa de permissões/atribuição, retenção e base legal do envio de contexto de conversa à OpenAI, processo de opt-in dos usuários do piloto, credenciais e homologação Uno/WhatsApp, custos/margem, backup/restore ensaiado, métricas e linha de base. A autorização de processamento IA na tela é uma declaração operacional do administrador, não substitui contrato/base legal nem consentimento aplicável.

- Escopo de MVP, número de unidades/usuários e jornada principal definidos.
- Pipeline básico e semântica de status implementados como preset editável por tenant; validar transições reais durante onboarding.
- Modelo de acesso (tenant → unidade → atribuição/fila) aprovado.
- Catálogo de procedimento distingue minutos de atendimento e dias de efeito/retorno.
- Custos e responsabilidades dos canais claros; MKP Meta-only; provedor e política de demais categorias definidos.
- Processo de consentimento/opt-out e templates aprovados.
- Regras de fidelidade e indicações fechadas, sem recompensa atrelada a avaliação Google.
- Política de retenção para histórico e dados sensíveis definida.
- Arquitetura/fila escolhidas após prova técnica com versões reais dos provedores.
- Conta/documentação Uno autorizada revisada; matriz de campos e fonte autoritativa da agenda definidos; fluxo de conflito e sincronização homologado.
- Métricas de sucesso do piloto definidas: tempo de resposta, ocupação/confirmados, falhas/duplicatas, handoffs e custo por finalidade.

## 11. Ciclo de engenharia depois da aprovação

Aplicado neste incremento: comparação dos módulos de IA e cotas antes da implementação; adaptação dos padrões sem copiar contratos `storeId`; build, lint, migração e e2e PostgreSQL; leitura e atualização dos documentos de plano/execução. Revisões independentes adicionais e auditoria de produção continuam pendentes.

1. **Verificar:** pesquisar código existente, modelos, endpoints e integrações antes de criar algo.
2. **Refatorar/Criar:** implementar um módulo por vez, respeitando tenant/unidade e adaptadores.
3. **Testar:** validar compilação, tipos e testes relevantes localmente; incluir testes de IDOR/tenant/unidade, concorrência de agenda, deduplicação de webhook e jobs idempotentes.
4. **Relatar:** explicar o que mudou, evidência de validação, limitações e próxima etapa antes de avançar.

Campanhas e automações devem começar desativadas em ambientes novos. Envio real, migração e deploy ficam como etapas separadas e aprovadas no fluxo de execução.


## Integridade Prisma, testes comerciais e validacao real de interface - 18/10/2026

- Auditoria: 26 migrations; todas aplicadas na base de desenvolvimento, status atualizado e diff estrutural vazio. Registros antigos de rollback/checksum existem em duas migrations historicas; sem Git local, nao foi possivel comparar com arquivos originais. Nenhuma migration historica foi alterada.
- Instalacao limpa reproduzivel em duas bases descartaveis PostgreSQL, separadas da base de desenvolvimento; deploy em ordem e validacao/status finais passaram.
- Corrigido o retorno do lead publico. Voucher expirado agora tem status EXPIRED confirmado antes da resposta HTTP 409; antes a excecao revertia a transacao.
- Playwright 2/2 em Chromium: jornada admin/publica de campanha, lead, associacao, aprovacao, emissao, validade, resgate e cartao; teste de privacidade sem cadastro ou consentimento automatico.
- Final: E2E API 47/47 serial em 4 arquivos; Playwright 2/2; API lint/build, Web build, Prisma validate/status passaram. Web lint passou com 7 avisos React. Nenhuma falha ou interrupcao de infraestrutura na execucao final. Duas tentativas com flags invalidas nao iniciaram os testes e foram repetidas corretamente.
- O marco de 20 e ficticio/local. Sem carga deste motor, chamadas Meta/Evolution, disparos, consulta Evolution ou escrita Uno; integracoes externas nao homologadas.

## Atualização de estabilização - senha provisória no primeiro acesso (19/10/2026)

O fluxo de criação e redefinição direta de acessos clínicos foi validado funcionalmente. O backend bloqueia rotas protegidas até a troca obrigatória de senha, sem depender do estado do frontend. Gerente, operador e administrador clínico criado pelo Superadmin passam pelo fluxo; o login Superadmin com MFA foi exercitado no navegador.

Validações focadas aprovadas: API primeiro acesso 4/4, regressão auth 5/5, regressão de segurança da Fase 10 6/6 e Playwright 2/2; builds API/Web, Prisma validate/status aprovados. O status do banco descartável está atualizado em 31 migrations e nenhuma migration nova foi criada. O lint direcionado Web passa com avisos React existentes. A suíte E2E completa não foi repetida; esta entrega não declara aprovação integral de produção.
## Continuação da revisão geral — 19/10/2026

**Registro histórico de uma rodada anterior; foi supersedido pela reconciliação atual em `QA_CLAUDE_48_ACHADOS.md` e `QA_CLAUDE_FECHAMENTO_CORRECOES.md`. O anexo foi tratado conforme orientação do usuário: usar as verificações nele listadas.**
## Revalidação final após atualizar os roteiros — 19/10/2026

- A suíte Playwright completa passou **14/14**, um worker, na base descartável `clinic_browser_validation`, usando portas locais isoladas. Os seis erros da primeira rodada foram investigados; eram uma combinação de URLs/endereços do harness, seletores desatualizados, fixture Superadmin com slug fixo, jornada de convite obsoleta e um acesso MFA preenchido no mecanismo errado. Os roteiros foram alinhados ao produto atual e repetidos.
- API build/lint e Web build/lint passaram nesta rodada. O Web lint mantém avisos React de efeitos/dependências e leitura de relógio durante renderização.
- Prisma validate passou; migrate status confirmou o banco de desenvolvimento `clinic` atualizado com **31 migrations**.
- O Playwright cobriu Agenda (5), Dashboard (1), primeiro acesso/MFA (2), Equipe/Privacidade (1), Superadmin (1), Indicações (2), Relatórios/NPS (1) e visualização responsiva (1). Os 57 E2E API focais registrados nesta revisão passaram em execuções isoladas anteriores desta mesma continuação; não foram repetidos nesta última rodada.
- Registro histórico da execução anterior: 14/14 corrigiu 8/14. A reconciliação atual dos 48 itens e a decisão do expediente estão nos documentos QA; consulte-os para o estado vigente.
- Nenhuma migration ou alteração na base `clinic`; sem chamadas externas, VPS, Uno, cobranças ou carga.


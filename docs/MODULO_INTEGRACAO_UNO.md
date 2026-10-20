# Módulo de integração UNO — especificação para o SaaS

**Status:** especificação complementada por MVP local em `api/src/uno/` e tela de configuração em `web/src/App.tsx`; credenciais, categorias/campos e recebimento filtrado de eventos estão implementados. Escrita, sincronização bidirecional e troca da agenda autoritativa permanecem desativadas até homologação.  
**Escopo:** permitir que uma empresa/administrador configure conexão à Uno por unidade, escolha as categorias e campos autorizados para uso pelo nosso produto, receba eventos e envie agendamentos quando a API permitir.

## 1. Objetivo

Reduzir recadastro e retrabalho para clientes que já usam a Uno. O módulo integra os dados e ações que a conta do cliente estiver autorizada a disponibilizar, mantém associação entre registros internos e IDs externos e oferece controle explícito sobre o que será recebido, armazenado ou usado em automações.

A Uno segue como sistema que o cliente já usa. O produto novo mantém CRM, inbox, automações e relatórios. Para agenda, cada unidade deve ter uma política explícita de fonte de verdade: **UNO integrada** ou **agenda nativa**. Não operar duas agendas como fonte autoritativa ao mesmo tempo.

## 2. O que a documentação pública consultada comprova

1. A Uno documenta `GET /v1/scheduler/hours` para disponibilidade numa data, com `serviceId` opcional e `franchiseIdentifier` opcional, autenticado com `x-uno-access-token` e `x-uno-secret-key`. [Endpoint de horários](https://readme.unobject.com.br/reference/get_scheduler-hours)
2. A Uno documenta `POST /v1/scheduler/create` com data/hora, nome e celular obrigatórios e campos opcionais para sala, serviço, identificador de franquia e política de atualizar um agendamento existente. [Criar agendamento](https://readme.unobject.com.br/reference/post_scheduler-create)
3. A Uno documenta `POST /v1/lead` para criar lead; a resposta indicada também cobre lead já existente. [Criar lead](https://readme.unobject.com.br/reference/post_lead)
4. A Uno documenta webhooks configurados na interface da própria Uno para eventos de agendamento (`APPOINTMENT_CREATED`, `APPOINTMENT_UPDATED`, `APPOINTMENT_REMOVED`) e vendas (`ORDER_CREATED`, `ORDER_UPDATED`). A carga de agendamento inclui IDs, início/fim, observação, sessão de serviço, status e relações cliente/profissional/sala/serviço por `{id,name}`. A carga de venda inclui status e totais, mas **não inclui formas/parcelas/valores por transação**. [Webhooks Uno](https://readme.unobject.com.br/reference/webhook)
5. O webhook tem token no header `X-UNO-Webhook-Token`, sem assinatura do corpo; entrega at-least-once, sem retry automático, timeout de 10s, sem ID de entrega, e limite documentado de até três webhooks ativos por conta. Payload de agendamento pode trazer data com offset do timezone da empresa.
6. O guia público indica credenciais exclusivas por unidade. A configuração de eventos/webhooks é feita no painel Uno pelo usuário que tenha permissão. Precisamos que o administrador do cliente participe desse onboarding. [Guia de credenciais e uso](https://ajuda.unobject.com.br/pt-br/articles/65-documentacao-da-api-de-criacao-de-leads-e-agendamentos)

**Não comprovado nesta pesquisa:** endpoint de listagem/extração histórica de pacientes/agendamentos, endpoint de reagendamento/cancelamento dedicado, relação completa paciente↔sessões, leitura detalhada de saldo/pagamentos, escopos de credencial por campo, sandbox, limites de rate e política completa de suporte. A documentação pode ter mudado ou ter endpoints não localizados; validar com o cliente e suporte Uno antes de contratar comportamento do MVP.

## 3. Configuração pelo administrador

Criar tela **Configurações → Integrações → Uno**, disponível ao administrador do tenant e, opcionalmente, a um gerente com permissão explícita. O Superadmin tem acesso global aos dados de tenants conforme decisão do produto, mas segredos de integração nunca são revelados em texto claro; ele pode auditar, substituir ou revogar credenciais.

### Etapa A — conectar a unidade

- Selecionar unidade do nosso sistema e ambiente/conta Uno correspondente.
- Informar as credenciais Uno daquela unidade em formulário seguro. Na documentação pública consultada, os nomes dos headers são `x-uno-access-token` e `x-uno-secret-key`; usar rótulos como `Client ID/Client Secret` apenas se a Uno confirmar que são os valores equivalentes no contrato do cliente.
- Armazenar segredos criptografados no backend; exibir apenas estado/configuração parcial após salvar; permitir substituir e revogar.
- Botão **Testar conexão** que valida autenticação sem listar dados pessoais nem deixar segredo em logs.
- Exibir status conectado, falha, credencial expirada/revogada, última confirmação e próxima ação.
- Na inbox do operador, indicar por unidade a fonte autoritativa em uso: `Uno · Conectada` com horário da última sincronização, ou `Agenda nativa · Ativa`. Se houver falha/atraso, usar alerta explícito de dados possivelmente desatualizados; status verde só com confirmação recente.

### Etapa B — selecionar dados e eventos

Expor lista de controle separando **permissão configurada na Uno** de **dados que nosso sistema processa**:

| Categoria | Eventos/dados reconhecidos na documentação | Configuração local recomendada |
|---|---|---|
| Agendamentos | Criado, alterado/reagendado, removido; horário, serviço, sessão, status, cliente, profissional, sala e observação. | Ativar eventos necessários; selecionar campos que serão persistidos/utilizados; observação desligada por padrão; mostrar mapa de campos local↔Uno. |
| Disponibilidade | Consulta de horários por data/serviço/unidade. | Permitir consulta sob demanda pelo fluxo de agendamento, com limite e cache curto se seguro. |
| Criar agendamento | Criar com data/hora/nome/celular e parâmetros opcionais; API documenta também `allowUpdateAppointment`. | Permitir escrita só depois de provar comportamento de update, duplicidade e confirmação com conta de teste/cliente. Administrador habilita escrita separadamente de leitura. |
| Leads | Criar lead a partir de nome/celular e campos opcionais. | Opt-in por categoria; deduplicar antes de enviar; registrar resultado e ID externo se retornado. |
| Vendas | Criação e transições fortes; status, totais e cliente/itens. Não inclui detalhes de transações de pagamento. | Desativado por padrão. Habilitar somente se cliente autorizar finalidade financeira; restringir cargos e campos exibidos. |

Administrador pode desmarcar dados/categorias no sistema a qualquer momento. Ao desligar uma categoria, suspender novos usos e oferecer política clara para registros existentes (manter, anonimizar ou apagar) conforme retenção acordada.

**Limite importante:** checkboxes do nosso sistema determinam o que vamos processar/guardar e quais funcionalidades podem usar esses dados; não concedem nem revogam sozinhos permissões dentro da Uno. Credenciais, eventos e permissões precisam também ser autorizados/configurados na Uno. Se um evento for habilitado no painel Uno, o payload inteiro chega ao endpoint antes de nossa filtragem; portanto devemos solicitar na Uno apenas eventos necessários, validar token, receber o mínimo, filtrar imediatamente e não registrar payload bruto por padrão.

### Etapa C — configurar webhook Uno

- Gerar endpoint HTTPS por tenant/unidade e um segredo aleatório para o cabeçalho esperado pela Uno.
- Exibir instruções para o administrador cadastrar URL, token e eventos selecionados em **UNO → Configurações → Integrações → Webhooks**.
- Validar handshake/evento de teste, mapear o `schema` da Uno à empresa/unidade corretas e guardar auditoria de ativação.
- A Uno não documenta assinatura do corpo; não tratar o token simples como assinatura. Usar TLS, segredo longo/rotacionável, comparação segura, rate limit, proteção contra replay/dedupe e alerta de evento inválido.
- Responder 2xx apenas depois de persistir o envelope necessário em inbox/fila durável; processar fora do request e dentro do timeout de 10 segundos.

## 4. Sincronização, fonte de verdade e conflitos

### Políticas por unidade

1. **Agenda nativa como padrão inicial:** todas as unidades começam operando na agenda nativa até que a conexão Uno, permissões, eventos e endpoints necessários passem nos testes de homologação.
2. **UNO como agenda autoritativa (opção ativada depois):** quando a conexão for testada e o administrador confirmar a ativação, nosso sistema consulta disponibilidade, solicita criação/atualização somente em operações homologadas, recebe eventos por webhook e mantém espelho operacional. Mudanças feitas no painel Uno atualizam nosso estado.
3. **Agenda nativa como autoritativa (opção permanente):** nosso sistema cria/reserva localmente e a conexão Uno pode ficar desligada ou enviar apenas leads/dados autorizados. Não afirmar que marcou na Uno.
3. **Não permitir dois masters em paralelo.** Um campo de configuração registra source-of-truth, direção (Uno→nós, bidirecional conforme capacidade validada), política de conflito e responsável por resolver divergências.

### Regras de processamento

- Relacionar entidades por `provider + schema/empresa Uno + ID externo`; não associar pessoas apenas pelo nome. Payload de agendamento não inclui telefone do cliente, então a associação pode exigir mapeamento prévio ou revisão humana.
- Persistir uma cópia mínima do evento normalizado, IDs, versão interna do processamento e hash/dedupe; não guardar body original completo salvo prazo curto para diagnóstico autorizado.
- Deduplicar reentrega; processar idempotentemente; eventos para recursos diferentes não têm ordem global garantida.
- O webhook pode não ser reentregue automaticamente. Monitorar falhas no painel Uno e permitir reprocessamento do nosso inbox. Reconciliação/polling só será especificada se a API disponibilizar endpoint de listagem.
- Evento removido atualiza estado como removido/cancelado conforme semântica aprovada; não apagar silenciosamente histórico local.
- Reagendamento: webhook de `APPOINTMENT_UPDATED` cobre alteração, mas a documentação pública não mostra um endpoint dedicado. Verificar `allowUpdateAppointment` antes de depender dele para reagendar; confirmar ID externo e resultado antes de responder “reagendado”.
- Se a disponibilidade consultada ficar obsoleta ou a escrita falhar, oferecer novos horários ou transferência humana; não reservar apenas no espelho local quando Uno é a fonte.
- Datas Uno chegam com offset local; preservar instante e timezone; validar mudanças de fuso.

## 5. Dados financeiros e permissões

- Vendas podem trazer totais como total, pago, desconto e status, mas não comprovam parcelas, forma de pagamento, histórico de recebimentos ou “saldo/sessões disponíveis” completo.
- Não calcular elegibilidade do paciente com base apenas em `totalPrice - totalPaid` até regras e consistência serem validadas.
- Administrador escolhe se a empresa habilita dados de venda e quais perfis podem consultá-los; gerente/operador recebem somente campos necessários às tarefas autorizadas.
- IA recebe uma resposta de domínio mínima (por exemplo, “pode prosseguir/transferir para recepção”) em vez de valores detalhados, quando isso bastar para o fluxo.

## 6. Fluxos iniciais

### Configuração

Admin seleciona unidade → salva credenciais → testa → seleciona categorias/eventos/campos → escolhe fonte da agenda → configura webhook no painel Uno → valida evento → estado vira “Ativo”. Falhas mostram ação corretiva sem revelar segredo.

### Atendimento e reagendamento

Paciente conversa → IA identifica a intenção → encontra paciente com método autorizado → consulta serviço/unidade/datas disponíveis na Uno (se API e cadastro permitirem) → mostra opções → paciente confirma → aplicação valida e escreve no Uno → aguarda resultado/evento de confirmação ou consulta de verificação → registra vínculo e responde. Qualquer ambiguidade, conflito ou falha vai para recepção; não simular sucesso.

### Reduzir recadastro

Quando um lead é criado/atualizado em fonte local, admin pode autorizar criação de lead Uno. Antes, deduplicar local e aplicar limite; guardar resposta/ID externo. A sincronização de pacientes existentes em lote só entra após identificar endpoint de leitura/exportação real; alternativas de primeira carga são exportação autorizada e importação assistida.

## 7. Requisitos de aceite do módulo (para futura implementação)

- Credenciais isoladas por tenant/unidade, criptografadas e nunca expostas em logs ou respostas.
- Usuário sem permissão não pode ver nem alterar integração, mesmo conhecendo a URL da API.
- Admin pode ativar/desativar categorias e configurar campos aceitos; interface explica que a autorização Uno é concedida separadamente.
- Webhook rejeita token incorreto, faz persistência rápida, não perde eventos e não executa duas vezes efeito duplicável.
- Eventos repetidos e fora de ordem não regridem incorretamente o estado.
- Teste de disponibilidade seguido de criação trata conflito, resposta incerta e falha sem declarar marcação concluída indevidamente.
- `schema` Uno sempre mapeia à unidade/tenant correto; evento desconhecido fica retido para diagnóstico sem executar ação.
- Teste de credenciais isolado não ativa sincronização bidirecional automaticamente; exigir também seleção local de dados, permissões/eventos na Uno, evento de prova e confirmação explícita do administrador.
- Dados não selecionados não são persistidos nem usados em automações; payload bruto não é retido por padrão.
- Admin vê último evento, contagem de falhas e ação recomendada; suporte só acessa com concessão temporal auditada.
- Escrita (criar/atualizar) fica desligada até teste de aceitação na conta autorizada do cliente.

## 8. Fases

1. **Descoberta técnica:** obter documentação completa pelo cliente/suporte, mapear credenciais por unidade e políticas; confirmar endpoints de leitura de pacientes/agendamentos, sessões/saldo, cancelamento/reagendamento, limite, sandbox e webhooks.
2. **Conexão e eventos de leitura:** tela de conexão, seleção de eventos, endpoint seguro, processamento idempotente e mapeamento; piloto em ambiente do cliente.
3. **Disponibilidade e escrita controlada:** consulta de horários e criação; depois update/reagendamento somente se a API e o fluxo real confirmarem semântica segura.
4. **Automação/IA:** usar somente campos permitidos e testar handoff; gradual, com logs e aprovação humana.
5. **Importação histórica:** apenas após confirmar endpoint/exportação autorizada e estratégia para deduplicação, conciliação e retenção.

## 9. Fontes consultadas

- [Documentação geral/credenciais Uno](https://ajuda.unobject.com.br/pt-br/articles/65-documentacao-da-api-de-criacao-de-leads-e-agendamentos)
- [Disponibilidade de horários](https://readme.unobject.com.br/reference/get_scheduler-hours)
- [Criação de agendamento](https://readme.unobject.com.br/reference/post_scheduler-create)
- [Criação de lead](https://readme.unobject.com.br/reference/post_lead)
- [Webhooks de agenda e venda](https://readme.unobject.com.br/reference/webhook)

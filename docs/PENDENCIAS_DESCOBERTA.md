# Descoberta do SaaS de clínicas — decisões e pendências

**Status:** inventário dos sistemas de referência e decisões das fases 1–7 registrados. Permanecem pendentes decisões de onboarding/piloto, validações com cliente, privacidade/retenção, operação comercial e homologação de integrações; ver [Plano do projeto](../PLANO_PROJETO.md) e [Registro de implementação](./REGISTRO_IMPLEMENTACAO.md).  
**Objetivo:** registrar respostas já recebidas e as decisões que ainda precisam de validação com o cliente.

## Decisões e direcionamentos recebidos

- **Produto:** SaaS multiempresa, com Superadmin da plataforma, Administrador da clínica, Gerente de unidade e Operador. Escopos e permissões devem ser configuráveis pelo administrador, respeitando limites seguros da plataforma.
- **Agenda/Uno:** Uno é um sistema já usado pelo cliente e a integração é importante para reduzir retrabalho. Haverá módulo Uno configurável por unidade. A integração e seus limites estão descritos em [Módulo Uno](./MODULO_INTEGRACAO_UNO.md). A disponibilidade de cada operação depende de documentação, credenciais e homologação; não presumir acesso irrestrito a dados.
- **Agenda nativa:** deve continuar disponível como alternativa. A fonte autoritativa (Uno ou agenda nativa) precisa ser escolhida por unidade, evitando dupla escrita ambígua.
- **Canais:** modelo híbrido com Meta Oficial e Evolution, em adaptadores separados. MKP/campanhas em massa somente pela Meta Oficial. Planos, limites, contas e custos serão administrados pelo Superadmin, seguindo como referência o CRM Turismo.
- **Catálogos SaaS:** serviços/procedimentos, durações, regras de retorno, perguntas de NPS, textos e marca devem ser editáveis por tenant. Pode haver uma configuração inicial orientada à Maislaser, sem limitar clínicas de nutrição ou outros segmentos.
- **Robô de retorno:** configurar duração estimada em dias e antecedência. Exemplo: duração 30 dias e antecedência 5 dias gera contato no dia 25 após o evento de atendimento elegível. Não confundir com duração da agenda em minutos.
- **Pós-atendimento:** proposta inicial é enviar pesquisa 24 horas após atendimento concluído, com perguntas configuráveis. Respostas negativas geram tarefa/alerta para equipe; a IA não deve oferecer orientação clínica.
- **Termos:** proposta de disparo quando o atendimento entrar em uma etapa de documentação pendente; gatilho, etapa e conteúdo precisam ser validados.
- **Indicação/fidelidade:** criar módulo com link rastreável e aprovação humana. Conversão e recompensa serão configuradas pelo cliente. Não conceder benefício automaticamente com base apenas em clique ou status ambíguo.
- **Horários e fuso:** horário comercial configurável por tenant/unidade e envio fora da janela pode ser enfileirado para o próximo horário permitido. Fuso global fixo: `America/Sao_Paulo`.
- **Privacidade:** seguir a LGPD, proteger dados com criptografia e revisar segurança continuamente. Histórico de mensagens é necessário, sem transformar o CRM em prontuário. A exclusão/anonimização e retenção seguem processo definido, ainda sujeito a validação jurídica e prazos por finalidade.
- **Superadmin:** o Superadmin da plataforma terá acesso a todos os dados. Ações de leitura/alteração de dados de pacientes devem ser registradas em auditoria.
- **Indicação:** conversão no primeiro agendamento com status `PAID` **ou** `COMPLETED`; autoindicação por CPF/telefone coincidentes é bloqueada; voucher vence 90 dias após emissão; recompensa depende de aprovação humana.
- **Agenda:** construir agenda clínica completa, começando por um fluxo-base configurável e ajustável conforme o retorno dos clientes.
- **Operação e permissões:** entregar módulos completos como produto, com pipeline básico e configurações editáveis por tenant. Administrador da clínica configura permissões e escopos dos gerentes e operadores.
- **Descoberta do MVP:** como o SaaS será apresentado a mais de um segmento, preparar um MVP amplo por módulos, com configurações padrão editáveis, e validar a priorização no piloto.
- **Refinamentos de UX da inbox:** SLA padrão de 15 minutos por conversa sem resposta, configurável por clínica, com cronômetro verde dentro do prazo e alerta após vencimento; rascunho IA aguardando aprovação não encerra o SLA. Identificar cada mensagem enviada como IA autônoma, rascunho IA aprovado por pessoa ou enviada por pessoa; autonomia permanece desligada no piloto. Mostrar no topo da inbox a fonte da agenda da unidade (`Uno conectada` com horário da última sincronização, ou `Agenda nativa ativa`) e alertar quando o dado externo estiver potencialmente desatualizado. Referência visual atualizada em [Atendimento](./referencias_visuais/conceito_atendimentos.svg).

## Automações — proposta para validar

1. **Retorno por procedimento:** programar a partir da conclusão de atendimento/procedimento e da regra `duracaoRetornoDias - antecedenciaDias`. Definir comportamento se Uno atualizar/cancelar o evento ou se o paciente já tiver novo agendamento.
2. **Pesquisa pós-atendimento:** executar 24 horas após conclusão, se não houver cancelamento/duplicidade. Nota baixa abre tarefa privada para a equipe. A pesquisa e o convite público devem ter fluxos separados.
3. **Convite para avaliação pública:** se usado, enviar solicitação neutra a todos os clientes elegíveis, sem selecionar pelo NPS. Não oferecer recompensa por avaliação nem enviar o link só a quem avaliou positivamente.
4. **Termos/documentos:** disparar por etapa validada do pipeline, com conteúdo aprovado pelo cliente e trilha de envio/aceite.
5. **Indicação:** proposta de envio 48 horas após primeira sessão elegível. Conversão no primeiro agendamento com status `PAID` ou `COMPLETED`; voucher 90 dias após emissão; limites e catálogo de recompensa são configuráveis.

## Acesso e Kanban

- Administrador configura permissões e se operadores veem fila da unidade, apenas atendimentos atribuídos ou uma combinação; gerente vê suas unidades conforme permissões. A autorização é validada no backend.
- Não reutilizar `sellerId` do CRM Turismo como atribuição clínica. Criar conceito próprio de responsável/operador atribuído.
- CRM Turismo é a referência principal para experiência de Kanban e alguns padrões de organização, mas não foi validado como agenda clínica completa. Combinar a visão de pipeline com calendário e recursos da agenda; não copiar seus status sem validação.
- Pipeline pré-configurado e editável por tenant está no plano do projeto; estados de conversa e de agendamento devem permanecer separados.

## Planos e limites — proposta inicial para validar

O Superadmin administra planos, cotas e recursos habilitados. Proposta comercial informada pelo usuário:

| Plano | Preço mensal proposto | Pacientes ativos | Mensagens/ciclo 30d | Usuários simultâneos | Unidades* | WhatsApp* | Campanhas/ciclo* |
|---|---:|---:|---:|---:|---:|---:|---:|
| Starter | R$ 97 | 500 | 1.000 | 1 | 1 | 1 | 3 |
| Profissional | R$ 197 | 1.500 | 3.000 | 3 | 1 | 1 | 20 |
| Enterprise | R$ 397 | Sem limite comercial | 10.000 | 10 | 3 | 3 | 100 |

*Unidades e conexões reaproveitam como defaults editáveis os níveis anteriores; cotas de campanha 3/20/100 vêm do seed do CRM Turismo, mas foram contagens acumuladas no código atual. No novo SaaS passam a representar campanhas lançadas por ciclo, conforme a proposta. Superadmin também configura Meta/Evolution/Uno e armazenamento. Limite simultâneo de automações e quota de agendamentos serão campos dos entitlements; usar inicialmente a mesma escada 3/20/100 para automações ativas e sem teto de agendamentos, ambos editáveis pelo Superadmin.

**Medição:** mensagens e campanhas são cotas de consumo por ciclo de cobrança, com início/fim explícitos e ledger idempotente; não resetar contadores simplesmente pelo cron. Usuários, unidades, conexões, pacientes ativos e quantidade máxima de automações ativas são limites de capacidade/estoque e não “zeram” no aniversário. Agendamentos ficam sem limite padrão, com entitlement configurável para futuro uso.

**Referência ao CRM Turismo:** o seed contém cotas de exemplo, mas o código consultado não implementa reset mensal: [`usage.service.ts`](<E:/Documentos/Crm Turismo programa/server/src/usage/usage.service.ts>) conta campanhas e mensagens sem filtro por ciclo e `increment()` está vazio. Portanto, a cobrança cíclica será comportamento novo do sistema clínico, a ser implementado, não uma capacidade pronta que devemos presumir reutilizável.

Os preços informados ficam como proposta inicial a modelar. iClinic publica planos por profissional entre R$ 99 e R$ 299/mês; Clinicorp publica Standard/Premium por volta de R$ 159,90/R$ 369,90 e Enterprise sob consulta. São referências de posicionamento, não comparação direta nem confirmação de margem. Como Essencial assumirá os custos de Meta e infraestrutura Evolution, antes de venda validar custos variáveis, limites de envio, margem por plano e política de uso justo. Fontes: [iClinic — preços](https://iclinic.com.br/precos/) e [Clinicorp — planos](https://www.clinicorp.com/planos).

## Pendências para planejamento e onboarding

- **Uno:** o módulo permitirá ao administrador configurar conexão e opções por unidade. Planejar os campos e fluxos do módulo agora; homologar operações quando o cliente inserir credenciais autorizadas. Não presumir endpoints/escopos ainda não confirmados.
- **Agenda:** entregar agenda clínica completa com defaults editáveis para profissionais/recursos, horários, duração, buffers, bloqueios, feriados, encaixe, confirmação, reagendamento, cancelamento, falta e conclusão. Ajustar com os clientes conforme a operação real.
- **Automações e pipeline:** o cliente ainda não forneceu inventário atual; criar exemplos/defaults do MVP e permitir edição por tenant. Rever textos, cadências e gatilhos durante onboarding.
- **Permissões:** administrador do tenant configura permissões e escopos de gerente/operador, fila e atribuição. O produto define presets seguros e ações permitidas.
- **Escopo do MVP:** direcionamento é apresentar produto modular amplo, adequado a mais de um segmento, com módulos base completos e configuração inicial. As metas estão propostas; definir clínica/unidade piloto, linha de base para tempo ocioso e critério de medição antes do período de 30 dias.
- **Indicação:** a resposta mais recente define conversão quando o primeiro agendamento do indicado ficar `PAID` **ou** `COMPLETED` (qualquer uma das condições), autoindicação barrada quando CPF ou telefone corresponder ao indicador, e voucher com validade de 90 dias após emissão. Recompensa continua sujeita a aprovação humana.
- **Planos:** nomes, preços e cotas principais foram propostos acima. Entitlements ficam configuráveis no Superadmin. Validar margem e condições comerciais antes de publicar; “sem limite” de pacientes deve vir acompanhado de limites técnicos/uso justo transparentes.
- **Contas e canais:** a Essencial assume custos Meta/Evolution dentro das mensalidades. Definir posse/onboarding dos números, fallback e limites de custo/uso justo; ao atingir cota, impedir novo envio sem apagar dados e oferecer upgrade.
- **Consentimento:** decisão recebida de coletar opt-in e aceitar comandos exatos `SAIR`, `STOP` e `CANCELAR`. Para não tratar a checkbox como prova sem evidência, registrar origem, finalidade/categoria, canal, versão do texto e ator/data da coleta; contatos sem consentimento comprovável ficam inelegíveis a mensagem proativa. Opt-out deve ser respeitado e auditado.
- **NPS e textos:** escala 0–10 e pergunta padrão definidas; detratores 0–6 geram alerta privado. Não usar promotores como filtro para convite público Google; substituir por convite neutro enviado igualmente aos clientes elegíveis, conforme política do Google. Aprovar a redação compatível antes de ativar.
- **Cadastro/importação:** amostra e regras ainda não disponíveis. Manter importação com mapeamento, prévia e relatório de duplicatas; definir campos finais ao receber amostra autorizada e anonimizada.
- **LGPD/segurança:** proposta de papéis: clínica Controladora e Essencial Operadora, a validar contratualmente conforme o tratamento real. Criptografar e minimizar dados. Hash determinístico de nome/CPF não é anonimização garantida; usar pseudonimização/anonimização com avaliação de risco, segregação de chaves e validação jurídica. Manter IDs financeiros somente com finalidade e prazo de retenção definidos; referências relacionáveis também podem continuar sendo dado pessoal.
- **Marca/visual:** foram consultadas referências públicas de iClinic e Clinicorp. Os dois mockups anexos são uma proposta original, não cópia; nome e paleta finais ainda serão aprovados: [Dashboard](./referencias_visuais/conceito_dashboard.svg) · [Atendimento](./referencias_visuais/conceito_atendimentos.svg).
- **Superadmin:** acesso a todos os dados já está decidido. Definir formato da auditoria de leituras/alterações e autenticação forte; credenciais de integração permanecem secretas (não exibidas em texto claro) e podem ser substituídas/revogadas.
- **Fuso:** definido globalmente como `America/Sao_Paulo` para todas as unidades.
- **Metas de piloto:** NPS respondido por mais de 20% dos convites entregues; reduzir em 30% o tempo ocioso da recepção em comparação com linha de base definida; meta de zero suspensão/bloqueio de número em 30 dias. Suspensões dependem também de enforcement/qualidade de terceiros e zero bloqueios não pode ser garantido tecnicamente.
## Correções importantes já aplicadas

- A integração Uno substitui a anotação antiga de “sem integração”; a agenda própria permanece como alternativa.
- `sellerId` não será usado como autorização clínica. A atribuição terá conceito separado.
- Incentivo ou convite público condicionado à nota positiva foi removido da proposta: Google proíbe solicitação seletiva de avaliações positivas e incentivos ligados a avaliações. Ver [política do Google Maps](https://support.google.com/contributionpolicy/answer/7400114?hl=pt-BR).
- O horário comercial do Sistema OS v4 é referência de comportamento a validar, não reutilização automática de código nem mecanismo completo de consentimento. Preferência/opt-out deve ser persistente e por canal/finalidade; uma tag simples não substitui isso.
- O Superadmin terá acesso a todos os dados por decisão do produto; registrar consultas e alterações sensíveis e aplicar autenticação forte e revisão de segurança.
- Limites iniciais foram derivados das cotas no seed do CRM Turismo e adaptados para pacientes/unidades. Não são prova de preço ou capacidade ideal de escala.

## Solicitação separada, fora do escopo desta descoberta

Foi colado neste arquivo um pedido para auditar menus, UX, MRR, impersonation, escala para 500 pet shops e telas de um painel existente. Esse pedido não descreve o SaaS de clínicas e não há um painel novo implementado para inspecionar nesta fase. Manter como trabalho separado até existir um sistema/telas identificados para auditoria.


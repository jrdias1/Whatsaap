# Regras de arquitetura e execução

## Estado do trabalho

Fases 1–7 têm implementação local progressiva. O inventário de referência inicial foi feito; antes de cada módulo, continue verificando código vivo e reaproveite padrões ou componentes somente após validar domínio, versão e isolamento. Leia [PLANO_PROJETO.md](../PLANO_PROJETO.md) e [REGISTRO_IMPLEMENTACAO.md](../docs/REGISTRO_IMPLEMENTACAO.md). Não assumir que um módulo implementado está pronto para produção.

## Verificação antes de cada mudança

1. Procurar entidades, serviços, endpoints, fluxos e migrations equivalentes nos projetos-base.
2. Ler o módulo e o comportamento atual; não confiar só em documentos históricos.
3. Distinguir código reutilizável, padrão de projeto e código que não deve ser copiado.
4. Registrar decisões e suposições quando houver mais de uma interpretação.
5. Preferir extrair e adaptar um módulo existente; só criar código equivalente quando a revisão demonstrar que não há componente reutilizável ou que sua refatoração não atende ao domínio/segurança.

## Limites de domínio e integração

- Módulos isolados por domínio; serviços externos ficam atrás de adaptadores.
- Adaptadores separados para Uno, Meta Cloud API, Evolution/Baileys e IA. Marcar e exibir claramente se WhatsApp é oficial ou não oficial.
- A IA não executa ações nem envia resposta no piloto. Contexto externo é mínimo, autorizado e auditado; não mandar CPF/detalhes de saúde sem necessidade e validação da finalidade.
- MKP/campanhas em massa só podem usar Meta Cloud API.
- Integração Uno configurável por unidade. Agenda nativa é fonte inicial; só trocar para Uno após permissões, endpoints e webhooks necessários serem homologados e admin confirmar.
- Seleção local de campos limita processamento/armazenamento; não substitui permissões e eventos configurados na própria Uno.
- Integrações externas não acessam Prisma diretamente.
- Conversas, mensagens, agenda, campanhas e automações sempre incluem tenant e, quando aplicável, unidade.

## Autorização

- Verificar tenant, unidade, papel, permissão e atribuição no backend para cada operação.
- Admin de tenant não acessa outro tenant. Gerente e operador têm escopos de unidade explícitos.
- Fila compartilhada ou atendimento atribuído é política configurável do tenant, com trilha de quem assumiu/alterou o atendimento.
- Superadmin tem acesso global a dados de todos os tenants conforme decisão do produto. Implementar permissões explicitamente, sem bypass oculto; registrar em auditoria leituras/alterações de dados sensíveis, com ator e tenant.
- UI nunca é o controle de segurança.
- Proteger tráfego e armazenamento de dados sensíveis com criptografia, guardar segredos fora do banco/logs em texto claro e reduzir PII em logs. Revisar dependências, backups, controles de acesso e eventos de segurança antes de produção e periodicamente.
- Clínica é proposta de Controladora e Essencial de Operadora, sujeita a validação contratual/jurídica por finalidade. Hash determinístico de CPF/nome não é anonimização garantida; se vínculo auxiliar ou chave permanecer, tratar como dado pessoal pseudonimizado e aplicar salvaguardas.

## IA, humanos e comunicação

- No piloto, toda resposta/ação da IA passa por aprovação humana antes do envio/execução, conforme direcionamento recebido. Se o produto evoluir para respostas automáticas, definir previamente intents/respostas pré-aprovadas, limites de confiança, exceções e handoff; isso exige decisão e validação explícitas.
- A reserva só é confirmada após validação transacional de disponibilidade e confirmação inequívoca.
- Só declarar uma reserva Uno concluída após confirmação verificável da fonte; webhooks precisam de dedupe e processamento idempotente.
- Credenciais Uno criptografadas, nunca exibidas após salvar nem gravadas em logs. Não persistir campos não selecionados nem o body bruto por padrão.
- Conexão Uno e seleção de operações/campos são editáveis pelo administrador da clínica; a tela interna não concede permissões na Uno. Sem credenciais, limitar o desenvolvimento ao módulo configurável e homologar operações quando autorizado.
- Atendimento humano consegue assumir, pausar automações e revisar recompensas.
- Inbox mostra o SLA de cada conversa à espera de resposta: cronômetro reinicia com nova mensagem recebida e para somente após resposta efetivamente enviada por humano ou IA. Alvo padrão 15 minutos, editável por tenant; rascunhos aguardando aprovação não contam. Marcar visualmente estado no prazo/atrasado.
- Persistir origem de cada saída como enumeração auditável (`HUMAN`, `AI_AUTONOMOUS`, `AI_DRAFT_HUMAN_APPROVED`, `TEMPLATE` ou `SYSTEM`), referência ao autor/aprovador e horário; a UI mostra um rótulo e ícone consistentes. IA autônoma permanece desativada no piloto.
- Exibir na inbox a fonte ativa da agenda por unidade e estado da conexão/última sincronização (`UNO_CONNECTED`, `UNO_DEGRADED`, `UNO_DISCONNECTED`, `NATIVE_ACTIVE`). Nunca representar a fonte Uno como sincronizada quando a última confirmação estiver desatualizada; mostrar alerta de disponibilidade potencialmente obsoleta.
- MKP tem prévia, aprovação, limites, opt-out, pausa e histórico de execução.
- Recompensa não pode depender de avaliação pública Google; medir clique como clique, sem declarar que houve publicação.
- Converter indicação no primeiro agendamento quando fonte verificável reportar `PAID` ou `COMPLETED`; clique gera apenas `PENDING`. Autoindicação é barrada por telefone/CPF correspondente (CPF apenas se já existir e seu uso estiver autorizado). Voucher vence em 90 dias após emissão; recompensa exige aprovação humana.
- Não enviar conteúdo de saúde ou CPF a um modelo sem necessidade e autorização definida.
- Pesquisa NPS e convite para avaliação pública são fluxos separados. Nunca filtrar o convite público por nota/satisfação. Não condicionar voucher, desconto ou benefício a avaliação pública.
- Mensagens proativas exigem opt-in válido por canal/categoria; importação sem evidência de consentimento não habilita envio. Opt-out persiste como evento e suprime tarefas futuras, com estado/motivo auditável.

## Jobs e confiabilidade

- Persistir estado e chave idempotente para envio, webhook e automação; jobs têm retries limitados e estado terminal de falha.
- Não repetir envio cegamente quando o provedor não confirmou resultado; reconciliar pelo identificador externo quando possível.
- Respeitar `America/Sao_Paulo`, consentimento, opt-out, janela e limites configurados. Não iniciar mensagem de campanha/automação se o estado de consentimento exigido não estiver registrado e válido.
- Mensagens e campanhas usam ledger idempotente no ciclo de cobrança (30 dias, com início/fim registrados). Usuários, unidades, pacientes ativos, conexões e número de automações ativas são limites de capacidade que não reiniciam no ciclo.
- Campanhas e automações começam desativadas em novos ambientes.

## Validação e relato

Validar tipos, build e fluxos locais relevantes, incluindo isolamento tenant/unidade, concorrência de agenda, dedupe de webhook e ledger idempotente. Relatar alterações, evidências e limitações antes de avançar. Envio real, migração e deploy são etapas separadas.


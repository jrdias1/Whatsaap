# Regras de dados e banco

Regras para alterações do schema Prisma/PostgreSQL. O projeto já tem schema e migrations locais; cada mudança deve manter compatibilidade tenant/unidade e ser validada com migration e banco real de desenvolvimento.

## Escopo e isolamento

- Modelar Tenant/Empresa e Unidade como escopos distintos.
- Dados pertencem a um tenant; dados operacionais devem referenciar unidade quando aplicável.
- Permissões por papel não substituem filtros de escopo nem atribuição/fila.
- Definir chaves únicas e constraints compostas que impeçam cruzamento entre tenants/unidades.
- Cobrir isolamento com testes de acesso cruzado em listagem, detalhe, alteração, exportação e tarefas assíncronas.

## Conversa e IA

- Histórico de mensagens persistido é fonte de auditoria e precisa ser ligado a tenant, unidade, paciente, conversa e provedor.
- Guardar IDs externos para idempotência, direção, estado, timestamps e metadados mínimos.
- Separar mensagens reais de log interno de prompt/resposta de IA e de memória resumida/efêmera.
- Não guardar payload bruto do provedor por padrão; definir campos permitidos, mascaramento e retenção.
- Não incluir CPF nem detalhes sensíveis em logs técnicos.

## Privacidade e retenção

- CPF é dado pessoal: mascarar em interface/log, limitar acesso e não usar isoladamente para autenticação.
- Consentimentos são por finalidade/canal e guardam origem, instante e revogação.
- Definir retenção, anonimização e exportação por categoria de dado antes do piloto.
- Dados de saúde, financeiro, reputação e mensagem exigem finalidade, origem, permissão e política documentadas.

## Datas, dinheiro e integrações

- Instantes em UTC e timezone IANA do tenant/unidade para regras de calendário.
- Distinguir minutos do serviço na agenda e dias de duração/retorno do procedimento.
- Valores próprios do sistema em centavos inteiros; definir moeda e fonte da verdade.
- Integrações externas guardam referência externa isolada; nenhuma cópia financeira/sessão de fonte terceira vira verdade sem política de reconciliação.
- Mensagens, eventos externos e jobs usam chave idempotente para evitar duplicação.

## Migrações

- Migrations versionadas, revisáveis e compatíveis com deploy gradual.
- Para cada mudança: índices, impacto, migração de dados, backup/restore e rollback.
- Não tratar `db push` como plano de produção.
- A extensão `PrismaService.scoped` precisa conhecer explicitamente todo modelo tenant-owned novo. Operações `findUnique`, `findUniqueOrThrow`, `update`, `delete` e `upsert` preservam o seletor único top-level e recebem filtro tenant adicional; revisar cada nova operação contra a semântica do Prisma.

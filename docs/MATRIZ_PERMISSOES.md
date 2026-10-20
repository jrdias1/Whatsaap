# Matriz de permissões — clínica e plataforma

As permissões são aplicadas no backend; a interface só oculta navegação. O escopo de registros continua sujeito a tenant, unidade e atribuição.

| Ação | Superadmin | Admin da clínica | Gerente de unidade | Operador |
|---|---:|---:|---:|---:|
| Acessar painel global / catálogo de planos | Sim, MFA e auditoria | Não | Não | Não |
| Ler/administrar dados do tenant | Global segundo política do produto; auditoria sensível | Somente tenant próprio | Somente unidades atribuídas e conforme permissão | Dados de trabalho/unidade e atribuição conforme configuração |
| Listar equipe | Global administrativo | Tenant próprio | Escopo de unidades; somente subordinados permitidos | Não |
| Convidar/definir papel/unidade | Global administrativo, auditado | Admin/gerente/operador dentro dos limites do plano e tenant | Somente operador nas unidades sob sua gestão; sem elevação | Não |
| Atribuir `PLATFORM_SUPERADMIN` | Fluxo global próprio protegido | Nunca | Nunca | Nunca |
| Desativar/reativar membro | Global administrativo | Tenant próprio; último admin ativo protegido | Operadores do escopo permitido | Nunca a própria conta via rota de gestão |
| Revogar sessões de membro | Global administrativo | Membros do tenant autorizado | Membros do escopo permitido | Não |
| Emitir recuperação de senha clínica | Não usa recuperação clínica | Admin reautenticado, motivo e método de verificação declarados; somente conta clínica ativa | Não | Não |
| Configuração/tema/progresso | Identidade global Essencial não editável por tenant | Próprio tenant/unidades | Conforme permissões específicas | Não |
| Solicitações de privacidade | Acesso global conforme política/auditoria | Registrar e acompanhar tenant próprio | Não por padrão | Não |
| Exportar relatórios | Acesso global conforme política/auditoria | Tenant próprio, escopo permitido, exportação auditada | Unidade permitida | Conforme papel/escopo de relatórios |

## Invariantes

- Guardas e serviços verificam papel e contexto; `tenantId` vindo do cliente não concede escopo.
- Mudança de papel, status ou unidades revoga sessões correspondentes. Recuperação de senha revoga todas as sessões do usuário.
- A clínica não altera MFA/identidade de plataforma pelo fluxo de clínica.
- Unidades permitidas são uma restrição adicional ao papel, não substituto da autorização.
- O Superadmin global é uma decisão explícita do produto; leituras/alterações sensíveis devem ficar auditadas e a revisão de MFA/identidade permanece obrigatória.

Os testes de regressão cobrem operador/gerente, isolamento de tenant, revogação e MFA TOTP; esta matriz não substitui a revisão de cada endpoint.

## Senha provisória e administração de acessos

| Ação | Administrador da clínica | Gerente de unidade | Operador | Superadmin |
| --- | --- | --- | --- | --- |
| Criar gerente ou operador com senha provisória | Sim, limitado às unidades autorizadas | Não | Não | Sim, no contexto global com MFA |
| Trocar a própria senha provisória | Sim | Sim | Sim | Usa o fluxo próprio com MFA |
| Acessar operações antes da troca obrigatória | Não | Não | Não | Não se aplica à identidade Superadmin |
| Redefinir senha de outro usuário clínico | Sim, apenas identidade não compartilhada entre tenants | Não | Não | Sim, conforme autorização global e MFA |
| Redefinir senha global compartilhada por clínicas | Não | Não | Não | Sim, com aviso de impacto global |
| Emitir convite clínico novo | Não | Não | Não | Não; endpoint legado desativado |

A troca obrigatória é verificada no banco pelo guard. Ela não pode ser dispensada pelo navegador. A senha provisória nunca aparece em listagens, respostas de usuário ou auditoria; após redefinição todas as sessões anteriores são revogadas.
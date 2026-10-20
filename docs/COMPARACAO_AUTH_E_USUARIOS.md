# Comparação de autenticação, usuários e isolamento

**Data:** 17/10/2026  
**Escopo:** inspeção dos arquivos de autenticação, usuários, guards e middleware dos três sistemas NestJS disponíveis, seguida de prova reversível de compatibilidade.

**Revisão incremental de 17/10/2026:** a execução E2E encontrou que a extensão tenant aplicava `AND` em `findUnique`/`upsert` e operações que exigem seletor único. `api/src/prisma/prisma.service.ts` agora preserva esse seletor no topo e acrescenta o filtro tenant/unidade; regressão coberta pelo E2E real do PostgreSQL. Ainda não é RLS e não protege acesso raw/unscoped.

## Decisão de stack

**Manter NestJS 12 no projeto da clínica. Manter Prisma 6 durante esta etapa de preparação; abrir atualização para Prisma 7 antes da produção. Não alinhar para NestJS 10/Prisma 5.**

Prova reversível: copiei `api/src`, `api/prisma/schema.prisma` e configurações de build para uma pasta temporária fora do projeto. Nesse clone, Prisma 5.22 gerou client a partir do schema clínico e Nest 10.4.20 compilou a aplicação com TypeScript 5.7.3. Isso confirma compatibilidade técnica básica, mas não demonstra ganho de segurança ou compatibilidade de runtime dos módulos antigos. A pasta temporária não altera o projeto principal.

O downgrade compila, mas manteria o projeto numa geração anterior só para reduzir adaptação: o modelo `Store/storeId`, as relações de usuários e os guards continuam exigindo refatoração. NestJS 12 é a linha estável atual e a aplicação roda em Node 24.14; os geradores do CLI requerem Node 24.15 ou superior. Prisma 6 continua compatível com a implementação atual, mas sua janela de correções de segurança está prevista até 19/11/2026; portanto, a atualização para Prisma 7 deve ser concluída e verificada antes do primeiro release de produção. Não adotar Prisma 8 RC, pois a documentação atual lista lacunas de API relevantes ao projeto, incluindo `$extends`.

Referências oficiais consultadas: [guia de migração NestJS 12](https://docs.nestjs.com/migration-guide), [status de versões Prisma](https://www.prisma.io/docs/orm/release-status), [requisitos do Prisma](https://www.prisma.io/docs/orm/reference/system-requirements).

## Comparação arquivo a arquivo

### CRM Turismo — referência de fluxo e interface

| Arquivo | O que existe | Decisão para a clínica |
|---|---|---|
| `server/src/auth/auth.service.ts` | Login e cadastro com bcryptjs, hash de custo 12, JWT, validação de empresa/usuário e funções de senha. Consulta o usuário por `storeId`; não tem sessão persistida neste fluxo. | Reutilizar o padrão de hash e validações de credenciais. Refatorar para identidade global + Membership e sessão revogável. Não copiar consultas com `storeId` nem cadastro direto sem convite. |
| `server/src/auth/auth.controller.ts` | Rotas login, register, usuário atual, senha e gestão de usuários. Controle de papel aplicado parcialmente no controller. | Aproveitar os fluxos e contratos como referência. Centralizar autorização em guards e serviços da clínica, sempre com tenant/unidade do contexto autenticado. |
| `server/src/auth/dto/login.dto.ts`, `register.dto.ts`, `update-user.dto.ts` | DTOs com class-validator para login, cadastro e atualização. | Reaproveitar regras/validações depois de comparar com política de senha e cadastro via convite. |
| `server/src/auth/jwt.strategy.ts`, `jwt-auth.guard.ts` | JWT bearer com claim `storeId`; checagem adicional de empresa quando header/contexto está disponível. | Não copiar claim/guard. Na clínica JWT carrega tenant, membership e session; sessão é consultada no banco a cada chamada protegida. |
| `server/src/auth/auth.module.ts`, `super-admin.guard.ts` | Módulo de autenticação e controle de superadmin. | Referência de composição Nest. Rever bypasses antes de qualquer reutilização do superadmin. |
| `server/src/middleware/tenant.middleware.ts` | Define contexto `storeId` na requisição. | Reaproveitar a intenção de contexto, não o middleware. A clínica usa AsyncLocalStorage + interceptor e escopo do Prisma. |
| `server/src/scripts/test-idor.ts` | Cria dados sintéticos, testa isolamento e faz limpeza. O próprio relatório do projeto identifica limitações e pontos onde a proteção era apenas aparente. | Reaproveitar o método de fixtures/cleanup para testes reais da clínica; manter os casos encontrados como regressão. |

### Essencial Pet / PetControl — referência complementar

| Arquivo | O que existe | Decisão para a clínica |
|---|---|---|
| `server/src/auth/auth.service.ts` | Fluxos bcrypt/JWT, alteração de senha e dados de usuário. JWT ainda usa `storeId`; versão de token não foi localizada nesse serviço. | Reaproveitar fluxo/validação, não claims nem modelo de identidade. |
| `server/src/auth/auth.controller.ts`, `auth.module.ts`, `dto/*` | Rotas e composição de login/cadastro. | Referência de organização dos módulos. Reescrever handlers ligados a `Store`. |
| `server/src/auth/jwt.strategy.ts`, `jwt-auth.guard.ts`, `super-admin.guard.ts` | Guards e estratégia Passport/JWT centrados em `storeId`. | Não copiar sem alterar contexto e recorte de unidade. |
| `server/src/users/users.service.ts` | Busca de usuário por id/e-mail exige `storeId`; omite senha do retorno. | Reutilizar seleção de campos seguros e lookup explícito. Adaptar para Membership e tenant. |
| `server/src/users/users.module.ts` | Módulo Nest de usuários isolado. | Reaproveitar a separação de responsabilidade como padrão. |
| `server/src/middleware/tenant.middleware.ts` | Middleware de tenant antigo. | Não é prova de isolamento total; validar filtros em leituras e escritas no banco. |

### CRM Imobiliária — referência de segurança e sessão

| Arquivo | O que existe | Decisão para a clínica |
|---|---|---|
| `server/src/auth/auth.service.ts` | bcrypt, bloqueio temporário após falhas, alteração/redefinição de senha e incremento de `tokenVersion` ao alterar privilégios/credenciais. | Reutilizar o comportamento de bloqueio e revogação como requisitos; adaptar ao modelo de sessão por dispositivo da clínica. O bloqueio de tentativas ainda não foi implementado na clínica. |
| `server/src/auth/auth.controller.ts` | Login, logout, recuperação/reset e auditoria; cookies HttpOnly conforme fluxo do projeto. | Reaproveitar UX de recuperação e auditoria como referência. O frontend da clínica ainda deve definir armazenamento do access token; refresh já usa cookie HttpOnly. |
| `server/src/auth/jwt-auth.guard.ts` | Confere usuário ativo e `tokenVersion` atual no banco; token antigo deixa de valer após revogação lógica. | A clínica usa sessão persistida e `revokedAt`; adotar testes de revogação e manter validação em cada request. |
| `server/src/auth/permissions.guard.ts`, `permissions.decorator.ts`, `permissions.constant.ts` | Permissões lidas do banco; administradores recebem bypass amplo. | Reutilizar consulta em tempo real se a matriz granular for aprovada. Não copiar bypass global sem auditoria e escopo tenant/unidade. |
| `server/src/common/auth-cookie.util.ts` | Cookie HttpOnly, Secure em produção, SameSite e utilitários de leitura/limpeza. | Reutilizar as propriedades de cookie ao fechar contrato web/API; acrescentar proteção CSRF adequada ao modelo final. |
| `server/src/auth/dto/forgot-password.dto.ts`, `reset-password.dto.ts` | DTOs de recuperação e redefinição. | Reutilizar validações e fluxo como base quando a funcionalidade entrar no escopo. |
| `server/src/scripts/test-idor.ts`, `test-password-reset.ts` | Testes com dados isolados para IDOR e recuperação de senha. | Reaproveitar estrutura de execução e limpeza, adaptando às entidades tenant/membership/unit. |

## Situação da clínica após a comparação

- `api/src/auth/auth.service.ts`: mantém bcrypt e JWT; adiciona sessão persistida, refresh rotativo, hash de refresh token, expiração e revogação.
- `api/src/security/jwt-auth.guard.ts` e `tenant.guard.ts`: valida assinatura/claims e confirma sessão, membership, tenant e usuário ativos no PostgreSQL. Sessão revogada retorna 403.
- `api/src/prisma/prisma.service.ts`: extensão tenant-scoped para operações da aplicação; chamadas `unscoped` ficam limitadas a autenticação e fluxos explícitos. Isso é isolamento ORM, não RLS do PostgreSQL.
- `api/src/users/users.service.ts`: convite com hash do token no banco, papel/unidades verificados e aceitação transacional. Token bruto agora é enviado por e-mail e não é devolvido na API.
- `api/src/users/invitation-mailer.service.ts`: SMTP configurável por ambiente (`SMTP_*`, `WEB_APP_URL`). O link põe o token no fragmento (`#token=`), que o navegador não envia automaticamente ao servidor; o frontend de aceite deve remover o fragmento do histórico e enviar o token somente no POST de aceite. Se não houver SMTP ou o envio falhar, o convite é expirado e o endpoint falha, sem criar convite ativo impossível de entregar.
- `api/test/tenant-isolation.db.e2e-spec.ts`: testes com fixtures reais no PostgreSQL de unidade permitida/restrita, cross-tenant, escrita fora do escopo e sessão revogada.

## Limites ainda conhecidos

1. Provisionamento inicial de tenant/Superadmin é operação administrativa pendente.
2. Tentativas de login e recuperação de senha ainda não foram trazidas para a clínica.
3. E-mail depende de configuração SMTP válida; os testes usam SMTP falso/mocado e nunca enviam a cliente real.
4. O interceptor tenant é registrado no bootstrap da API e também precisa ser registrado nos testes que instanciam a aplicação.
5. O adaptador Prisma precisa de revisão contínua quando novos modelos/operações forem adicionados; chamadas raw/unscoped não herdam automaticamente a política tenant.
6. O sistema ainda não possui RLS PostgreSQL; avaliar RLS com contexto de conexão/transação antes de produção, sem confundir isso com os filtros do Prisma.

# Revisão de segurança — Essencial Clínicas

**Data:** 19/10/2026  
**Escopo:** revisão estática direcionada de React/TypeScript, NestJS e PostgreSQL, mais regressões funcionais locais. Sem scanners de dependência, acesso a VPS, provedores externos ou dados reais.

## Resumo

As proteções de autenticação, autorização e escopo multiempresa são explícitas e têm regressões E2E. Não foi identificado um exploit reproduzível nesta revisão. Há riscos residuais relevantes para um SaaS clínico público: o cliente Prisma não escopado pode contornar o filtro automático de tenant se usado incorretamente; o token de acesso fica acessível ao JavaScript; e controles de implantação e throttling distribuído ainda precisam de confirmação.

## Achados

### SBP-1 — Alto: uso indevido do Prisma `unscoped` pode expor dados cross-tenant

- **Local:** `api/src/prisma/prisma.service.ts`, getter `unscoped`.
- **Evidência:** a política `scoped` acrescenta `tenantId` automaticamente, enquanto `unscoped` entrega o cliente Prisma diretamente.
- **Impacto:** nova consulta de serviço que esqueça `tenantId` pode ler ou alterar dados de outra clínica, apesar do guard e do contexto estarem corretos.
- **Estado:** risco arquitetural, sem exploit reproduzido nesta rodada; testes cobrem rotas críticas, não cada caminho interno.
- **Recomendação:** limitar o uso a métodos de sistema estreitos, revisar cada novo acesso e manter testes cross-tenant para fluxos afetados. Planejar RLS em mudança de arquitetura separada; nenhuma migration foi necessária ou criada nesta tarefa.

### SBP-2 — Médio: access token armazenado em `sessionStorage`

- **Local:** `web/src/App.tsx` e camada de chamadas da API.
- **Evidência:** o navegador precisa ler/gravar o token para enviar `Authorization: Bearer`.
- **Impacto:** um XSS executado na origem pode roubar o token durante sua validade. A busca direcionada não localizou `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` ou `document.write` em `web/src`.
- **Recomendação:** manter React escapando conteúdo e revisar novas superfícies que renderizem HTML; avaliar BFF/cookie HttpOnly com proteção CSRF antes da produção. Confirmar CSP/headers no host que serve o Web, pois isso não é verificável no servidor API apenas.

### SBP-3 — Médio, condicionado a múltiplas réplicas: throttling pode não ser compartilhado

- **Local:** `api/src/app.module.ts` e decorators de autenticação/recuperação.
- **Evidência:** `ThrottlerGuard` global e limites por endpoint estão presentes; o armazenamento distribuído não foi confirmado nesta revisão.
- **Impacto:** distribuindo requisições entre réplicas, um atacante pode obter mais tentativas do que o limite de uma instância permite.
- **Recomendação:** confirmar topologia e configurar armazenamento compartilhado ou proteção equivalente na borda antes de escalar produção.

### SBP-4 — Pendente de confirmação operacional: proteção de segredos e tráfego em produção

- **Local:** implantação fora do repositório.
- **Evidência:** a aplicação lê chaves de ambiente e depende do host para TLS, headers do frontend, logs, backups e rotação.
- **Impacto:** segredo exposto ou tráfego sem TLS compromete sessões, dados de pacientes e canais de integração.
- **Recomendação:** verificar secret manager, TLS, CSP/frame-ancestors, acesso a backup, redação de logs e processo de rotação antes do piloto com dados reais.

## Controles verificados

- JWT vinculado a sessão persistida; sessão revogada/expirada retorna 401 e bloqueios de autorização continuam 403.
- Tenant suspenso, papel Superadmin e senha inicial têm verificações server-side.
- A camada `scoped` inclui `tenantId`; testes PostgreSQL cobrem isolamento entre tenant e unidade.
- Segredos de conexão usam AES-256-GCM e as respostas verificadas não devolvem token em texto aberto.
- Helmet e CORS restrito por `WEB_ORIGIN` são configurados em `api/src/main.ts`.
- Throttling global e limites específicos estão presentes.
- Filas e automações persistem no PostgreSQL e usam idempotência; validação local não enviou mensagens.

## Limitações

- Não houve teste de intrusão, scanner de dependências, revisão integral de cada endpoint, leitura de logs de produção, avaliação de TLS/CDN ou teste com provedores reais.
- Não existe evidência de RLS no schema/migrations revisados; hoje a garantia principal é a camada de aplicação.
- A aprovação local não equivale a autorização para uso com dados clínicos reais.

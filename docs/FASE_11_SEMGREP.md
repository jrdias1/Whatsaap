# Fase 11 — análise estática de segurança

**Data:** 19/10/2026  
**Estado:** Semgrep não executado; binário não instalado. A revisão manual local abaixo não é resultado de Semgrep.

## Execução e privacidade

- Verificações de disponibilidade: `Get-Command semgrep` e busca em `node_modules/.bin`; nenhum executável encontrado.
- Não instalamos executável, não baixamos regras e não conectamos o projeto à nuvem Semgrep.
- O código permaneceu local. Não houve upload, login, telemetria ou publicação de resultados.
- A skill `security-best-practices` e o modelo de ameaças existente foram usados como guias; não são scanners independentes.

## Revisão manual direcionada

Escopo lido: `api/src/`, `web/src/`, configuração de inicialização e testes E2E relacionados. Buscas locais por `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` e subprocessos não encontraram ocorrências nos diretórios analisados. Isso é uma busca por padrões, não prova de ausência de vulnerabilidades.

### Achados

| ID | Severidade | Evidência e impacto | Estado |
|---|---|---|---|
| S11-01 | Alto, condicional à produção | A conexão usada pela API local tem usuário PostgreSQL `clinic`; esse papel no contêiner de desenvolvimento tem `rolsuper=true` e `rolcreatedb=true`. Uma configuração equivalente em produção daria privilégios de superusuário ao runtime e ampliaria o impacto de uma falha de aplicação. O ambiente observado é Docker local, sem dados reais. | Não alterado: produção não tem configuração de papéis documentada nesta fase. Antes do piloto, separar papel proprietário/migrador do papel runtime e validar privilégios mínimos. |
| S11-02 | Médio | `web/src/App.tsx` mantém o access token em `sessionStorage`. XSS no mesmo origin pode ler e reutilizar o token até expiração/revogação. | Risco já documentado na Fase 10; mudança do contrato de sessão exige decisão e regressão próprias. |
| S11-03 | Médio, residual | `api/src/patients/patients.controller.ts` limita a um arquivo e 5 MiB; `patients.service.ts` restringe extensão/abas/linhas/colunas e captura falha de parsing. O teste novo com arquivo pequeno malformado foi rejeitado com HTTP 400. A biblioteca ainda precisa processar o arquivo antes de medir linhas/colunas; não foram feitos testes de arquivos especialmente construídos ou de exaustão. | Nenhuma exploração foi confirmada. Manter o limite e validar parser/limites de recursos em revisão independente antes de produção. |

### Controles confirmados por leitura e regressão

- Meta recebe `rawBody` (`api/src/main.ts`) e valida HMAC SHA-256 com comparação de comprimento e `timingSafeEqual` (`api/src/meta/*`). E2E confirma rejeição de assinatura inválida, persistência/deduplicação e monotonicidade de estados fora de ordem.
- Webhook Evolution compara hash do segredo com `timingSafeEqual` e exige conexão ativa; E2E usa eventos e chaves fictícios.
- Reprocessamento da outbox usa estados e persistência PostgreSQL; consentimento, paciente, conexão, cota e status do atendimento são revalidados nos cenários E2E. `SIMULATED` é distinguido de entrega.
- Os testes PostgreSQL cobrem tenant/unidade, sessão revogada, escopo de operador, alteração de papel, exportação, webhook e automações.
- As consultas raw/unscoped revistas usam parâmetros Prisma e predicados de tenant em operações de negócio; os caminhos administrativos globais são separados e auditados. Não há RLS comprovada como segunda barreira; o isolamento observado é principalmente aplicação/constraints.

## Não conclusivo ou não realizado

- Semgrep e regras JavaScript/TypeScript/React/Node não foram executados.
- Não houve pentest, exploração de XSS, varredura de segredos, revisão independente nem análise de headers reais servidos por proxy.
- Não foi validado o papel de banco de produção, TLS, proxy, CORS de produção, logs centrais ou firewall.
- Nenhum achado crítico de código foi confirmado pela revisão manual focal. Isso não equivale a certificação de segurança.

Ver também `FASE_11_DEPENDENCIAS.md`, `FASE_11_ESTABILIZACAO_E_PILOTO_SIMULADO.md` e `AUDITORIA_SEGURANCA_FASE_10.md`.

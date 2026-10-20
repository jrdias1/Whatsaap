# Skills e ferramentas do agente

**Verificado em:** 19/10/2026  
**Projeto:** `E:\Documentos\Fernando\Planejamento Sistema Clínica`

Skills são instruções para análise e trabalho assistido. Não são scanners, testes independentes nem garantia de segurança. Foram verificadas em `C:\Users\Jr Dias\.codex\skills`; o diretório local `skills/` do projeto contém regras internas de arquitetura e banco, não skills do Codex. Nenhuma skill foi instalada nesta fase.

| Nome | Origem declarada | Local | Uso nesta fase | Status/cuidados |
|---|---|---|---|---|
| `security-threat-model` | OpenAI | `C:\Users\Jr Dias\.codex\skills\security-threat-model` | Modelo de ameaças ancorado em componentes, fronteiras e evidências do repositório. | Instalada. Tratar requisitos de confirmação da skill como orientação; premissas não fornecidas ficam explícitas. |
| `security-best-practices` | OpenAI | `C:\Users\Jr Dias\.codex\skills\security-best-practices` | Auditoria TypeScript/React e servidor web; referências React e Express são aplicáveis parcialmente ao NestJS com Express. | Instalada. Não há referência NestJS dedicada; validar cada regra no código e não presumir middleware. |
| `vercel-react-best-practices` | Vercel | `C:\Users\Jr Dias\.codex\skills\vercel-react-best-practices` | Revisão de renders, buscas e bundle React/Vite; regras específicas de Next.js não se aplicam. | Instalada. Recomendações precisam ser justificadas por código. |
| `postgresql-code-review` | GitHub/awesome-copilot (conforme inventário anterior da instalação) | `C:\Users\Jr Dias\.codex\skills\postgresql-code-review` | Revisão manual de schema, constraints, índices, transações e queries PostgreSQL/Prisma. | Instalada. Não seguir sugestões genéricas como adicionar índices/RLS sem evidência de necessidade e contexto. |
| `impeccable` | Impeccable | `C:\Users\Jr Dias\.codex\skills\impeccable` | Auditoria e refinamento pontual de interface administrativa existente. | Skill instalada; engine global `0.1.15` baixado para `%USERPROFILE%\.impeccable\bin\0.1.15\impeccable.exe`, handshake `impeccable-engine 0.1.15` e assinatura Authenticode válidos. |
| `web-design-guidelines` | Vercel Labs | `C:\Users\Jr Dias\.codex\skills\web-design-guidelines` | Conferência de acessibilidade, responsividade e padrões de interface. | Instalada. A instrução pede regras atuais remotas; consultar sem enviar código-fonte. |
| `security-review` | GitHub/awesome-copilot | — | Revisão de segurança complementar opcional. | Ausente. Não instalar automaticamente. |
| `differential-review` | Trail of Bits | — | Revisão de diff e regressões de segurança. | Ausente; além disso, esta pasta não tem `.git`, portanto falta histórico/diff confiável. |

## Ferramentas locais

- `Semgrep`: não encontrado no `PATH` em 19/10/2026; não instalado.
- `OSV-Scanner`: não encontrado no `PATH`; não instalado. A consulta pode transmitir nomes/versões de pacotes a serviço externo e não foi executada.
- Git: o diretório do projeto não contém repositório (`git status` retorna “not a git repository”). Não há histórico local para comparação/checkpoint.
- Builds, lint e testes npm existentes são comandos do projeto, não ferramentas de análise de segurança independente.

## Uso e segurança

As skills aplicáveis foram abertas e lidas antes das análises. O launcher Impeccable instala o engine de uma release do GitHub fixada em `scripts/VERSION`, exige sidecar SHA-256 e recusa binário sem checksum correspondente. Nesta continuação, o launcher instalou `0.1.15` no cache global do usuário e a assinatura Authenticode foi verificada como válida. O comando `context` iniciou e identificou dois apps (`api` e `web`), pedindo seleção de superfície; nenhuma auditoria ou alteração visual foi executada por causa desta instalação. Nenhum segredo foi enviado.

Invocação: skills são selecionadas pelo agente Codex conforme seus nomes/descrições e contexto; não há comando global de CLI para invocar as outras skills. O Impeccable documenta `impeccable <comando> --target <arquivo|rota>` pelo launcher da própria skill.

## Dependências e invocação verificadas

| Skill | Dependência para uso | Como invocar | Cuidados específicos |
|---|---|---|---|
| `security-threat-model` | Codex e leitura do repositório. | Pedir modelagem de ameaças, fronteiras, ativos e evidências; foi usada para construir o documento desta fase. | Não transforma premissas em fatos nem substitui threat review independente. |
| `security-best-practices` | Codex e código Python/JavaScript/TypeScript suportado. | Solicitar explicitamente revisão de segurança ou secure-by-default; foi usada para orientar a auditoria. | Aplicar recomendações no NestJS só após conferir middleware e código real. |
| `vercel-react-best-practices` | Codex e leitura React/Next.js. | Solicitar revisão de performance React; usada para revisar componentes React + Vite. | Ignorar regras específicas de Next.js que não se aplicam ao Vite. |
| `postgresql-code-review` | Codex e schema/queries PostgreSQL. | Solicitar revisão de PostgreSQL/Prisma; usada no exame manual de constraints, chaves, índices e transações. | Não adicionar índices/RLS sem evidência e teste. |
| `web-design-guidelines` | Codex; a skill consulta diretrizes web atuais sem precisar enviar fonte do projeto. | Solicitar auditoria de interface/acessibilidade; usada na revisão das telas e do viewport móvel. | Separar recomendações externas de observações verificadas no sistema. |
| `impeccable` | Launcher `.cmd`; engine global `0.1.15` instalado e validado. | `scripts/impeccable.cmd context`; comandos específicos após escolher `api` ou `web` como superfície. | Não executar mudanças amplas automaticamente; revisar o comando e contexto carregado. |
| `security-review` (opcional) | Skill do repositório GitHub/awesome-copilot; ausente. | Sem invocação local. | Não instalada. |
| `differential-review` (opcional) | Skill Trail of Bits; ausente; requer diff/histórico. | Sem invocação local. | Não instalada; não há `.git` neste diretório. |

As skills presentes são instruções e dependem de inspeção/revisão do agente. Não são executáveis scanners nem dependências runtime da aplicação. Nenhum script de skill foi executado.

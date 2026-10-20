# Auditoria de segurança — Fase 10

**Resultado:** não foi confirmado achado crítico ou alto com correção local imediata durante a revisão limitada. Isto não é declaração de ausência de vulnerabilidades. Há riscos médios e dependências de operação que impedem uso com dados reais/produção.

## Achados classificados

| Severidade | Evidência e cenário | Impacto | Correção/mitigação e risco | Teste/evidência |
|---|---|---|---|---|
| Crítico | Nenhum confirmado nesta revisão. | — | Não equivale a pentest. | Revisão manual focal e testes descritos abaixo. |
| Alto | Nenhum confirmado com correção local segura. Acesso Superadmin e integrações externas seguem sensíveis. | Comprometimento global ou envio externo se operação/segredos falharem. | MFA, prova de identidade, gestão de segredos, allowlist, homologação e runbooks antes do piloto externo. Alterar agora implicaria decisões operacionais fora do escopo local. | TOTP 2/2; integrações em dry-run, sem homologação. |
| Médio | `web/src/App.tsx` guarda access token em `sessionStorage`; XSS no mesmo origin poderia lê-lo. | Uso da sessão até revogação/expiração. | CSP e revisão do hosting web; estudar token em memória. Mudança de contrato de sessão exige teste específico e planejamento; não feita nesta fase. | Builds e Playwright 1/1; não é teste de XSS. |
| Médio | `api/src/main.ts` habilita trust proxy apenas em teste; produção atrás de proxy sem configuração reconhecida pode agrupar rate limit pelo IP do proxy. | Falsos bloqueios/limitação de usuários e redução da utilidade do rate limit; confiar em proxy amplo permitiria falsificação de IP. | Configurar proxy/rede exatos no deploy e testar com ingress real antes de ativar. Não habilitar globalmente no código. | E2E `reports.db.e2e-spec.ts` 4/4 inclui X-Forwarded-For forjado rejeitado e limite de 8 tentativas preservado. |
| Médio | Upload `patients.controller.ts` limita 5 MiB e um arquivo, mas MIME/conteúdo e comportamento com planilha malformada requerem avaliação adicional. | Erros de parser, abuso de recursos ou arquivo inesperado. | Validar assinatura/conteúdo e limites no proxy; adicionar casos de arquivo malformado antes de piloto. Não se confirmou exploração. | E2E prévio de importação; não é scanner de arquivo. |
| Médio | Política de retenção, logs centrais, backup fora do host e recuperação de produção não existem/foram homologados como operação. | Exposição prolongada, perda de dados ou resposta lenta a incidente. | Aprovação jurídica/operacional de prazos e runbook de recuperação/incident response. | Ensaio local descartável descrito em `FASE_10_SEGURANCA_USUARIOS_PILOTO.md`. |
| Baixo | Web lint termina com avisos React de dependências/efeitos em páginas existentes e novas telas; sem erros fatais. | Possíveis consultas/estado redundante, sem impacto de segurança confirmado. | Resolver por componente com testes e evidência; evitar memoização indiscriminada. | Web build passou; lint exit 0 com avisos listados no registro. |
| Informativo | Semgrep, OSV-Scanner e skills opcionais `security-review`/`differential-review` ausentes. Pasta não é repositório Git. | Sem análise independente de regras/dependências e sem histórico confiável de diff. | Instalação/consulta externa requer decisão própria; manter revisão manual e checkpoints futuros. | Disponibilidade verificada sem instalar ou enviar código/metadados. |

## Revisão técnica focal

- **Entradas/autorização:** endpoints novos validam papel, tenant e escopo; identificadores inválidos retornam erro de cliente. Alterações clínicas nunca concedem `PLATFORM_SUPERADMIN`; gerente é restrito a operadores/unidades sob seu escopo.
- **Sessões:** alterações de papel/status/unidade revogam sessões antigas; recuperar senha consome token atomicamente e revoga sessões. Refresh é rotativo. O teste verificou que sessão revogada deixa de autenticar.
- **Cookies/CORS/headers:** cookie de refresh usa configuração de segurança definida pelo serviço; `helmet()` e lista `WEB_ORIGIN` são aplicados na inicialização. CORS/HTTPS precisam de validação no domínio real.
- **Banco:** Prisma, filtros tenant, relações compostas, transações e auditorias revisados manualmente; migration nova é aditiva. Migrações históricas não foram alteradas.
- **Privacidade:** solicitação cria evento e auditoria; não apaga paciente nem remove evento imutável. A exportação de relatórios é agregada, limitada a 1.000 linhas e auditada.
- **Integrações:** nenhum disparo Meta/Evolution, escrita/consulta Uno ou envio de e-mail foi realizado. IA segue aprovação humana.
- **Erros/segredos/SSRF/XSS/comandos:** leitura focal não confirmou fluxo que registra senha/token bruto nem sink React de HTML arbitrário nas telas adicionadas. Essa inspeção não substitui scanner nem revisão de todos os caminhos. Destinos e segredos precisam de checagem na homologação.

## Ferramentas e vulnerabilidades de dependência

Semgrep e OSV-Scanner não estavam disponíveis e não foram instalados. Nenhuma consulta externa de dependências foi executada. Logo não há inventário de CVEs nesta fase; atualizar dependências requer relatório dedicado e validação de compatibilidade.

## Correções locais implementadas

- Controle de equipe com RBAC/tenant/unidade, bloqueio de escalada, revogação de sessões e auditoria.
- Recuperação clínica com token aleatório, hash no banco, validade curta, uso único, limitação, revogação de sessões e exclusão explícita do Superadmin.
- Personalização com campos permitidos, contraste mínimo, texto simples e isolamento por tenant.
- Solicitações de privacidade com histórico imutável, sem exclusão/anonimização automática.
- Handoff de convite local condicionado a `NODE_ENV=test`; fluxo de produção por SMTP permanece separado.
- Trust proxy restrito a teste e loopback; limite de login não foi reduzido.

Não houve aplicação automática de patches por scanner ou execução de código de skill.

## Complemento — validação Fase 11 (19/10/2026)

A auditoria focal e o piloto simulado subsequentes estão registrados em `FASE_11_ESTABILIZACAO_E_PILOTO_SIMULADO.md` e `FASE_11_SEMGREP.md`. Semgrep e OSV-Scanner não estavam disponíveis e não foram executados; portanto, os achados anteriores não equivalem a uma varredura concluída nem a uma revisão independente. Foi identificado no Docker local que a role `clinic`, usada na conexão da API, tem atributos superuser e createdb. A configuração de produção não foi verificada; tratar como bloqueio de implantação até definir e provar roles separadas de owner/migração e runtime de privilégio mínimo. JWT em `sessionStorage` permanece risco conhecido. Não foram usados dados reais nem feitas operações externas.

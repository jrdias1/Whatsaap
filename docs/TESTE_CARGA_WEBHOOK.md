# Teste de carga local — Meta webhook sintético

## O que mede

`api/src/scripts/load-meta-webhook.ts` envia 5.000 mensagens fictícias em lotes assinados com HMAC para o endpoint local, aguarda o processamento e injeta mais 100 eventos apenas no PostgreSQL para medir recuperação pelo reconciliador. Não chama a Meta, não envia mensagens externas e não acessa a Uno.

O relatório JSON contém throughput de aceitação e processamento, latências HTTP e de processamento (p50/p95/máximo), erros, estados terminais, pico de backlog PostgreSQL, memória atual/pico do Redis, RSS do gerador e tempo para recuperar os 100 eventos sem job BullMQ. A recuperação é uma simulação de jobs ausentes; não substitui desligar e restaurar Redis em um ensaio isolado.

## Como reproduzir no desenvolvimento local

1. Inicie PostgreSQL e Redis persistente: `docker compose up -d postgres redis`.
2. Em um terminal, inicie a API compilada com um segredo de teste local, igual ao usado pelo gerador:

   ```powershell
   $env:META_APP_SECRET = 'segredo-local-de-teste-nao-usar-em-producao'
   npm run start:prod --workspace api
   ```

3. Em outro terminal, execute o gerador com o mesmo valor de `META_APP_SECRET`:

   ```powershell
   $env:META_APP_SECRET = 'segredo-local-de-teste-nao-usar-em-producao'
   npm run loadtest:webhook --workspace api
   ```

O padrão é 5.000 eventos, em lotes de 100. `LOAD_TEST_MESSAGES` e `LOAD_TEST_BATCH_SIZE` permitem variar o ensaio. A cadência requerida em operação ainda precisa ser confirmada; este volume isolado não aprova uma janela/SLO de produção.

O gerador cria um tenant/unidade/pacientes/conexão com slug aleatório e remove os dados ao terminar. Se o processo for interrompido à força, remova somente o tenant `webhook-load-*` criado por aquela execução e os jobs de teste correspondentes antes de repetir. Não use `FLUSHDB` num Redis compartilhado.

## Execução local comprovada — 18/10/2026

Node 24.14.0, Redis 7 local em Docker, PostgreSQL local, API Nest compilada, lotes de 100 e limite de espera de 5 minutos para drenar o backlog.

| Métrica | Resultado |
|---|---:|
| Eventos recebidos / processados | 5.000 / 5.100 (inclui 100 sem job) |
| Erros HTTP / estados finais | 0 / 5.100 `PROCESSED` |
| Tempo total / entrada aceita | 90,10 s / 55,49 eventos/s |
| Processamento | 56,60 eventos/s |
| Latência HTTP p50 / p95 / máx. | 176,40 / 336,97 / 474,40 ms |
| Latência de processamento p50 / p95 / máx. | 36,77 / 75,00 / 89,09 s |
| Pico do backlog persistido | 4.538 eventos |
| Recuperação dos 100 eventos sem job | 77,98 s |
| Redis pico de memória | 15.249.056 bytes |
| Gerador RSS final | 86.437.888 bytes |
| API pico RSS amostrado pelo PowerShell | 370.061.312 bytes |

Resultado aprovado apenas para este ensaio local: todos os 5.100 eventos terminaram e não houve erro HTTP. A amostragem de RSS da API foi feita externamente a cada 500 ms durante a execução; Redis e gerador são reportados pelo script. O número de mensagens não define a cadência: a rajada teve 50 chamadas HTTP sequenciais com 100 eventos cada.

O primeiro ensaio de 5.000, antes de elevar a capacidade por tenant para 8 slots em 32 workers, terminou incompleto após 307,59 s: 4.993 processados, 107 pendentes, entrada 16,26/s e p95 de processamento 250,18 s. Ele foi reprovado. Após ajuste, a execução tabulada acima drenou o backlog.

Os 100 eventos de recuperação foram inseridos no PostgreSQL sem job BullMQ para exercitar o reconciliador. Isso comprova recuperação de jobs ausentes, não uma parada real do Redis. O teste real de indisponibilidade/retorno do container continua pendente. Ainda não há base para declarar capacidade homologada, cadência, CPU de produção ou SLO.

## Interpretação

Um relatório com erros, backlog não drenado, estado `FAILED` ou recuperação incompleta é reprovado. Um relatório sem esses problemas é evidência de execução local, não homologação de integração ou garantia de cadência em produção. Registrar CPU/RSS da API, configuração de hardware/limites dos containers e versão Node/Redis/PostgreSQL junto ao JSON ao homologar um SLO.

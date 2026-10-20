# Ensaio local do dispatcher de outbox (dry-run)

**Data:** 18/10/2026. **Resultado:** 5.000/5.000 eventos processados localmente como `SIMULATED`; nenhum envio externo ou escrita na Uno.

## Resultado observado

| Métrica | Resultado |
|---|---:|
| Eventos fictícios | 5.000 |
| Estado final | 5.000 `SIMULATED`, 0 `FAILED`, 0 `SUPPRESSED` |
| Tempo | 260,71 s |
| Throughput observado | 19,18 eventos/s (1.151/min) |
| Backlog máximo | 5.000 |
| Latência de fila p50 / p95 / p99 | 149 / 257 / 323 ms |
| Processamento p50 / p95 / p99 | 21 / 29 / 36 ms |
| RSS máximo do gerador | 86.904.832 bytes |
| RSS máximo da API | Não medido: o amostrador PowerShell não retornou valor válido |
| Memória Redis ao final | 10.061.784 bytes |
| CPU de usuário Redis ao final | 11,83 s |
| Tentativas registradas | 5.000 |

O dispatcher foi configurado com limite local de 10.000/min para acelerar o ensaio; por isso o throughput representa apenas o caminho local API/PostgreSQL/Redis/BullMQ e a simulação, não throughput autorizado ou homologado da Meta. A cadência externa ainda depende de confirmação. A API enfileirou diretamente 3.835 itens; o reconciliador recuperou/enfileirou os 1.165 restantes durante a carga. Isso comprova recuperação concorrente no ensaio, sem afirmar que todos foram submetidos pela chamada inicial.

## Interpretação e limites

5.000 é o tamanho mínimo do lote de teste/capacidade a dimensionar. Não é quantidade simultânea, cota comercial ou declaração de capacidade de produção. O plano comercial atual segue com suas cotas por ciclo. A referência operacional de 8.000/dia é agregada e não significa simultaneidade. A conversa trouxe cadências de 100/min e 300/min por 15 minutos; usamos 300/min somente como hipótese conservadora para o desenho local. Nenhuma dessas taxas foi testada contra a Meta.

O cenário usa campanha aprovada e outbox existente, mas não valida nome/versão de template aprovado pela Meta nem janela de atendimento: o schema local ainda não contém contrato de templates aprovados. Portanto, este ensaio não homologa o canal.

## Reprodução

Com PostgreSQL e Redis locais do Compose ativos, executar em `api`:

```powershell
$env:OUTBOX_LOAD_COUNT = '5000'
$env:OUTBOX_MAX_PER_CONNECTION_PER_MINUTE = '10000'
npm run loadtest:outbox
```

O script cria dados sintéticos isolados, executa o dispatcher em modo `dry-run`, captura latência por tentativa, backlog, memória/CPU do Redis e RSS do gerador, e apaga seus fixtures. Não use credenciais de produção. O campo RSS da API precisa de amostrador confiável antes de afirmar memória máxima do serviço.

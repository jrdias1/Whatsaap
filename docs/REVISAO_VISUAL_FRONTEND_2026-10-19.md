# Revisão visual do frontend — 19/10/2026

## Escopo

Revisão visual para preparar a apresentação conceitual do Essencial Clínicas. O trabalho manteve a paleta e a organização existentes e se concentrou em alinhamento, visibilidade, leitura, formulários e comportamento responsivo.

- Percorridos os 18 módulos clínicos disponíveis para o perfil Administrador.
- Percorridas as 8 seções principais do Superadmin e as abas de detalhes da clínica.
- Revisada a tela de login sem sessão.
- Capturas feitas em desktop e em larguras de 390 px e 320 px, com dados fictícios.
- Nenhuma gravação em dados reais, envio externo, consulta Uno ou chamada à VPS.

## Achados e ajustes

- A tela da Inbox deixava o painel de conversa vazio antes da seleção. Foi incluída uma orientação visual para selecionar um contato.
- A grade da Inbox excedia a largura disponível em tablets por uma regra antiga com largura mínima fixa. A grade agora se reorganiza em uma coluna em telas estreitas.
- Cabeçalho e seletor de unidade excediam a largura em 320 px. O cabeçalho agora quebra em linhas sem rolagem horizontal da página; o status da agenda também ficou mais legível.
- Formulários de Indicações tinham campos que passavam do cartão em 320 px. Campos, grupos e cartões agora respeitam a largura interna.
- Automações e IA apresentavam labels e campos comprimidos; as opções de checkbox da IA também podiam crescer indevidamente. Labels, controles e caixas foram alinhados para leitura vertical.
- O filtro de tarefas e o seletor de provedor em Canais usavam controles menores e sem o padrão visual do restante do sistema. Foram ajustados para a altura e a tipografia dos demais controles.
- A visão diária da agenda cortava o contador do cabeçalho em 320 px; a coluna de horário foi reduzida para caber nessa largura.
- Botões secundários nos formulários e na lista de plano exibiam o estilo nativo do navegador. Receberam altura, borda e tipografia consistentes.
- O botão de saída volta a estar disponível na faixa de navegação móvel.
- O detector Impeccable identificou contraste e texto pequeno na tela de login. A legenda da marca, a descrição e o botão foram ajustados; a nova leitura ao vivo não encontrou achados.

## Validação

- Playwright visual: **1/1 aprovado**, serial. Cobriu a navegação das telas clínicas e do Superadmin e verificou a ausência de rolagem horizontal da página em 320 px e 390 px. Também manteve as verificações anteriores de contraste amostrado, tamanho de labels/abas e foco visível.
- Capturas novas: **96** arquivos em `docs/evidencias/revisao-front-*` — login em três tamanhos, 18 módulos clínicos em três tamanhos, oito seções do Superadmin em três tamanhos e cinco abas de detalhes da clínica em três tamanhos.
- Build Web (`tsc -b` e Vite): aprovado.
- Lint Web: terminou com código 0; permanecem avisos existentes de efeitos/dependências React e leitura do relógio durante renderização.
- Impeccable: a leitura da tela de login ao vivo terminou sem achados após os ajustes. A varredura direta de arquivos, isoladamente, informou que não executa regras que dependem de página renderizada.

## Limitações da amostra

O Playwright usa clínica e usuários fictícios. A amostra tinha poucos registros e não continha conversas, tarefas, plano ativo ou agenda preenchida em todos os estados; por isso vários módulos foram avaliados em estado vazio. A tela Plano mostrou corretamente o estado sem ciclo ativo do fixture, mas não foi possível revisar visualmente dados de consumo de um plano carregado. As capturas não substituem uma leitura humana com conteúdo realista, uma auditoria completa de acessibilidade por teclado/leitor de tela ou homologação de toda ação funcional.

O resultado serve para apresentar a ideia e navegar pelo ambiente local com dados fictícios. Para uma demonstração mais representativa, usar os dados de demonstração já preparados e conferir o fluxo com a conta clínica antes da reunião.

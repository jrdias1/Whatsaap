# Integridade dos textos

O banco PostgreSQL desta instalação usa UTF-8. Isso não recupera letras que já chegaram como `?` ou `�`: a perda aconteceu antes da gravação, por exemplo ao importar um CSV com a codificação errada ou ao inserir dados de demonstração por um terminal que substituiu caracteres.

- Mantenha arquivos de código e scripts em UTF-8. O build executa `check:text` e recusa fontes com bytes inválidos, escapes Unicode exibidos literalmente e padrões comuns de texto quebrado.
- Exporte CSV de pacientes em **CSV UTF-8**. O navegador rejeita bytes inválidos e informa como corrigir o arquivo. XLSX é lido como planilha, sem conversão por terminal.
- Mensagens escritas pela equipe, respostas rápidas, campanhas, automações e sugestões da IA são verificadas antes de serem salvas. A fila de saída faz uma última checagem e bloqueia um texto suspeito já existente.
- Webhooks da Meta e da Evolution recusam bytes que não sejam UTF-8 válido. Eventos válidos conservam o texto original: não tente adivinhar acentos perdidos em mensagens de pacientes. Se o provedor entregar texto já quebrado, verifique o payload de origem e corrija a integração.

Para auditar mensagens salvas sem exibir seu conteúdo, execute `npm run audit:messages --workspace api -- <slug-da-clinica>`. O comando informa o total e os IDs suspeitos. Um ID suspeito exige revisão humana; a auditoria não muda o banco. Só corrija um registro quando o texto original for conhecido com certeza.

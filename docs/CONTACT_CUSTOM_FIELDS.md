# Campos personalizados de contatos

O ReplyFlow permite que cada workspace modele até 20 campos ativos para registrar contexto comercial estruturado no perfil do contato. A primeira versão suporta texto, número, data, sim/não e lista de opções.

## Modelo e isolamento

`ContactFieldDefinition` pertence ao workspace e define nome, tipo, opções, posição e estado. `ContactFieldValue` liga uma definição a um contato e armazena um valor canônico como texto.

O isolamento é repetido em três camadas:

- toda consulta e mutação recebe o `workspaceId` da sessão, nunca do corpo da requisição;
- chaves estrangeiras compostas garantem que contato, definição e valor pertençam ao mesmo workspace;
- nomes normalizados são únicos dentro do workspace, mas podem se repetir entre empresas.

Desativar uma definição não apaga seus valores. Eles deixam de aparecer no formulário operacional, mas permanecem disponíveis na exportação de privacidade. A exclusão do contato remove seus valores por cascata.

## Validação dos valores

- Texto: até 1.000 caracteres após normalização Unicode e remoção de espaços externos.
- Número: até 12 inteiros e 4 casas decimais; vírgula ou ponto são aceitos e o valor é persistido com ponto.
- Data: formato real `AAAA-MM-DD`; datas impossíveis são recusadas.
- Sim/não: apenas `true` ou `false`.
- Seleção: o valor precisa corresponder exatamente a uma das opções configuradas.

Valores vazios removem o registro em vez de criar strings vazias. Uma opção de seleção em uso não pode ser removida até que os contatos sejam atualizados. O tipo de uma definição é imutável para evitar reinterpretar dados históricos.

## Concorrência e auditoria

Notas, etiquetas e campos personalizados usam o mesmo `Contact.version`. A gravação inteira ocorre em uma transação: uma versão desatualizada retorna `409`, preservando o rascunho no navegador. Criação e alteração de definições também são auditadas sem copiar valores pessoais para a trilha administrativa.

A criação bloqueia a linha do workspace antes de contar e posicionar definições, evitando ultrapassar o limite em requisições concorrentes. Há um limite histórico defensivo de 100 definições por workspace.

## Migration e validação

`20260911130000_add_contact_custom_fields` cria o enum, as duas tabelas, índices, constraints e chaves estrangeiras. Não há backfill nem reescrita de contatos existentes.

`npm run test:contact-custom-fields-db` aplica todas as migrations reais em um schema PostgreSQL descartável e valida unicidade, opções, isolamento entre workspaces, preservação ao desativar e cascata ao excluir o contato.

## Rollback

Primeiro publique uma versão da aplicação que não consulte nem grave os campos personalizados. Exporte os valores que precisem ser preservados. Depois publique uma migration compensatória removendo tabelas, índice composto do contato e enum. Nunca edite nem remova uma migration já aplicada.

# CRM de contatos

O CRM do ReplyFlow transforma os registros de automação (`DmLog`) em perfis persistentes. Nesta primeira entrega, um contato representa uma pessoa observada em uma conta do Instagram dentro de um workspace. Ele ainda não equivale a uma caixa de entrada completa da Meta.

## Identidade e isolamento

A identidade é a combinação imutável de:

- `workspaceId`;
- `instagramAccountId`;
- `instagramScopedId` (o identificador da pessoa fornecido pelo Instagram).

A chave composta evita misturar a mesma pessoa entre empresas ou contas do Instagram. A chave estrangeira composta também impede que uma conta pertencente a outro workspace seja associada ao contato.

## Sincronização automática

A migration `20260905010000_add_contacts` cria um trigger no PostgreSQL. Cada novo `DmLog` válido cria ou atualiza o contato correspondente:

- `firstSeenAt` guarda a interação mais antiga;
- `lastSeenAt` guarda a interação mais recente;
- `username` só é substituído por uma observação de data igual ou posterior;
- tentativas de reenvio e mudanças de status não alteram o contato;
- `tags`, `notes` e `version` nunca são sobrescritos pela ingestão.

A própria migration faz o backfill dos logs históricos sob bloqueio transacional. Se encontrar um log antigo associado a uma conta de outro workspace, ela falha inteira, sem deixar objetos parciais.

## API e permissões

- `GET /api/contacts`: busca, filtro por conta/etiqueta e paginação.
- `GET /api/contacts/:id`: perfil e informações internas.
- `GET /api/contacts/:id/interactions`: histórico de automações.
- `PATCH /api/contacts/:id`: edição de etiquetas e anotações.

Membros podem consultar os contatos. Proprietários e administradores podem editar. Todas as consultas repetem o `workspaceId` ativo, e a listagem não retorna anotações. Alterações usam `version` para detectar edição concorrente e retornam `409` sem perder o rascunho do usuário.

## Limites atuais

- até 10 etiquetas por contato;
- até 30 caracteres por etiqueta;
- até 5.000 caracteres de anotações;
- até 100 registros por página;
- histórico limitado aos eventos já processados por automações.

Conversas manuais, mensagens completas, cliques individualizados e entidades próprias para etiquetas fazem parte das próximas entregas. Segmentos, campos personalizados e exportação/anonimização de dados já possuem módulos próprios documentados.

## Operação e rollback

Antes de implantar, faça backup e execute `npm run db:migrate`. A migration é validada em schema isolado por `npm run test:contacts-db`, que aplica toda a sequência real de migrations e remove os dados de teste ao terminar.

Para reverter o comportamento, publique primeiro uma versão da aplicação que não dependa da projeção. Depois, crie uma migration compensatória que remova o trigger `DmLog_sync_contact` e a função `sync_contact_from_dm_log`. Preserve a tabela `Contact` até exportar ou migrar anotações e etiquetas manuais. A exclusão direta da tabela causaria perda dessas informações.

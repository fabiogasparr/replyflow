# Administração global da plataforma

Este módulo oferece à equipe do ReplyFlow uma visão global, somente leitura, de empresas, planos, uso e alertas básicos. Ele não permite editar clientes, trocar planos, acessar tokens da Meta, visualizar metadados de cobrança ou assumir a identidade de um usuário.

## Separação de papéis

Existem dois níveis independentes de autorização:

- `WorkspaceRole` (`OWNER`, `ADMIN`, `MEMBER`) controla o que uma pessoa pode fazer dentro de uma empresa.
- `PlatformRole` (`USER`, `ADMIN`) controla o acesso à operação global do SaaS.

Um administrador de workspace continua sendo um usuário comum da plataforma. Somente `User.platformRole = ADMIN` libera `/admin` e `/api/platform/overview`. A API consulta o papel persistido a cada requisição e nega o acesso por padrão.

## Conceder e remover acesso

Primeiro aplique as migrations. Depois use uma conta já existente, com e-mail verificado:

```bash
npm run admin:role -- grant admin@empresa.com --confirm
```

Para remover:

```bash
npm run admin:role -- revoke admin@empresa.com --confirm
```

O comando exige `--confirm`, não cria usuários, não verifica e-mails automaticamente e impede a remoção do último administrador global. A contagem e a revogação são executadas em uma transação serializável para que duas revogações concorrentes não eliminem acidentalmente todos os administradores. A aplicação local não promove ninguém durante a migration; todos os usuários recebem `USER` por padrão.

## Dados exibidos

O painel mostra:

- quantidade de empresas ativas e arquivadas;
- quantidade de usuários e contas do Instagram;
- DMs contabilizadas no mês corrente;
- distribuição das assinaturas por plano e estado;
- proprietário, plano, uso e quantidade de recursos de cada workspace;
- contagem de tokens vencidos e webhooks ainda não inscritos.

A consulta seleciona apenas `tokenExpiresAt` e `webhookSubscribed` para calcular alertas. `InstagramAccount.accessToken`, segredos de autenticação, mensagens, dados pessoais de contatos, `BillingEvent.metadata` e razões internas de falha não saem do servidor.

## Implantação e migration

A migration `20260908200000_add_platform_role` é aditiva:

1. cria o enum `PlatformRole`;
2. adiciona `User.platformRole` como obrigatório, com padrão `USER`;
3. cria um índice para consultas administrativas.

Ordem segura de implantação:

1. aplicar `npm run db:migrate`;
2. publicar a aplicação;
3. promover o primeiro administrador com o comando explícito;
4. testar o acesso a `/admin` com essa conta e a negação com uma conta comum.

O teste `npm run test:platform-admin-db` aplica todas as migrations anteriores em um schema PostgreSQL descartável, insere um usuário legado, aplica a migration nova e valida backfill, padrão, enum, promoção e índice.

## Falha e rollback

- Se a consulta global falhar, apenas o painel administrativo fica indisponível; workspaces, automações e worker continuam operando.
- Para rollback de aplicação, a versão anterior ignora a nova coluna. A coluna e o enum podem permanecer no banco sem afetar o produto.
- Não remova a coluna durante uma reversão emergencial. Uma remoção futura deve primeiro confirmar que nenhum administrador global depende dela e ser entregue em outra migration.
- Revogar todos os administradores pela alteração direta do banco não é suportado; o comando protege o último acesso operacional.

O painel não substitui trilhas de auditoria nem ferramentas de suporte. Mutações globais, impersonação e reprocessamento permanecem fora deste módulo até receberem regras e auditoria próprias.

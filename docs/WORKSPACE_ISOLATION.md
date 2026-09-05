# Isolamento de dados por workspace

O ReplyFlow trata o workspace ativo como a fronteira de autorização para todos os dados de cliente. O identificador enviado pelo navegador nunca é suficiente para liberar acesso: a aplicação resolve a sessão, confirma a participação em `WorkspaceMember` e acrescenta `workspaceId` às consultas autenticadas.

## Invariantes

1. Rotas autenticadas resolvem o workspace pelo servidor com `getCurrentWorkspaceId` ou `getCurrentWorkspaceContext`.
2. Leituras de automações, contatos, logs, contas do Instagram, métricas, equipe e auditoria incluem o `workspaceId` ativo.
3. Alterações e exclusões repetem `workspaceId` no próprio `WHERE`, mesmo depois de uma leitura autorizada.
4. IDs de contas do Instagram recebidos do cliente são resolvidos por `getWorkspaceInstagramAccount`, que exige a combinação conta + workspace.
5. Alertas do worker carregam `workspaceId` e são filtrados antes de chegar ao diagnóstico. Alertas antigos sem escopo não são exibidos.
6. Tokens, access tokens da Meta e conteúdo de mensagens não entram na trilha de auditoria.

## Entradas deliberadamente públicas

| Entrada | Chave de acesso | Limite de dados |
| --- | --- | --- |
| Aceite de convite | Token aleatório + mesmo e-mail autenticado | Workspace do convite |
| Relatório compartilhado | `reportShareSlug` aleatório e habilitado | Uma automação e suas métricas |
| Link rastreado | `slug` aleatório | Um destino e um evento de clique |
| Webhook da Meta | Assinatura validada | Workspace derivado da conta oficial |

Essas entradas não usam o workspace ativo porque são fluxos de capacidade ou integrações de servidor. O workspace é derivado do registro encontrado, nunca de um valor livre enviado pelo visitante.

## Processos globais

Crons e workers percorrem vários workspaces por desenho. Cada job parte de uma conta do Instagram persistida, propaga seu `workspaceId` para logs, uso e eventos operacionais e valida que a automação pertence à mesma conta antes de enviar mensagens.

O endpoint de saúde expõe somente telemetria da infraestrutura; nenhum payload de cliente é consultado nele. A tela de diagnóstico pode mostrar saúde e contagens globais da fila, mas falhas, comentários, webhooks, tokens e alertas são filtrados pelo workspace ativo.

## Verificação obrigatória

Mudanças em consultas multiempresa devem passar por:

```bash
npm run lint
npm run typecheck
npm test
npm run build -- --webpack
```

Os testes de isolamento cobrem seleção de workspace, conexão de conta, papéis, convites, auditoria, contatos e filtragem de alertas do worker. O CRM também executa `npm run test:contacts-db` contra um schema PostgreSQL descartável para validar a chave estrangeira composta, o backfill e a ingestão concorrente.

# Reprocessamento seguro de envios

O ReplyFlow oferece recuperação manual de envios interrompidos antes da chamada de entrega à Meta. A ação fica em **Envios**, é restrita a proprietários e administradores e sempre opera dentro da empresa ativa.

## Regra de segurança

A API da Meta não oferece ao ReplyFlow uma chave de idempotência para transformar uma tentativa de mensagem em uma operação exatamente uma vez. Uma conexão pode cair depois de a Meta aceitar a mensagem e antes de o worker receber a confirmação. Repetir essa tentativa poderia entregar duas mensagens ao contato.

Por isso, `deliveryAttemptedAt` é a fronteira de segurança:

- `FAILED`, `SKIPPED_RATE_LIMIT` e `SKIPPED_PLAN_LIMIT` podem ser reprocessados somente quando `deliveryAttemptedAt` é nulo;
- uma falha com `deliveryAttemptedAt` preenchido continua visível para diagnóstico, mas não oferece reenvio;
- `SENT`, `PENDING`, deduplicações e interações de botão não podem ser reprocessados;
- a empresa precisa estar ativa e o token da conta do Instagram não pode estar vencido;
- uma automação pausada precisa ser reativada;
- há intervalo mínimo de um minuto entre solicitações para o mesmo log.

O comportamento também segue a exigência da [Send API oficial do Instagram](https://www.postman.com/meta/instagram/folder/uxudqu0/send-api): o destinatário precisa ter iniciado a conversa. O ReplyFlow não tenta contornar janelas ou permissões da Meta.

## Contexto persistido

A migration `20260905030000_add_dm_reprocessing` adiciona ao `DmLog`:

- `triggerType`: comentário, mensagem recebida ou postback;
- `sourceEventId`, `sourceMediaId`, `originalMediaId` e `source`;
- `deliveryAttemptedAt`;
- `manualRetryCount` e `lastManualRetryAt`.

O worker grava esses dados a partir do job original. Um reprocessamento usa essa cópia imutável, não tenta adivinhar os dados atuais da campanha e inclui `automationId` no novo job para acionar somente a automação escolhida.

Registros históricos recebem um backfill conservador. Mensagens e postbacks são identificados pelos prefixos já existentes. Uma campanha ligada a uma publicação recupera seu `postId`. Falhas antigas que não provam ter parado antes da entrega são marcadas como tentativas ambíguas e permanecem bloqueadas.

## Fluxo da API

`POST /api/logs/:id/retry` executa:

1. autenticação, empresa ativa e permissão `automations:manage`;
2. busca repetindo o escopo no log, na automação e na conta do Instagram;
3. validação da fronteira de segurança e do contexto de origem;
4. reserva concorrente do log com `updateMany` condicionado à versão operacional observada;
5. inclusão de um job com identificador `manual_retry_<log>_<contador>`;
6. compensação do estado anterior se o Redis rejeitar o job;
7. auditoria `DM_RETRY_REQUESTED`, sem texto da mensagem ou comentário.

A fila é o resultado principal. Se somente a gravação de auditoria falhar depois do enfileiramento, a API mantém a resposta de sucesso e registra o erro no servidor; responder falha induziria um segundo clique.

## Operação e diagnóstico

Na tela **Envios**, o operador vê a origem, status, erro, número de reprocessamentos e o botão de ação. Quando o botão está bloqueado, seu texto auxiliar informa o motivo.

Administradores globais também possuem uma fila sanitizada em `/admin`. Ela não mostra contatos ou conteúdo e adiciona confirmação digitada, empresa ativa, token válido e heartbeat do worker às mesmas regras. O contrato completo está em `docs/PLATFORM_SUPPORT.md`.

Antes de reprocessar:

1. corrija a causa, como reconectar a conta ou ajustar o plano;
2. confirme que o worker e o Redis estão saudáveis;
3. use **Reprocessar** uma vez;
4. acompanhe a mudança de `PENDING` para `SENT` ou um novo motivo de falha.

Valide a migration com `npm run test:dm-retry-db`. O script aceita somente PostgreSQL em localhost, aplica todas as migrations em um schema descartável, verifica o backfill e remove o schema ao terminar. Execute também `npm run test:dm-retry-queue`: ele usa uma fila Redis exclusiva e descartável para provar que solicitações concorrentes com o mesmo identificador geram um único job.

## Implantação e rollback

Implante primeiro a aplicação e o worker compatíveis, executando `npm run db:migrate` antes de iniciar os novos processos. A alteração é aditiva e não agenda nenhum reenvio automaticamente.

Para rollback, publique a versão anterior da aplicação e do worker. Preserve os campos adicionados enquanto houver jobs manuais na fila. Depois de esvaziá-la, uma migration compensatória pode remover o índice, as colunas e, por último, o enum `DmTriggerType`. Nunca altere `deliveryAttemptedAt` para forçar um reenvio: esse campo é uma trava contra duplicidade.

# Central segura de suporte

A central em `/admin` permite que administradores globais investiguem falhas de entrega e solicitem o reprocessamento de um único envio sem entrar na conta do cliente. Ela complementa a observabilidade global e reutiliza a fronteira de segurança já adotada na tela **Envios** de cada workspace.

## Princípios de acesso

- somente usuários com `User.platformRole = ADMIN` acessam a API e a interface;
- o papel é consultado no banco a cada requisição;
- não existe impersonação, troca silenciosa de workspace ou ação em lote;
- a resposta não contém nome ou ID do contato, comentário, mensagem, palavra acionadora, erro interno, token ou identificador do evento da Meta;
- busca e paginação usam apenas empresa, campanha, conta do Instagram, status e datas operacionais;
- respostas autenticadas usam `Cache-Control: private, no-store`.

O servidor carrega o contexto privado necessário para reconstruir o job, mas serializa apenas metadados de operação. Relações inconsistentes entre log, automação, conta e workspace são descartadas da central e nunca viram uma ação.

## Travas de reprocessamento

Uma solicitação global só prossegue quando todas as condições abaixo são verdadeiras:

1. a empresa existe, está ativa e seu nome exato foi digitado na confirmação;
2. Redis responde e o worker possui heartbeat recente;
3. o log, a automação e a conta pertencem à empresa informada;
4. a automação está ativa e o token da conta não venceu;
5. o status é `FAILED`, `SKIPPED_RATE_LIMIT` ou `SKIPPED_PLAN_LIMIT`;
6. `deliveryAttemptedAt` é nulo, provando que a chamada de entrega não começou;
7. o evento de origem persistido permite reconstruir o job;
8. o intervalo de segurança desde a última solicitação terminou;
9. a reserva otimista do log ainda corresponde ao estado lido.

Se a Meta pode ter recebido a mensagem, o reenvio permanece bloqueado. A central não oferece substituição manual dessa trava. Limites de plano ou da Meta devem ser corrigidos ou aguardar sua janela antes de uma nova tentativa.

## Execução e auditoria

O serviço compartilhado `requestDmRetry` é usado tanto pelo workspace quanto pelo suporte. Ele muda o log para `PENDING` com uma atualização condicional, cria um job determinístico para uma única automação e compensa o estado se a fila rejeitar o job.

A ação global grava `SUPPORT_DM_RETRY_REQUESTED` na auditoria do próprio workspace com o administrador responsável, tipo de origem, número da tentativa e canal `PLATFORM_SUPPORT`. Conteúdo do cliente não entra nos metadados. Se a auditoria falhar depois que a fila aceitou o job, a resposta continua sendo sucesso para não induzir um segundo clique.

## Índice e validação

A migration `20260909123000_add_platform_support_index` adiciona o índice composto `DmLog_status_updatedAt_id_idx`, usado pela triagem global ordenada por atualização. Ela não altera registros nem agenda jobs.

Validações específicas:

```bash
npm run test:platform-support-db
npm run test:dm-retry-db
npm run test:dm-retry-queue
```

O primeiro comando aplica as 33 migrations em um schema PostgreSQL descartável e confirma o índice. Os demais preservam as provas de backfill, isolamento, deduplicação e compensação do fluxo original.

## Implantação e rollback

Ordem recomendada:

1. aplicar `npm run db:migrate` — o índice é aditivo e compatível com a versão anterior;
2. publicar a aplicação; o contrato atual do worker não muda;
3. confirmar Redis e heartbeat do worker em `/admin`;
4. abrir a central com um administrador global e validar que uma conta comum recebe negação;
5. testar uma ocorrência sintética elegível, uma ambígua e uma com token vencido;
6. conferir o evento na auditoria do workspace.

Para rollback, remova primeiro a interface e a rota de suporte publicando a versão anterior da aplicação. Jobs já aceitos continuam sendo processados pelo worker atual. O índice é aditivo e pode permanecer no banco; removê-lo não é necessário em emergência. Nunca limpe `deliveryAttemptedAt`, reduza `manualRetryCount` ou edite a fila manualmente para contornar as proteções.

# Estado operacional das automações

O ReplyFlow separa a intenção configurada pelo usuário do estado observado na operação. Uma campanha pode estar habilitada e, ainda assim, precisar de uma nova publicação ou de atenção na integração com a Meta.

## Estados exibidos

A API deriva um dos quatro estados, nesta ordem de prioridade:

1. **Pausada**: `isActive` está desabilitado. A campanha não processa novos eventos.
2. **Com erro**: o token da conta venceu ou a execução mais recente terminou em uma falha sistêmica ainda sem sucesso posterior.
3. **Aguardando publicação**: a campanha está habilitada para o próximo reel, mas ainda não recebeu um `postId`.
4. **Ativa**: está pronta para novos eventos. Uma falha restrita a um destinatário pode aparecer no histórico sem derrubar a campanha inteira.

O endpoint `GET /api/automations` calcula esse resumo no servidor e devolve rótulo, explicação em português, necessidade de atenção, última execução e número de falhas consecutivas. O diagnóstico original não é enviado ao navegador.

## Projeção persistida pelo worker

A migration `20260905040000_add_automation_operational_state` adiciona à automação:

- `lastRunAt` e `lastSuccessAt`;
- `lastErrorAt`, `lastErrorKind` e `lastErrorMessage`;
- `consecutiveFailures`;
- índice por `workspaceId` e `lastErrorAt`.

As falhas são classificadas como configuração, autenticação, limite de taxa, entrega individual ou plataforma. A mensagem armazenada remove tokens em parâmetros `access_token` e cabeçalhos `Bearer`, normaliza espaços e limita o conteúdo a 500 caracteres.

Cada gravação exige que o evento seja igual ou posterior a `lastRunAt`. Isso impede uma execução antiga, concluída fora de ordem, de sobrescrever um resultado mais novo. Se essa projeção auxiliar falhar, o worker apenas registra o problema no servidor: o resultado da entrega e o `DmLog` continuam sendo a fonte de verdade, sem criar outra tentativa de envio.

## Recuperação de credenciais

Uma reconexão OAuth e uma renovação bem-sucedida do token removem falhas de autenticação ou configuração ligadas à conta. A atualização do token e a recuperação das campanhas acontecem na mesma transação e repetem os filtros `workspaceId` + `instagramAccountId`.

Falhas de entrega, de limite ou de plataforma não são apagadas por uma troca de credencial. Elas são resolvidas por uma execução posterior bem-sucedida, preservando o diagnóstico correto da causa.

## Interface

Em **Campanhas**, cada cartão mostra o estado, a explicação e o horário da última execução. Os filtros permitem visualizar todas, ativas, pausadas, aguardando publicação ou com erro. Alterações de pausa/ativação aguardam a confirmação da API e recarregam o estado derivado; uma rejeição mantém o cartão anterior e mostra o erro ao operador.

## Validação

Execute:

```bash
npm run typecheck
npm run lint
npm test
npm run test:automation-state-db
npm run build
```

O teste de banco aceita somente PostgreSQL local, cria um schema descartável, aplica todas as migrations, verifica os valores padrão, a persistência da projeção e o índice, e remove o schema ao terminar. O isolamento da recuperação de credenciais é aprovado pelos testes das rotas OAuth e cron.

## Implantação e rollback

Execute `npm run db:migrate` antes de publicar a aplicação web e o worker desta versão. A migration é aditiva; a versão anterior ignora os novos campos, e nenhum envio ou reprocessamento é agendado automaticamente.

Para rollback imediato, publique a versão anterior da aplicação e do worker e mantenha as colunas. Se for necessário removê-las depois de confirmar que não haverá retorno à versão nova, crie uma migration compensatória que remova primeiro `Automation_workspaceId_lastErrorAt_idx` e depois as seis colunas. A remoção perde apenas o histórico operacional derivado; não altera campanhas, logs nem jobs existentes.

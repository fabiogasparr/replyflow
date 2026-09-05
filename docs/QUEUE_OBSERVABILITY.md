# Observabilidade de filas e worker

O painel **Diagnóstico** mostra a disponibilidade do Redis, o heartbeat do worker e o atraso da fila de cada empresa. A leitura se atualiza a cada 30 segundos e pode ser atualizada manualmente.

## Isolamento multiempresa

Os jobs do BullMQ carregam o identificador externo da conta profissional do Instagram. Antes de calcular qualquer métrica, `getWorkspaceQueueSnapshot` consulta somente as contas ligadas ao workspace ativo e filtra cada estado da fila por esses identificadores.

Assim, uma empresa recebe apenas suas próprias contagens de jobs aguardando, ativos, agendados e falhos. O atraso também considera somente o job aguardando ou ativo mais antigo dessa empresa. O teste Redis cria jobs de duas empresas e prova que a segunda não entra no resultado da primeira.

## Classificação

- **Sem pendências**: nenhum job da empresa nos estados observados;
- **Fluxo normal**: há jobs e o mais antigo está abaixo de 1 minuto;
- **Fila atrasada**: o mais antigo espera há pelo menos 1 minuto;
- **Atraso crítico**: espera de pelo menos 5 minutos;
- **Indisponível**: o Redis não respondeu.

Os limites podem ser ajustados em milissegundos com `QUEUE_WARNING_AGE_MS` e `QUEUE_CRITICAL_AGE_MS`.

## Amostra limitada

Para impedir que o diagnóstico faça uma leitura ilimitada em uma fila muito grande, cada estado examina no máximo 1.000 jobs por padrão. `QUEUE_OBSERVABILITY_SCAN_LIMIT` aceita valores positivos até 10.000. Quando algum estado alcança esse limite, a resposta marca `truncated: true` e a interface informa que as contagens são um limite inferior.

## Degradação controlada

As consultas do Redis são isoladas das consultas do PostgreSQL. Se fila, heartbeat ou alertas não responderem, `/api/admin/diagnostics` continua retornando as falhas de DM, webhook, token e eventos operacionais armazenados no banco. A interface sinaliza Redis e fila como indisponíveis, sem transformar zeros de fallback em uma falsa indicação de saúde.

## Validação e implantação

Execute:

```bash
npm test -- --run __tests__/queue-observability.test.ts __tests__/diagnostics-route.test.ts
npm run test:dm-retry-queue
npm run build
```

Esta entrega não altera o schema do banco. Aplicação web e worker continuam usando o mesmo `REDIS_URL`. Para rollback, publique a versão anterior da aplicação; os jobs existentes e o worker não precisam ser reiniciados, pois o formato da fila permanece compatível.

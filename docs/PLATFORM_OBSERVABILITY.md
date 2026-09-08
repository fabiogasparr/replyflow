# Observabilidade global da plataforma

A central de operações em `/admin` reúne sinais do banco, Redis, fila, worker, autenticação por e-mail, webhooks, entregas, integrações e cobrança. O módulo é exclusivo de administradores globais e permanece somente leitura.

## Estado dos serviços

O painel consulta ao vivo:

- disponibilidade das métricas persistidas no PostgreSQL;
- disponibilidade do Redis e leitura da fila BullMQ;
- heartbeat do worker de DMs, sem expor PID ou hostname;
- quantidade de jobs aguardando, ativos, agendados e falhos;
- prontidão sintática do provedor de e-mail usado pelo login.

A prontidão de e-mail detecta placeholders e configuração incompleta. Ela não substitui um teste real de entrega pelo Resend ou SMTP.

O estado consolidado pode ser:

- `HEALTHY`: nenhum sinal exige ação;
- `DEGRADED`: há avisos, jobs falhos, integrações incompletas ou anomalias moderadas;
- `CRITICAL`: banco/fila indisponível, worker sem heartbeat, atraso crítico ou anomalia severa.

No ambiente local o worker permanece desligado até autorização explícita para evitar DMs reais. Por isso a central deve classificar o worker local como crítico; esse resultado é esperado e confirma que o monitoramento não inventa saúde.

## Janelas e comparação

O administrador escolhe janelas móveis de 1 hora, 24 horas ou 7 dias. Cada janela é comparada ao período imediatamente anterior de mesma duração.

Para webhooks, entregas e eventos operacionais, o painel calcula:

- volume total;
- quantidade de incidentes;
- percentual de incidentes;
- tendência de alta, queda ou estabilidade;
- anomalia e severidade.

Uma variação inferior a 1 ponto percentual é considerada estável. Uma anomalia exige ao menos três incidentes, taxa atual mínima de 5% e crescimento relevante sobre o período anterior. A severidade se torna crítica a partir de dez incidentes e 25% de taxa. Esses limiares são operacionais, não compromissos de SLA, e devem ser recalibrados com dados reais de produção.

Entregas problemáticas incluem falhas, bloqueios por rate limit e bloqueios por limite do plano. Eventos `SKIPPED_NO_MATCH` não são tratados como falha porque representam uma decisão normal de correspondência.

## Priorização de empresas

O painel apresenta até dez workspaces com maior pontuação operacional. A pontuação usa somente contagens:

- token vencido: peso 5;
- erro de autenticação/configuração: peso 4;
- falha de webhook, erro operacional ou problema de cobrança: peso 3;
- falha/bloqueio de entrega ou webhook não inscrito: peso 2;
- token que vence nos próximos sete dias: peso 1.

Essa ordem serve para triagem. Ela não altera clientes, não reprocessa jobs e não assume a identidade de usuários.

## Privacidade e isolamento

A API `/api/platform/operations` revalida `PlatformRole.ADMIN` em toda requisição. Como a tela atualiza periodicamente, uma sessão expirada volta ao login e um papel global revogado sai da área administrativa na próxima leitura, em no máximo 30 segundos. Ela não retorna:

- payloads de webhook ou fila;
- IDs de jobs, comentários, remetentes ou destinatários;
- mensagens, notas ou dados de contatos;
- tokens da Meta;
- mensagens internas de erro ou URLs de conexão;
- PID e hostname do worker;
- metadados financeiros.

Falhas internas são convertidas em estados indisponíveis e mensagens estáveis em português. O ranking identifica apenas workspace, nome, estado de arquivamento e contagens agregadas. O diagnóstico detalhado de cada empresa continua isolado ao workspace ativo.

## Atualização e custo

A interface atualiza a cada 30 segundos enquanto a página está aberta e oferece atualização manual. A API usa `force-dynamic` e não armazena snapshots em cache.

As consultas de janela foram apoiadas por seis índices aditivos:

- expiração de sessões;
- expiração de tokens do Instagram;
- último erro de automação;
- atualização de logs de DM;
- criação de webhooks;
- criação de eventos de cobrança.

O limite de leitura de jobs usa `QUEUE_OBSERVABILITY_SCAN_LIMIT`, com máximo de 10.000. Quando o limite é atingido, o snapshot informa `truncated` em vez de apresentar uma contagem como completa.

## Implantação e rollback

Ordem recomendada:

1. aplicar `npm run db:migrate`;
2. publicar a aplicação web;
3. confirmar que um administrador global acessa `/admin`;
4. validar os estados de PostgreSQL, Redis e worker;
5. manter o worker desligado em ambientes que não podem enviar DMs reais.

O teste `npm run test:platform-observability-db` aplica as 30 migrations em um schema PostgreSQL descartável e confirma todos os índices.

Rollback seguro:

- a versão anterior da aplicação ignora os índices, então eles podem permanecer no banco;
- não é necessário remover índices durante uma reversão emergencial;
- se a coleta Redis falhar, métricas do banco continuam disponíveis;
- se uma consulta do banco falhar depois da autorização, os serviços ao vivo continuam visíveis e as métricas persistidas aparecem como indisponíveis;
- a observabilidade nunca inicia ou reinicia automaticamente o worker.

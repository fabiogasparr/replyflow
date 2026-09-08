# Fundação de planos e cobrança

Esta etapa cria o domínio persistente necessário para cobrança sem ativar pagamentos nem alterar os limites em produção.

## Entidades

- `Plan`: catálogo por código (`FREE`, `PRO`, `AGENCY`), moeda, preço mensal opcional e capacidades;
- `Subscription`: assinatura atual de cada workspace, com status, período e identificadores opcionais do provedor;
- `UsageRecord`: medição por workspace, métrica e período;
- `BillingEvent`: trilha idempotente dos eventos recebidos de um provedor.

A migration cria os três planos atuais, gera uma assinatura manual para cada workspace existente e copia o contador mensal de DMs para `UsageRecord`. O campo `Workspace.plan` e os contadores atuais continuam sendo a fonte de aplicação dos limites nesta entrega, permitindo publicar aplicação e worker antes ou depois da migration.

## Decisões comerciais ainda abertas

O plano Gratuito recebe preço zero. Os preços de Pro e Agência permanecem nulos até aprovação comercial. O limite de DMs também preserva o valor efetivamente ilimitado da instalação atual; não haverá bloqueio novo por causa desta migration.

Nenhum checkout, link de pagamento, webhook externo ou movimentação financeira foi habilitado. `MERCADO_PAGO` e `STRIPE` existem apenas como opções de modelagem para uma integração futura.

## Visão no produto

`GET /api/billing/overview` retorna somente a assinatura do workspace ativo e o contador mensal que continua sendo a fonte operacional. A tela de Configurações apresenta plano, estado, mensalidade e progresso de uso; quando o preço ainda não foi aprovado, informa isso explicitamente em vez de exibir um valor estimado.

Novos workspaces criam assinatura Gratuita e registro mensal de uso na mesma transação que cria o proprietário e a auditoria. Assim, não existe uma janela em que o espaço esteja ativo sem sua estrutura de cobrança.

## Ciclo interno de assinatura

O serviço interno `processSubscriptionEvent` prepara a aplicação para receber eventos de Stripe ou Mercado Pago, mas ainda não existe rota pública de webhook nem credencial de cobrança configurada. Cada adaptador futuro deverá verificar a assinatura criptográfica do provedor antes de chamar esse serviço.

- o identificador externo torna cada evento idempotente;
- a assinatura é bloqueada no PostgreSQL durante a transição, evitando que eventos concorrentes sobrescrevam uma atualização mais nova;
- eventos anteriores ao último evento aplicado ficam registrados como ignorados;
- assinatura, plano efetivo do workspace e auditoria são atualizados na mesma transação;
- `TRIALING`, `ACTIVE` e `PAST_DUE` mantêm o plano contratado; `PAST_DUE` representa a tolerância operacional, não uma renovação confirmada;
- `CANCELED` e `INCOMPLETE` removem o direito pago e retornam o workspace ao plano Gratuito;
- períodos invertidos, planos indisponíveis e troca inesperada de provedor falham sem mudar o acesso;
- metadados são limitados e chaves que indiquem token, segredo, cookie, senha ou dados de cartão são descartadas.

Preços, duração da tolerância, política de tentativas e ações iniciadas pelo cliente continuam pendentes de decisão comercial. O processador não cria cobrança, checkout, reembolso ou assinatura no provedor.

## Isolamento e idempotência

- toda assinatura e todo registro de uso pertencem a exatamente um workspace;
- um workspace possui no máximo uma assinatura atual;
- a chave `(provider, providerEventId)` impede processar o mesmo evento duas vezes;
- identificadores de cliente e assinatura são únicos dentro de cada provedor, sem criar colisões artificiais entre provedores diferentes;
- a chave estrangeira composta `(subscriptionId, workspaceId)` impede associar um evento à assinatura de outra empresa;
- restrições do PostgreSQL rejeitam preços e quantidades negativos e períodos invertidos;
- metadados futuros devem ser sanitizados e nunca armazenar segredos, tokens ou dados completos de cartão.

## Implantação e rollback

Antes de publicar código que leia as novas tabelas ou grave o cursor de eventos, execute `npm run db:migrate`. As migrations são aditivas e fazem backfill sem apagar ou alterar os contadores existentes.

Valide em PostgreSQL local com:

```bash
npm run test:billing-db
```

Para rollback, publique primeiro a versão anterior da aplicação; as tabelas e as colunas de cursor podem permanecer sem impacto. Removê-las exige backup e uma migration reversa explícita. Não reverta manualmente em produção enquanto eventos de cobrança estiverem sendo gravados.

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

## Isolamento e idempotência

- toda assinatura e todo registro de uso pertencem a exatamente um workspace;
- um workspace possui no máximo uma assinatura atual;
- a chave `(provider, providerEventId)` impede processar o mesmo evento duas vezes;
- identificadores de cliente e assinatura são únicos dentro de cada provedor, sem criar colisões artificiais entre provedores diferentes;
- a chave estrangeira composta `(subscriptionId, workspaceId)` impede associar um evento à assinatura de outra empresa;
- restrições do PostgreSQL rejeitam preços e quantidades negativos e períodos invertidos;
- metadados futuros devem ser sanitizados e nunca armazenar segredos, tokens ou dados completos de cartão.

## Implantação e rollback

Antes de publicar código que leia as novas tabelas, execute `npm run db:migrate`. A migration é aditiva e faz backfill sem apagar ou alterar os contadores existentes.

Valide em PostgreSQL local com:

```bash
npm run test:billing-db
```

Para rollback da aplicação, publique o commit anterior; as tabelas novas podem permanecer sem impacto. Removê-las exige backup e uma migration reversa explícita. Não reverta manualmente em produção enquanto eventos de cobrança estiverem sendo gravados.

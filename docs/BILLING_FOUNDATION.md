# Fundação de planos e cobrança

Esta etapa cria o domínio persistente necessário para cobrança sem ativar pagamentos nem alterar os limites em produção.

## Entidades

- `Plan`: catálogo por código (`FREE`, `PRO`, `AGENCY`), moeda, preço mensal opcional e capacidades;
- `Subscription`: assinatura atual de cada workspace, com status, período e identificadores opcionais do provedor;
- `UsageRecord`: medição por workspace, métrica e período;
- `BillingEvent`: trilha idempotente dos eventos recebidos de um provedor.

A migration cria os três planos atuais, gera uma assinatura manual para cada workspace existente e copia o contador mensal de DMs para `UsageRecord`. O campo `Workspace.plan` e o contador anterior permanecem como espelhos de compatibilidade para permitir implantações graduais.

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

## Medição e limite de DMs

Antes de cada envio, o worker reserva uma unidade no `UsageRecord` do mês usando uma atualização condicional no PostgreSQL. O limite vem de `Plan.monthlyDmLimit`, alcançando imediatamente todos os handlers do worker que já usam a reserva central. Se duas tarefas disputarem a última unidade, somente uma avança.

A reserva, a criação do período e o contador de compatibilidade do workspace fazem parte da mesma transação. Falha antes do envio ou resposta rejeitada pela Meta libera a unidade no mesmo período; uma compensação antiga não reduz o mês atual. A visão de cobrança lê `UsageRecord` e usa o contador anterior somente como fallback durante implantação gradual.

Os três planos continuam configurados com 2 bilhões de DMs mensais, portanto esta entrega ativa a infraestrutura de aplicação do limite sem reduzir a capacidade comercial existente. Alterar esse número passa a ter efeito operacional e deve ser tratado como decisão comercial, com comunicação e monitoramento.

## Direitos de contas e equipe

Os limites de contas do Instagram e integrantes também são lidos exclusivamente do `Plan` associado à assinatura. A validação é repetida dentro das transações de conexão e convite, evitando que duas operações concorrentes consumam a mesma última vaga.

Depois de um downgrade, contas e integrantes acima do novo limite não são removidos automaticamente. O workspace continua acessível, mas novas conexões e novos convites ficam bloqueados até o uso voltar à capacidade contratada. Se a assinatura estiver temporariamente ausente durante uma implantação, essas operações falham fechadas com a mensagem “Plano ainda em preparação”.

O dashboard e a tela de configurações exibem nome e capacidades do mesmo registro persistido. Assim, uma alteração administrativa no catálogo não depende de recompilar constantes da aplicação.

## Atividade da assinatura

Proprietários podem consultar em Configurações um histórico paginado dos eventos da assinatura, com filtros para processados, falhos, ignorados e pendentes. A API valida o cursor dentro do workspace e do filtro atual, e as contagens sempre pertencem ao espaço ativo.

O retorno inclui somente estado, tipo, provedor, referência externa e datas necessárias ao suporte. O campo `metadata` nunca é selecionado. Motivos de falha passam por uma segunda camada de redação para remover tokens, cookies, senhas, cabeçalhos de autorização e referências a cartão antes de chegar ao navegador. Administradores e membros recebem `403`.

Essa atividade é uma trilha operacional, não um histórico de faturas ou comprovantes. O portal financeiro permanece pendente da escolha do provedor e da definição comercial.

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
npm run test:billing-usage-db
```

Para rollback, publique primeiro a versão anterior da aplicação; as tabelas e as colunas de cursor podem permanecer sem impacto. A versão anterior volta a usar as capacidades estáticas originais e simplesmente deixa de exibir a atividade. Removê-las exige backup e uma migration reversa explícita. Não reverta manualmente em produção enquanto eventos de cobrança estiverem sendo gravados.

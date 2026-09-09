# Relatórios de performance

O painel autenticado em `/reports` consolida resultados do workspace ativo sem misturar empresas e sem transformar cliques em vendas. A API correspondente é `GET /api/reports/performance`.

## Escopo e filtros

O usuário pode escolher:

- workspace pelo seletor persistente da navegação;
- todas as contas do Instagram ou uma conta do workspace ativo;
- todas as automações compatíveis com a conta ou uma automação;
- últimos 7, 30 ou 90 dias;
- intervalo personalizado de até 366 dias.

As datas representam dias civis em `America/Sao_Paulo`. Cada resultado compara envios, cliques e falhas com a janela imediatamente anterior de igual duração. Por exemplo, 7 dias são comparados aos 7 dias anteriores.

Conta e automação são validadas contra o workspace antes de qualquer consulta de métricas. Todas as agregações de `DmLog` e `LinkClick` repetem `workspaceId`, data e filtros aplicáveis. Trocar de workspace remonta o painel e descarta o estado do cliente anterior.

## Definições das métricas

- **Mensagens enviadas:** logs com status `SENT` criados no período.
- **Descartes:** statuses iniciados por `SKIPPED_`; são decisões de regra ou limite, não entregas.
- **Falhas:** logs com status `FAILED`.
- **Cliques rastreados:** eventos `LinkClick` criados no período.
- **CTR:** cliques rastreados divididos pelas mensagens enviadas. O resultado é zero quando não há envios.
- **Taxa de entrega:** mensagens enviadas divididas pela soma de enviadas e falhas. Descartes não entram no denominador.
- **Interações processadas:** soma de enviadas, descartadas e falhas exibida no funil.

O status `SENT` confirma que a chamada oficial de envio foi concluída; não é uma confirmação de leitura. Cliques podem exceder envios quando um mesmo link recebe mais de um acesso, portanto o CTR não é artificialmente limitado a 100%.

Conversão em venda permanece indisponível. Ela só será publicada depois que o ReplyFlow receber um evento de negócio identificável e documentado, como pedido aprovado ou lead qualificado. Um clique nunca é rotulado como venda.

## Interface e exportação

O painel mostra cartões consolidados, tendência diária, funil observado, comparação por automação e palavras-chave mais frequentes. Períodos vazios continuam retornando todos os dias com zero, evitando gráficos incompletos.

`format=csv` exporta a tabela por automação. O arquivo:

- usa UTF-8 com BOM e ponto e vírgula para compatibilidade com planilhas em pt-BR;
- inclui somente métricas agregadas, nomes de automações e usuários públicos das contas;
- não contém comentários, IDs de pessoas, mensagens, IPs, agentes de usuário ou tokens;
- neutraliza valores iniciados por `=`, `+`, `-` ou `@` para impedir execução de fórmulas ao abrir a planilha;
- usa `Cache-Control: private, no-store` assim como a resposta JSON.

## Custo e índices

As métricas consolidadas usam agrupamentos no PostgreSQL. A série diária é calculada em uma consulta com `UNION ALL`, em vez de uma consulta por dia. A migration `20260909093000_add_performance_report_indexes` adiciona cinco índices compostos para as combinações de workspace, conta, automação e data usadas pelos relatórios.

O teste `npm run test:performance-reporting-db` aplica as 31 migrations em um schema PostgreSQL descartável e valida os cinco índices sem alterar o schema principal.

## Implantação e rollback

Ordem recomendada:

1. aplicar `npm run db:migrate`;
2. publicar a aplicação web;
3. abrir `/reports` em um workspace com dados;
4. validar períodos, filtros e download CSV;
5. conferir que um membro comum visualiza métricas, mas não recebe dados de outro workspace.

Rollback seguro:

- a versão anterior da aplicação ignora os novos índices, então eles podem permanecer no banco;
- a migration é aditiva e não altera nem remove registros;
- para uma reversão emergencial, publique a versão anterior antes de considerar remover índices;
- remover índices é opcional e deve ser feito fora do horário de pico;
- este módulo é somente leitura e não inicia o worker, não reprocessa jobs e não envia DMs.

## Compartilhamento

Proprietários e administradores podem publicar uma versão agregada por campanha com marca do cliente e período fixo de 7, 30 ou 90 dias. Links podem ser renovados ou revogados e não expõem dados pessoais. O contrato de autorização, privacidade, migration e rollback está em [Relatórios compartilháveis](SHARED_REPORTS.md).

Conversão comercial depende primeiro da definição do evento de negócio e de sua política de atribuição.

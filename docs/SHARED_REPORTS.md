# Relatórios compartilháveis

O ReplyFlow permite publicar uma visão agregada de uma campanha em `/reports/{slug}`. O endereço funciona como uma chave de acesso: quem recebe o link pode abrir o relatório sem login, mas não recebe contatos, mensagens, identificadores de pessoas, tokens ou dados de outros workspaces.

## Publicação e permissões

- relatórios novos ficam privados por padrão;
- proprietários e administradores podem definir a marca, publicar, alterar o período, renovar o endereço e revogar o acesso;
- membros podem consultar e copiar um link já publicado, mas não alteram a configuração;
- publicar aceita somente períodos fechados de 7, 30 ou 90 dias;
- revogar remove o slug persistido, portanto o endereço antigo deixa de resolver imediatamente;
- renovar gera outro slug e invalida o endereço anterior na mesma transação lógica;
- publicação, revogação, renovação e mudança de marca entram na auditoria do workspace.

As operações de gestão usam o workspace resolvido da sessão. Toda leitura e escrita de campanha repete `id + workspaceId`, impedindo que um identificador de outro cliente seja usado para alterar seu relatório.

## Marca e privacidade

Cada workspace pode definir um nome de apresentação e uma cor hexadecimal. O relatório público usa essas informações para gerar cabeçalho, monograma e contraste legível, mantendo apenas uma assinatura discreta do ReplyFlow.

Esta versão não carrega logotipos por URL externa. Além de exigir armazenamento e política de moderação, uma imagem remota poderia permitir rastreamento do visitante por um terceiro. Um futuro upload deverá usar armazenamento controlado, validação de tipo/tamanho e uma política explícita de retenção.

A rota pública é dinâmica, usa `noindex` e não deve ser adicionada à lista de prefixos autenticados do proxy. A segurança depende de um slug aleatório ativo, não do workspace selecionado no navegador. Respostas públicas não expõem dados pessoais; a gestão autenticada usa `private, no-store`.

## Métricas

O período considera dias civis em `America/Sao_Paulo`, incluindo o dia atual. Todas as consultas repetem workspace, automação e intervalo. A série diária é agregada em uma consulta SQL e preenche dias sem atividade com zero.

O relatório exibe envios, falhas, descartes, cliques rastreados, CTR, entrega, palavras-chave e links da campanha. `SENT` representa uma chamada de envio concluída, não leitura. Cliques não são apresentados como vendas, e conversão comercial continua indisponível até existir um evento de negócio confiável.

## Compatibilidade e migration

A migration `20260909103000_add_report_sharing_controls`:

1. adiciona nome e cor da marca ao workspace;
2. adiciona período, datas de publicação e revogação à automação;
3. altera o padrão de compartilhamento para privado;
4. preserva os slugs públicos antigos e registra sua data de publicação;
5. restringe no PostgreSQL cores inválidas e períodos diferentes de 7, 30 ou 90 dias.

`npm run test:report-sharing-db` aplica todas as 32 migrations em um schema descartável e valida defaults, backfill e constraints sem alterar o schema principal.

## Implantação e rollback

Ordem recomendada:

1. aplicar `npm run db:migrate`;
2. publicar a aplicação web;
3. configurar a marca em `/reports`;
4. publicar uma campanha de teste e conferir o endereço em uma janela anônima;
5. renovar o link e confirmar que o anterior retorna não encontrado;
6. revogar o novo link e confirmar o mesmo comportamento.

Para rollback, publique primeiro a versão anterior da aplicação. As colunas e constraints são aditivas e podem permanecer no banco. Relatórios antigos continuam com o mesmo slug graças ao backfill; relatórios criados depois desta entrega permanecem privados até uma publicação explícita. Remover as colunas não é necessário em uma reversão emergencial e perderia preferências de marca e histórico de estado.

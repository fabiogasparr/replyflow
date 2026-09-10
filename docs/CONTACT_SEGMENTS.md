# Segmentos dinâmicos de contatos

A lista de contatos permite combinar filtros de identidade e de comportamento sem criar uma cópia da base. Cada recorte fica representado na URL e pode ser compartilhado com outra pessoa que já tenha acesso ao mesmo workspace.

## Filtros disponíveis

- busca por usuário ou identificador do Instagram;
- conta profissional conectada;
- etiqueta manual;
- campanha com a qual o contato interagiu;
- origem por comentário ou mensagem/resposta ao Story;
- resultado da entrega: enviada, falhou, pendente ou não realizada;
- atividade nos últimos 7, 30, 90 ou 365 dias.

Campanha, origem e resultado são aplicados sobre a mesma interação registrada em `DmLog`. Portanto, selecionar uma campanha e “DM entregue” não mistura uma entrega de outra campanha do mesmo contato.

## Segurança e privacidade

O endpoint continua autenticado e sem cache. A consulta SQL é construída com `Prisma.sql`: workspace, busca, etiqueta e todos os valores de comportamento são parâmetros, nunca texto interpolado.

O isolamento é repetido em quatro limites:

1. contato pertence ao workspace ativo;
2. conta do Instagram pertence ao mesmo workspace;
3. interação pertence ao workspace e à identidade composta do contato;
4. campanha pertence ao workspace e à mesma conta do Instagram.

Depois da paginação SQL, os contatos são carregados novamente com `workspaceId` e uma seleção explícita. Anotações, credenciais da conta, mensagens privadas e conteúdo interno não entram na listagem. O link compartilhado contém apenas os filtros; ele não concede acesso nem substitui autenticação.

## Modelo e desempenho

Os segmentos são dinâmicos e usam `Contact`, `DmLog`, `Automation` e `InstagramAccount` como fontes autoritativas. Não existe tabela de segmento ou projeção duplicada para ficar desatualizada.

O índice composto `DmLog_contact_createdAt_idx` atende a correlação por workspace, conta e identidade, enquanto os índices existentes por workspace/campanha/data apoiam os demais recortes. Esta entrega não altera o schema, o trigger de contatos, o worker, a fila BullMQ ou a integração oficial da Meta.

## Implantação e rollback

Não há migration nem backfill. A implantação publica apenas aplicação e API. Para rollback, publique a versão anterior; URLs com filtros adicionais serão simplesmente ignoradas pela interface anterior. Nenhum contato, log ou dado manual precisa ser convertido ou removido.

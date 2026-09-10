# Construtor visual de fluxos

O construtor de campanhas oferece dois modos sobre a mesma configuração: **Mapa do fluxo** e **Conteúdo e prévia**. O mapa torna visível a jornada executada pela automação; o formulário continua responsável pelos textos, publicação, palavras-chave, links e simulação do Instagram.

## Contrato versionado

O mapa não cria um segundo motor nem persiste uma cópia do conteúdo da campanha. `buildAutomationFlow` projeta os campos existentes da entidade `Automation` nas seguintes etapas:

1. entrada por comentário e, quando habilitada, mensagem recebida;
2. ramo opcional de resposta pública no post;
3. DM inicial opcional com botão para continuar;
4. condição opcional de follow;
5. entrega principal da mensagem e dos links rastreáveis;
6. follow-up opcional, imediato ou temporizado.

Ativar ou desativar uma etapa no mapa altera o mesmo estado React usado no formulário. A API de campanhas, suas validações, o worker, os jobs BullMQ e a integração oficial da Meta permanecem inalterados. Nenhuma ação do mapa ativa, pausa ou envia mensagens por conta própria.

O campo `Automation.flowDefinition` guarda somente o contrato visual V1:

- seis identificadores canônicos, sem nós arbitrários;
- cinco arestas canônicas, reconstruídas no servidor;
- coordenadas inteiras limitadas ao canvas;
- `schemaVersion: 1` para evolução explícita do formato.

`Automation.flowRevision` implementa concorrência otimista. A rota privada `GET /api/automations/:id/flow` entrega o layout compartilhado; `PATCH` aceita somente a revisão lida e as posições válidas. Se outra pessoa salvar primeiro, a API responde `409`, devolve a versão vencedora e a interface a carrega sem sobrescrever trabalho remoto. Todas as consultas e atualizações repetem o `workspaceId`.

O botão **Salvar organização** persiste somente o desenho compartilhado. Alterações de conteúdo continuam no botão **Salvar alterações**, deixando explícitas as duas operações e evitando que mover um cartão ative ou modifique mensagens acidentalmente.

## Estados e validação

Cada cartão possui um dos estados:

- **Pronta**: a etapa está ativa e tem os campos mínimos preenchidos;
- **Revisar**: a etapa está ativa, mas falta configuração obrigatória;
- **Opcional**: a etapa está fora do fluxo atual e pode ser adicionada.

O cabeçalho compara etapas ativas e prontas. A projeção é apenas uma orientação antecipada: o salvamento continua usando a validação Zod da API como autoridade final. O botão **Editar conteúdo** abre o modo detalhado e posiciona a tela no grupo correspondente.

## Acessibilidade e responsividade

- os modos são expostos como abas com `aria-selected`;
- cartões do mapa são botões reais, selecionáveis por teclado;
- cor, texto e formato distinguem estados, sem depender somente de cor;
- a área de inspeção anuncia mudanças e mantém ações com rótulos completos;
- cada etapa pode ser arrastada por um puxador ou movida em passos de 20 px por botões com rótulos acessíveis;
- o canvas preserva a sequência por rolagem horizontal em telas menores, enquanto a edição detalhada continua responsiva.

## Permissões e auditoria

Integrantes podem consultar o mapa. Somente proprietários e administradores recebem permissão para persistir sua organização. Cada salvamento cria `AUTOMATION_FLOW_LAYOUT_UPDATED` na trilha da empresa, contendo versão, revisão e quantidade de nós — nunca textos de mensagens, links ou dados de contatos.

## Limites intencionais

Esta entrega visualiza e edita as capacidades já suportadas em produção e persiste a posição dos cartões. Ela ainda não permite criar nós arbitrários, montar loops ou adicionar condições diferentes da verificação de follow. A expansão precisa primeiro de uma compilação determinística para os campos executados pelo worker; até lá, o JSON visual não participa da execução.

## Implantação e rollback

A migration `20260910100000_add_versioned_flow_layout` adiciona duas colunas e duas restrições `CHECK`, sem reescrever campanhas existentes. Registros legados continuam com `flowDefinition = NULL`, recebem o layout padrão em leitura e iniciam em `flowRevision = 0`. O teste `npm run test:flow-layout-db` aplica as 34 migrations em um schema PostgreSQL descartável e confirma tipos, default e constraints.

Na implantação, execute a migration antes de publicar a interface. O worker pode permanecer na versão atual porque não lê os novos campos. Para rollback imediato, publique a aplicação anterior e mantenha as colunas aditivas; campanhas continuam funcionando pelos campos escalares. Se a remoção física for necessária depois, exporte os layouts e, somente após confirmar que nenhuma versão publicada os usa, remova primeiro as constraints e depois `flowDefinition` e `flowRevision` em uma migration reversa separada.

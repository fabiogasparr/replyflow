# Construtor visual de fluxos

O construtor de campanhas oferece dois modos sobre a mesma configuração: **Mapa do fluxo** e **Conteúdo e prévia**. O mapa torna visível a jornada executada pela automação; o formulário continua responsável pelos textos, publicação, palavras-chave, links e simulação do Instagram.

## Contrato desta fundação

O mapa não cria um segundo motor nem persiste uma cópia da campanha. `buildAutomationFlow` projeta, em memória, os campos existentes da entidade `Automation` nas seguintes etapas:

1. entrada por comentário e, quando habilitada, mensagem recebida;
2. ramo opcional de resposta pública no post;
3. DM inicial opcional com botão para continuar;
4. condição opcional de follow;
5. entrega principal da mensagem e dos links rastreáveis;
6. follow-up opcional, imediato ou temporizado.

Ativar ou desativar uma etapa no mapa altera o mesmo estado React usado no formulário. A API, as validações, o worker, os jobs BullMQ e a integração oficial da Meta permanecem inalterados. Nenhuma ação do mapa salva, ativa, pausa ou envia mensagens por conta própria.

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
- o canvas preserva a sequência por rolagem horizontal em telas menores, enquanto a edição detalhada continua responsiva.

## Limites intencionais

Esta entrega visualiza e edita as capacidades já suportadas em produção. Ela ainda não permite criar nós arbitrários, reposicionar cartões, montar loops ou adicionar condições diferentes da verificação de follow. Esses recursos exigem um contrato de fluxo versionado, compilação determinística para jobs e migração conservadora das campanhas existentes antes de chegar ao worker.

## Implantação e rollback

Não há migration nem alteração de contrato da API. A implantação pode publicar somente a aplicação web; o worker atual permanece compatível.

Para rollback, publique a versão anterior da aplicação. Campanhas criadas ou editadas pelo mapa usam os mesmos campos anteriores e continuam funcionando normalmente. Nenhum dado precisa ser convertido ou removido.

# Privacidade de contatos

O perfil de contato oferece dois controles administrativos: exportar uma cópia estruturada dos dados e anonimizar os dados pessoais mantidos pelo ReplyFlow. Esta implementação é uma proteção técnica do produto; a empresa controladora continua responsável por validar a identidade do titular, a base legal, os prazos e eventuais hipóteses de retenção com orientação jurídica.

## Autorizações e confirmação

- Proprietários e administradores podem exportar um arquivo JSON.
- Somente o proprietário do workspace pode executar a anonimização.
- A rota sempre repete os limites de `workspaceId`, conta do Instagram e automação; um identificador de outro workspace resulta em `404`.
- A anonimização exige a versão atual do contato e uma confirmação nominal exibida na interface. Concorrência resulta em `409` e nenhuma alteração parcial é confirmada.
- Exportação e anonimização entram na trilha de auditoria. A auditoria guarda somente IDs internos e contagens, nunca nome, comentário, anotação ou identificador externo.

## Conteúdo da exportação

O JSON inclui o perfil, etiquetas, anotações, conta associada, estado local das conversas, interações processadas por automações e os registros de deduplicação atribuíveis a essas interações. Tokens de acesso, erros internos e credenciais nunca são selecionados. O arquivo é entregue com `Cache-Control: private, no-store` e nome derivado apenas do ID interno saneado.

O ReplyFlow não possui o histórico completo das mensagens: os corpos completos continuam na Meta. Cliques também não aparecem na exportação individual porque o modelo atual mantém métricas de clique sem uma identidade técnica do destinatário.

## Efeito da anonimização

A transação:

1. valida escopo, versão e confirmação;
2. troca a identidade externa dos logs por um tombstone aleatório `deleted:`;
3. remove nome, texto do comentário, palavra-chave, erros e identificadores de origem;
4. remove envelopes brutos de webhook do workspace que contenham exatamente a identidade externa;
5. exclui o perfil; as conversas locais, notas e prévias são removidas por cascata;
6. registra apenas as quantidades afetadas na auditoria.

Como a Meta pode agrupar várias mudanças no mesmo envelope, a remoção de um webhook bruto pode eliminar também mudanças técnicas recebidas no mesmo lote. Os `DmLog` já processados permanecem com datas e resultados agregáveis, reduzindo o impacto dessa minimização.

Datas, campanha, tipo de gatilho, resultado, tentativas e IDs técnicos de comentário permanecem para métricas agregadas, prevenção de reenvio e integridade operacional. Manter o ID de deduplicação impede que um job antigo da fila trate o mesmo evento como novo e recrie o contato; ele não é exibido no CRM após a remoção e deve fazer parte da política de retenção do controlador. A ação não apaga conteúdo mantido pela Meta nem substitui o atendimento formal de uma solicitação do titular.

## Migration e implantação

`20260911100000_protect_anonymized_contacts` substitui somente a função do gatilho de contatos. Registros cujo `commenterId` começa com `deleted:` deixam de gerar uma projeção `Contact`. Não há reescrita de dados existentes.

Implante a migration junto com a rota de privacidade. O teste `npm run test:contact-privacy-db` aplica todas as migrations reais em um schema PostgreSQL descartável e valida uma identidade normal e duas trajetórias de tombstone.

## Rollback

Desative primeiro a interface e a rota de anonimização. Depois publique uma migration compensatória restaurando a definição anterior de `sync_contact_from_dm_log`; migrations já aplicadas não devem ser removidas nem editadas. Dados já anonimizados não podem ser reconstruídos pela aplicação e devem continuar anonimizados.

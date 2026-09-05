# Conversas e atendimento em equipe

O inbox do ReplyFlow consulta mensagens e conversas pela API oficial do Instagram e acrescenta uma camada operacional persistida no PostgreSQL. A equipe pode classificar, atribuir e anotar um atendimento sem alterar o estado da caixa de entrada nativa do Instagram.

## Dados armazenados

A tabela `Conversation` guarda:

- identificadores do workspace, conta, contato e conversa da Meta;
- status (`OPEN`, `PENDING` ou `RESOLVED`);
- prioridade normal ou alta;
- integrante responsável;
- anotações internas e versão de concorrência;
- prévia e data da mensagem mais recente;
- data da última mensagem recebida e da última sincronização.

O histórico completo continua sendo consultado na Meta. O banco local armazena apenas a prévia mais recente e os dados operacionais necessários para coordenar a equipe. A trilha de auditoria registra os campos alterados e o envio, mas nunca o texto da mensagem ou das anotações.

## Isolamento e concorrência

A conversa possui chaves estrangeiras compostas para workspace + conta + contato. O responsável também é validado por workspace na aplicação e por chave composta no PostgreSQL. Ao remover um integrante, a aplicação desatribui e versiona suas conversas antes de remover a participação.

Cada alteração manual envia `version`. Se outra pessoa já modificou o atendimento, a API responde `409` e a interface recarrega o estado mais recente. A sincronização periódica modifica somente dados derivados da Meta; ela não sobrescreve status, prioridade, responsável, notas ou versão.

Os caches do navegador incluem o ID da conta do Instagram. Assim, nem mensagens nem prévias são reaproveitadas ao trocar de conta.

## Janela de mensagens

A tela estima a janela padrão de 24 horas usando a mensagem recebida mais recente. O aviso é informativo: a decisão final continua sendo da Meta, e qualquer recusa da API é exibida ao operador. Isso evita tratar uma estimativa local como autorização definitiva para enviar.

A documentação oficial da Meta exige que o destinatário tenha iniciado a conversa com a conta profissional antes do envio: [Send API — Instagram Platform](https://www.postman.com/meta/instagram/folder/uxudqu0/send-api).

## Falhas depois de um envio

O envio à Meta acontece antes da atualização local. Se a Meta confirmar a mensagem, mas a gravação de estado/auditoria falhar, a API ainda responde sucesso e registra o erro no servidor. Retornar falha nesse ponto induziria o operador a repetir a ação e poderia duplicar a mensagem. A próxima sincronização repara a prévia local.

## Implantação e rollback

Execute `npm run db:migrate`. A migration `20260905020000_add_conversation_state` adiciona apenas estruturas novas e índices compostos; não modifica mensagens na Meta.

Valide com `npm run test:conversations-db`. O teste aplica todas as migrations em um schema local descartável e prova isolamento de conta, contato e responsável.

Para rollback, publique primeiro a versão anterior da aplicação. Preserve ou exporte as anotações e atribuições, remova referências da aplicação e somente depois use uma migration compensatória para excluir `Conversation`, seus índices e os enums. A operação não afeta as conversas originais do Instagram.


# Seguidores × não seguidores

O que a API oficial permite saber sobre a relação de uma pessoa com a conta é
o par `is_user_follow_business` / `is_business_follow_user`, disponível no
perfil de quem já abriu uma conversa (comentário, DM, story, link ig.me).
Não existe lista de seguidores, lista de quem curtiu nem "quem visitou o
perfil" — e não existe DM fria para quem não interagiu. Tudo aqui parte de uma
interação da própria pessoa.

## O que foi adicionado

| Recurso | Onde | Comportamento |
| --- | --- | --- |
| Status no contato | `Contact.followsAccount`, `followedByAccount`, `followStatusCheckedAt` | Toda verificação feita pelo worker (gate de follow, mensagem por público, toque no botão, recheck) grava o resultado no contato — `lib/audience/follow-status.ts`. |
| Segmento em Contatos | filtro "Relação com o perfil" (`follow=FOLLOWERS`, `NON_FOLLOWERS`, `UNKNOWN`) | Lista e chips respeitam o filtro; a lista mostra a etiqueta "Segue"/"Não segue". |
| Mensagem por público | `Automation.audienceDmEnabled`, `followerDmMessage`, `nonFollowerDmMessage` | A DM com o link usa o texto do público certo (spintax vale). Campo vazio ou relação não verificada → DM padrão. Vale para comentário, DM por palavra-chave e toque no botão. |
| Recheck automático do follow | `lib/audience/follow-recheck.ts` (`FOLLOW_RECHECK_MINUTES`, padrão `10,60`) | Depois do pedido "siga o perfil", dois jobs `process-postback` com `autoRecheck: true` verificam sozinhos; se a pessoa passou a seguir, o link é entregue sem novo toque. Se não segue ou não dá pra verificar, silêncio (nada de FAILED). Se a janela de mensagens fechou, a Meta recusa e o job apenas registra. |

## Observações de política

- O recheck só entrega com `is_user_follow_business = true` confirmado; "desconhecido" não libera o link sem a pessoa pedir de novo.
- A verificação é uma leitura da API, contada nos limites normais; por isso ela só acontece quando a campanha precisa (gate de follow, público ou toque).

## Testes

- `__tests__/audience-follow.test.ts` — gravação no contato, escolha do texto por público, agenda dos rechecks.
- `__tests__/postback-handler.test.ts` — recheck entrega só com follow confirmado, ignora quando já enviado, texto por público no toque.
- `__tests__/comment-handler.test.ts`, `__tests__/message-handler.test.ts` — rechecks agendados após o pedido de follow; texto de não seguidor.
- `__tests__/contact-segments.test.ts` — SQL do segmento.

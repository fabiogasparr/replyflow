# Gatilhos além do comentário: Stories, link ig.me, ice breakers e lives

Todos usam apenas os webhooks e endpoints oficiais da API do Instagram com
Login do Instagram. Nenhum deles envia DM "fria": em cada caso é a pessoa que
abre a conversa (respondendo a um story, mencionando o perfil, tocando em um
link ou em uma pergunta inicial), o que mantém a janela de mensagens da Meta
aberta e o envio dentro das políticas.

| Gatilho | Campo da campanha | Webhook | Como dispara |
| --- | --- | --- | --- |
| Resposta a um story | `storyTriggerEnabled` | `messages` com `message.reply_to.story` | Palavra-chave no texto da resposta (ou "qualquer palavra"). Campanhas com gatilho por DM também aceitam. |
| Menção em um story | `storyTriggerEnabled` | `messages` com `attachments[].type = "story_mention"` | Sempre dispara (não há texto para casar). |
| Link ig.me | `referralTriggerEnabled` + `referralCode` | `messaging_referral` (`referral.ref`) ou `message.referral.ref` | Dispara a campanha dona do código. Link: `https://ig.me/m/<usuário>?ref=<código>`, gerado ao salvar e nunca alterado depois. |
| Pergunta inicial (ice breaker) | `iceBreakerQuestion` | `messaging_postbacks` com payload `campaign:<id>` | Dispara a campanha ao tocar. Até 4 por conta; sincronizado em `me/messenger_profile` a cada salvar/ativar/excluir. |
| Comentário em live | — | `live_comments` | Tratado como comentário comum; campanhas "qualquer post" cobrem lives. |

## Fluxo no worker

`parseInteractionEvents` (lib/meta/webhook.ts) transforma esses eventos em
jobs `process-message` com `kind` (`story_reply`, `story_mention`,
`referral`, `ice_breaker`). O handler de mensagens escolhe as campanhas
elegíveis pelo `kind`, dispensa a palavra-chave quando o gatilho não tem texto
e grava o `DmLog` com `triggerType` `STORY`, `REFERRAL` ou `ICE_BREAKER`
(reprocessáveis como os demais). Atraso humano, variações, teto por hora,
triagem por IA e gate de follow valem igualmente.

`subscribeInstagramAccountToWebhooks` passou a assinar `live_comments` além
de `comments` e `messages`; as contas já conectadas precisam apenas de um
novo "conectar" para renovar a assinatura (ou seguem recebendo só os campos
antigos até lá).

## Testes

- `__tests__/interaction-triggers.test.ts` — parsers, link ig.me, reprocessamento, sincronização dos ice breakers.
- `__tests__/message-handler.test.ts` — elegibilidade por tipo de gatilho.

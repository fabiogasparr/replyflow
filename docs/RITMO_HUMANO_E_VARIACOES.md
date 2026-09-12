# Ritmo humano e variações de mensagem

Respostas idênticas, disparadas no mesmo segundo em que o comentário aparece,
são o padrão que o Instagram associa a automação e que leva a restrições na
conta. Este módulo faz o ReplyFlow se comportar como uma pessoa respondendo,
sem sair das APIs oficiais da Meta.

## O que existe

| Recurso | Onde | Comportamento |
| --- | --- | --- |
| Variações da resposta pública | `Automation.publicReplyMessages` | Até 10 textos; um é sorteado a cada envio, nunca o mesmo duas vezes seguidas na mesma campanha. |
| Variações da DM com o link | `Automation.dmMessages` (+ `dmMessage`) | Até 10 textos no total; mesma rotação. Vale para DM por comentário, por palavra-chave na DM e por toque no botão. |
| Spintax | Qualquer mensagem | `{oi|olá|e aí}` vira uma das opções a cada envio. Grupos podem ser aninhados. `{username}` e `{link}` continuam sendo placeholders. |
| Atraso humano | `Automation.humanDelayMinSeconds` / `humanDelayMaxSeconds` | Antes de responder a um comentário ou a uma DM com palavra-chave, a campanha espera um tempo sorteado no intervalo (máximo 15 min). Campanhas novas nascem com 20–90 s. |
| Espaçamento por conta | `SEND_MIN_GAP_MS` (padrão 3000) | Envios da mesma conta do Instagram saem com pelo menos esse intervalo entre si, mesmo com vários workers. Contas diferentes não se bloqueiam. |
| Teto por hora em todas as trilhas | `reserveDMSlot` | O limite de 750 respostas privadas/hora por conta agora vale também para DM por palavra-chave, toque no botão e follow-up, não só para comentários. |
| Erros 613 e 32 da Meta | `lib/meta/client.ts` | Tratados como `RateLimitError`, com a mesma espera dos erros 4/17/368. |

## Como funciona o atraso humano

1. O webhook (ou a varredura) enfileira o comentário como sempre.
2. O worker encontra a campanha, cria a linha em **Histórico de envios** como
   *Pendente* e reenfileira o trabalho só daquela campanha com `delay`
   sorteado (`jobId` determinístico: `comment_<conta>_<comentário>_<campanha>_delayed`).
3. Quando o job atrasado roda, `humanDelayApplied` impede uma nova espera e o
   fluxo segue normalmente: resposta pública → DM (ou DM inicial / pedido de
   follow).

Reprocessamentos manuais (`automationId` definido) e jobs já atrasados nunca
esperam de novo.

## Onde a escolha do texto acontece

`lib/messaging/variation.ts` tem as funções puras (spintax, sorteio sem repetir).
`lib/messaging/pacing.ts` guarda no Redis o índice da última variação usada por
campanha e tipo de mensagem (`variant:last:<campanha>:<tipo>`, 7 dias) e o cursor
de próximo envio por conta (`send:next:<conta>`). Sem Redis, tudo degrada para
"sorteia e envia" — nunca bloqueia um envio.

## Testes

- `__tests__/message-variation.test.ts` — spintax, rotação, atraso, espaçamento.
- `__tests__/comment-handler.test.ts` — job atrasado, variações e spintax na DM e na resposta pública.
- `__tests__/message-handler.test.ts` — teto por hora e atraso na DM por palavra-chave.
- `__tests__/meta-client-errors.test.ts` — mapeamento dos códigos de erro da Meta.

## Rollback

Desligar o atraso em uma campanha zera `humanDelayMaxSeconds`; `SEND_MIN_GAP_MS=0`
desliga o espaçamento. As colunas novas têm valor padrão e a migration não
altera dados existentes.

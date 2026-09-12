# Inteligência artificial nas campanhas

A IA entra em três pontos, sempre opcionais e sempre com o texto escrito pela
marca como plano B. Nada de IA é obrigatório para a campanha funcionar.

## Provedor

Qualquer endpoint compatível com a API de chat da OpenAI. Em produção o
ReplyFlow aponta para o gateway OmniRoute, que roteia entre provedores com uma
única chave.

| Variável | Uso |
| --- | --- |
| `AI_BASE_URL` | Base do endpoint, ex.: `https://omniroute.kz3solucoes.cloud/v1` |
| `AI_API_KEY` | Chave do gateway (colada direto no Coolify) |
| `AI_MODEL` | Modelo principal |
| `AI_FALLBACK_MODEL` | Modelo de reserva, usado quando o principal falha, estoura cota ou responde vazio |
| `AI_TIMEOUT_MS` | Tempo máximo por chamada (padrão 20 s) |

Vazias, todas as funções abaixo ficam desligadas: `/api/ai/status` responde
`configured: false`, o builder avisa e o worker usa só os modelos de texto.

## Funções

### 1. Variações geradas (`POST /api/ai/variations`)

Botão **✨ Gerar variações com IA** ao lado da lista de respostas públicas e
das variações da DM. Gera até 4 por vez, preserva `{username}` e `{link}`,
descarta repetições e exige revisão antes de salvar.

### 2. Resposta personalizada (`Automation.aiPublicReplyEnabled` / `aiDmEnabled`)

O worker lê o comentário e escreve a resposta pública (curta, sem link) e/ou a
DM (com `{link}` garantido quando a campanha entrega um link), seguindo as
**instruções para a IA** da campanha (`aiInstructions`: quem é a marca, tom,
o que não pode prometer). O texto gerado fica em `DmLog.aiGeneratedReply`.

Quando há DM inicial ou pedido de follow, a personalização vale só para a
resposta pública — a DM com o link sai depois, pelo toque no botão, com o
modelo da campanha.

### 3. Triagem para humano (`Automation.aiModerationEnabled`)

Antes de qualquer resposta, o comentário (ou a DM recebida) é classificado:
`sentiment`, `hostile` (ofensivo, depreciativo, ameaça, spam) e `needsHuman`
(reclamação, reembolso, urgência, ironia agressiva).

| Sensibilidade | Reserva para humano quando |
| --- | --- |
| `HOSTILE` (padrão) | `hostile` ou `needsHuman` |
| `NEGATIVE` | também qualquer `sentiment = NEGATIVE`, mesmo educado |

Reservado = **nenhuma** resposta automática (nem pública, nem DM). O registro
fica em Histórico de envios como **Revisão humana** (`SKIPPED_HUMAN_REVIEW`),
com o motivo em `aiReviewReason`, e um evento operacional `WARNING` aparece na
linha do tempo. Quem pode reprocessar libera o envio em **Reprocessar** — o job
volta com `approvedByOperator: true` e a triagem não roda de novo.

Se o modelo estiver fora do ar, a triagem não bloqueia a campanha: o comentário
segue o fluxo normal (fail-open), e a falha fica no log do worker.

### Teste no builder (`POST /api/ai/preview`)

Campo "Testar com um comentário de exemplo": mostra a triagem e os textos que
a IA escreveria, sem enviar nem gravar nada.

## Guardrails em código (não dependem do prompt)

- placeholders `{username}`/`{link}` preservados; DM com link sempre termina com `{link}`;
- resposta pública descartada se vier com URL; limites de 280 (pública), 600 (DM) e 1000 (variação) caracteres;
- `temperature 0` na triagem; JSON tolerante a cercas de código;
- toda função devolve `null` em erro → o worker usa o modelo da campanha.

## Testes

- `__tests__/ai-comment-intelligence.test.ts` — cliente (fallback de modelo), triagem, personalização, variações.
- `__tests__/comment-handler.test.ts` — comentário reservado, liberação por operador, uso do texto da IA e fallback.
- `__tests__/dm-retry.test.ts` — `SKIPPED_HUMAN_REVIEW` é reprocessável.

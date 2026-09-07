# Modularização do worker de mensagens

O worker continua consumindo a fila `dm-processing` e os mesmos quatro tipos de job. Esta etapa inicia a decomposição interna sem alterar payloads, tentativas, idempotência, migrations ou chamadas oficiais da Meta.

## Módulos extraídos

### Entrega compartilhada

`lib/queue/delivery.ts` concentra regras usadas por mais de um gatilho:

- formatação segura dos erros da Meta;
- classificação de rejeições de template que aceitam fallback;
- montagem de até três botões com links rastreados;
- preservação dos links secundários no fallback em texto;
- envio da mensagem final para conversas já abertas.

Uma rejeição por token, limite, janela fechada, comentário já respondido ou destinatário inválido nunca é repetida como texto. Essa segunda tentativa não corrigiria a causa e poderia consumir a oportunidade de entrega ou esconder o diagnóstico original.

### Follow-up agendado

`lib/queue/handlers/follow-up.ts` contém o ciclo completo do follow-up: busca da automação ativa, repetição da fronteira da conta externa, abertura do token criptografado, personalização, envio e projeção operacional.

O follow-up permanece **best-effort**. Se a janela da Meta estiver fechada, a falha fica visível no estado e nos logs do worker, mas o job não entra em uma repetição infinita.

### Clique em botão e fallback de leitura

`lib/queue/handlers/postback.ts` contém a entrega iniciada pelo botão da mensagem de abertura e pelo fallback de leitura. O módulo repete a fronteira da conta externa antes de abrir o token, respeita o follow gate, reserva e devolve o uso mensal e agenda o follow-up com uma chave determinística.

O fallback de leitura continua conservador: não repete uma entrega já registrada, não contorna o requisito de seguir a conta e não transforma uma janela de mensagens fechada em falha operacional ou retry inútil. O clique real continua propagando a falha para a política de tentativas da fila.

### Mensagem recebida

`lib/queue/handlers/message.ts` contém o gatilho por DM recebida. A busca nasce limitada à conta externa do evento, aplica as palavras-chave da campanha e usa `dm:<messageId>` como chave de deduplicação. Antes da chamada à Meta, o handler registra `deliveryAttemptedAt`; um resultado ambíguo não é reenviado automaticamente.

O follow gate permanece fechado no primeiro contato: somente a confirmação explícita de que a pessoa segue a conta libera o link. A mensagem de orientação e a entrega final compartilham a mesma reserva do plano, enquanto o follow-up só é agendado depois que o link realmente foi enviado.

### Comentário

`lib/queue/handlers/comment.ts` contém o pipeline de comentários. A seleção considera a mídia do anúncio, a publicação original e campanhas de qualquer publicação, sempre dentro da conta do Instagram presente no evento. O módulo preserva a única resposta privada permitida pela Meta por comentário, sem impedir respostas públicas de campanhas diferentes.

A tentativa de entrega é persistida antes da chamada externa, a reserva mensal é devolvida quando o limite horário impede o envio e o requeue usa uma chave determinística. Respostas públicas continuam independentes da mensagem privada e idempotentes por `publicReplySentAt`.

## Compatibilidade e segurança

- o roteador e a configuração do BullMQ continuam em `lib/queue/dm-worker.ts`;
- nenhum nome ou payload de job mudou;
- nenhuma nova chamada à Meta foi adicionada;
- o worker continua sendo o único processo que efetua esses envios;
- a interface web pode ser implantada antes ou depois deste worker;
- os testes garantem que um `instagramAccountId` diferente interrompe o follow-up antes da abertura do token.
- os testes garantem a mesma fronteira de conta para postbacks e preservam o comportamento integrado do clique, do follow gate, do limite do plano e do fallback de leitura.
- os testes garantem deduplicação por mensagem, interrupção de replays ambíguos, follow gate e projeção de falhas no handler de DMs recebidas.
- os testes garantem seleção por mídia e conta, deduplicação entre campanhas, requeue determinístico e proteção contra replays ambíguos no handler de comentários.

Com os quatro handlers extraídos, `lib/queue/dm-worker.ts` fica responsável apenas por rotear jobs, configurar concorrência e backoff e registrar falhas operacionais do processo.

## Validação e rollback

Execute:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Esta alteração não requer migration. Para rollback, publique o worker do commit anterior. Jobs já existentes permanecem compatíveis e não precisam ser recriados. Não execute duas versões do worker simultaneamente durante a troca se quiser uma fronteira operacional simples para o diagnóstico.

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

## Compatibilidade e segurança

- o roteador e a configuração do BullMQ continuam em `lib/queue/dm-worker.ts`;
- nenhum nome ou payload de job mudou;
- nenhuma nova chamada à Meta foi adicionada;
- o worker continua sendo o único processo que efetua esses envios;
- a interface web pode ser implantada antes ou depois deste worker;
- os testes garantem que um `instagramAccountId` diferente interrompe o follow-up antes da abertura do token.

Os handlers de comentário, postback e mensagem recebida serão extraídos em entregas seguintes, cada um mantendo os testes de regressão do pipeline completo.

## Validação e rollback

Execute:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Esta alteração não requer migration. Para rollback, publique o worker do commit anterior. Jobs já existentes permanecem compatíveis e não precisam ser recriados. Não execute duas versões do worker simultaneamente durante a troca se quiser uma fronteira operacional simples para o diagnóstico.

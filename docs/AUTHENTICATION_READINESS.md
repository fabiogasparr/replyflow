# Prontidão da autenticação por e-mail

O ReplyFlow usa links mágicos do Auth.js. O acesso depende de um remetente válido e de um transporte configurado: Resend por padrão ou SMTP quando `EMAIL_SERVER` está definido.

## Comportamento da interface

A página `/login` faz uma validação sintática no servidor antes de habilitar o formulário. Valores ausentes ou de exemplo, como `re_...`, `re_test`, remetentes em `example.com` e URLs que não usam `smtp://` ou `smtps://`, exibem uma orientação em português e deixam o campo e o botão desabilitados.

A mesma barreira roda novamente dentro da Server Action e imediatamente antes de qualquer entrega. Portanto, uma requisição criada fora da interface também não envia destinatário nem link de autenticação a um provedor configurado com placeholders.

Essa validação não testa credenciais reais e não realiza uma chamada de rede. Uma chave com formato válido ainda pode ser revogada ou pertencer a uma conta sem o domínio do remetente verificado.

## Erros seguros

O Auth.js redireciona erros para `/login/error`. A tela traduz os códigos conhecidos:

- `Configuration`: provedor ausente, inválido ou rejeitado;
- `AccessDenied`: endereço fora da lista permitida;
- `Verification`: link inválido, expirado ou já utilizado;
- qualquer outro valor: orientação genérica para solicitar um novo acesso.

O código recebido na URL nunca é interpolado na página. Tokens, e-mail do destinatário, resposta do provedor e variáveis de ambiente não são exibidos.

## Configuração

Para Resend, defina:

```dotenv
RESEND_API_KEY=re_chave_real
EMAIL_FROM=ReplyFlow <acesso@dominio-verificado.com.br>
```

Para SMTP, defina `EMAIL_SERVER` com URL codificada e mantenha `EMAIL_FROM`. Quando `EMAIL_SERVER` existe, o SMTP tem precedência e `RESEND_API_KEY` não é utilizado.

Depois de alterar o ambiente, reinicie o processo web. Não é necessário reiniciar o worker, pois ele não participa da autenticação.

## Validação e rollback

Execute:

```bash
npm test -- --run __tests__/auth-readiness.test.ts __tests__/auth-email.test.ts
npm run typecheck
npm run lint
npm run build
```

Esta entrega não altera banco ou sessão persistida. Para rollback, publique a versão anterior da aplicação web. O provedor e os links mágicos existentes continuam sob controle do Auth.js.

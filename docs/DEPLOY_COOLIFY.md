# Implantação permanente no Coolify e conexão real com o Instagram

Este é o caminho para qualquer pessoa conectar a própria conta profissional do
Instagram ao ReplyFlow e automatizar os perfis escolhidos. Ele substitui o
túnel temporário da homologação local por uma origem HTTPS estável, que a Meta
exige para callback OAuth, webhooks e App Review.

Origem definida em 12/09/2026: `https://replyflow.kz3solucoes.cloud`, no Coolify
em `coolify.kz3solucoes.cloud` (o domínio `kz3solucoes.cloud` já tem DNS wildcard
apontando para o servidor). Um domínio próprio do produto pode substituir esse
endereço depois; basta trocar o domínio no Coolify e recadastrar as URLs na Meta.

## 1. Stack no Coolify

O arquivo `compose.coolify.yml` descreve o stack completo: PostgreSQL 16, Redis 7,
`web` (Next.js), `worker` (BullMQ) e `cron` (agendador de `/api/cron`). Os três
serviços da aplicação usam a mesma imagem construída pelo `Dockerfile`.

Criação do recurso no Coolify:

1. Projeto → **New Resource** → **Docker Compose** → repositório público
   `https://github.com/fabiogasparr/replyflow`, branch de implantação e
   **Docker Compose Location** = `/compose.coolify.yml`.
2. Ao carregar o compose, o Coolify cria as variáveis `SERVICE_*` (senha do
   banco, `NEXTAUTH_SECRET`, `CRON_SECRET`, `ENCRYPTION_KEY`, `WEBHOOK_VERIFY_TOKEN`)
   com valores aleatórios. Nenhum deles é digitado por pessoas nem versionado.
3. No serviço `web`, definir o domínio `https://replyflow.kz3solucoes.cloud`
   (porta 3000). `NEXTAUTH_URL` é derivada dele por `SERVICE_URL_WEB`.
4. Preencher, na tela de variáveis do Coolify, apenas o responsável pela conta:
   - `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET` (seção 2);
   - `RESEND_API_KEY` **ou** `EMAIL_SERVER` (SMTP em URL, nunca os dois) e `EMAIL_FROM`
     com remetente verificado no provedor;
   - `ALLOWED_EMAILS` com os e-mails autorizados enquanto durar a homologação.
     Vazio libera cadastro público, o que só deve acontecer depois do App Review.
5. **Deploy**. O `web` executa `prisma migrate deploy` e só então inicia o Next.js;
   `worker` e `cron` sobem em seguida. O healthcheck do `web` usa `/api/health`, que
   só responde 200 com banco, Redis, fila e heartbeat do worker; por isso o
   `start_period` é de dois minutos.

Verificação após o deploy: `https://replyflow.kz3solucoes.cloud/api/health` deve
retornar 200; `/api/auth/providers` deve listar o provedor de e-mail; a tela de
login deve enviar um link para um endereço de `ALLOWED_EMAILS`.

Atualizações: cada push na branch configurada dispara um novo build (ou use
**Redeploy**). Migrations rodam automaticamente antes do serviço subir. Para
voltar uma versão, aponte a implantação para o commit anterior e faça redeploy;
volumes `replyflow-postgres` e `replyflow-redis` são preservados. Nunca remova os
volumes sem backup: isso apaga contas conectadas, tokens e histórico.

## 2. Aplicativo na Meta

Criar um app novo e dedicado, chamado **ReplyFlow**, no painel
`developers.facebook.com` (tipo *Business*), com o produto **Instagram** e o caso de
uso *Instagram API with Instagram Login*. A criação, o aceite de termos e a
verificação de negócio são atos do responsável pela conta; a configuração
abaixo pode ser feita por quem administra o app.

Configuração obrigatória:

| Item | Valor |
| --- | --- |
| Redirect URI do Business Login | `https://replyflow.kz3solucoes.cloud/api/instagram/callback` |
| Callback do webhook | `https://replyflow.kz3solucoes.cloud/api/webhook` |
| Token de verificação do webhook | valor de `WEBHOOK_VERIFY_TOKEN` no Coolify (copiar de lá, não digitar) |
| Campos do webhook | `comments`, `messages` (inclui postbacks e leitura, usados pelo worker) |
| URL da política de privacidade | `https://replyflow.kz3solucoes.cloud/privacy` |
| URL dos termos | `https://replyflow.kz3solucoes.cloud/terms` |
| Exclusão de dados do usuário | opção **URL de retorno de chamada** → `https://replyflow.kz3solucoes.cloud/api/meta/data-deletion` (a Meta envia um `signed_request`; o ReplyFlow remove a conexão e responde com o código de confirmação). As instruções para pessoas continuam em `https://replyflow.kz3solucoes.cloud/data-deletion`, que também mostra o status pelo código (`?code=RF-XXXXX-XXXXX`). |
| Permissões | `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`, `instagram_business_manage_insights` |

Segredos a copiar para o Coolify: **Instagram App ID** → `INSTAGRAM_APP_ID`;
**Instagram App Secret** → `INSTAGRAM_APP_SECRET`; **App Secret** do app Meta →
`FACEBOOK_APP_SECRET`. O último assina os webhooks (`x-hub-signature-256`); se
ele pertencer a outro app, o ReplyFlow registra "Webhook signature verification
failed" nos eventos operacionais e descarta o evento.

Depois de salvar os segredos, faça **Restart** do stack no Coolify e só então
confirme o webhook na Meta: a verificação (`GET /api/webhook` com `hub.challenge`)
precisa do token já carregado no processo `web`.

## 3. Quem consegue conectar em cada fase

| Fase | Quem conecta | O que a Meta exige |
| --- | --- | --- |
| Desenvolvimento (agora) | Contas profissionais adicionadas como **Instagram Testers** no app, que aceitam o convite em *Configurações → Apps e sites → Convites de testador* | Acesso padrão (Standard Access); sem revisão |
| Publicado com acesso avançado | Qualquer conta profissional Business ou Creator | **Business Verification** da KZ3 e **App Review** aprovado para as quatro permissões |

O produto já trata os dois estados: contas sem autorização válida aparecem no
wizard de conexão com pedido de nova autorização, e o limite de contas por plano
continua aplicado no servidor. Não presumir aprovação pela presença das variáveis.

## 4. Roteiro de validação antes do App Review

1. Login por e-mail no domínio permanente; conferir cookie de sessão seguro.
2. Conectar uma conta de teste pelo wizard (`/api/instagram/onboarding`), retornar
   ao mesmo workspace e ver a conta persistida.
3. Confirmar no painel da Meta que o webhook está assinado e que os campos
   `comments` e `messages` estão ativos.
4. Criar uma campanha com palavra-chave em uma publicação real da conta de teste.
5. Com uma segunda conta de teste, comentar a palavra-chave; conferir recebimento
   do evento, processamento no worker, resposta pública e DM entregue; ver o log
   `SENT` em Histórico.
6. Repetir com um segundo workspace e uma segunda conta: eventos, contatos e
   conversas devem ficar no workspace correto.
7. Gravar essa sequência para o screencast (roteiro em `META_APP_REVIEW.md`).

## 5. App Review e verificação de negócio

Pré-requisitos no painel: ícone 1024×1024, categoria, e-mail comercial, URLs de
privacidade/termos/exclusão acessíveis sem login, ao menos uma chamada bem-sucedida
com cada permissão (a validação acima gera isso), Business Verification com
documento da KZ3 Consultoria em Tecnologia Ltda e instruções de teste para o
revisor: um e-mail autorizado em `ALLOWED_EMAILS` e uma conta profissional de teste
já convidada. As justificativas por permissão e o roteiro do vídeo estão em
`META_APP_REVIEW.md`. Só depois da aprovação `ALLOWED_EMAILS` deve ficar vazio.

## Impacto e rollback

Esta entrega adiciona `compose.coolify.yml`, este documento e um teste estrutural
do manifesto; não altera código de aplicação, schema, OAuth ou webhooks. A
homologação local (`compose.staging.yml`) continua funcionando de forma
independente. Para reverter, remova o recurso no Coolify (preservando volumes, se
houver dados a manter) e reverta o commit; nenhum segredo precisa ser rotacionado,
pois nenhum foi escrito no repositório.

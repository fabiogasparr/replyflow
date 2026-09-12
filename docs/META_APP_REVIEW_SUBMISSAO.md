# App Review da Meta — textos prontos para a submissão do ReplyFlow

Estado em 12/09/2026. App "ReplyFlow" (ID 1110239034871314), caso de uso
*API do Instagram com login do Instagram*, app publicado, portfólio
empresarial verificado. Este arquivo reúne tudo o que se cola no painel
da Meta ao pedir **Acesso Avançado** para as quatro permissões.

## Pré-requisitos no painel (checklist)

| Item | Estado |
| --- | --- |
| Ícone 1024×1024 | enviado (`public/app-icon-1024.png`) |
| Política de privacidade / termos | `/privacy`, `/terms` |
| Exclusão de dados | callback `/api/meta/data-deletion` (a Meta recusou a URL de instruções porque o robô dela recebe 403 do host; ver "Pendência de infraestrutura") |
| Categoria | Negócio e Páginas |
| E-mail de contato | fabio.gasparr@gmail.com — **a Meta ainda marca como não verificado**; confirmar pelo e-mail de verificação que ela envia |
| Tech Provider (Provedor de Tecnologia) | **obrigatório** para adicionar permissões à análise; decisão irreversível, passa por verificação de acesso |
| Chamadas de API bem-sucedidas em cada permissão (últimos 15 dias) | feitas em 12/09 com @fabio.gasparr / @kz3solucoes; repetir o fluxo na véspera da submissão |
| Contas de teste para o revisor | login por e-mail: `contato@estudioonze.com.br` (já liberado em `ALLOWED_EMAILS`); conta profissional do Instagram de teste: informar como Instagram Tester no app |

## Permissões a pedir (exatamente as usadas pelo OAuth em `lib/meta/oauth.ts`)

`instagram_business_basic`, `instagram_business_manage_comments`,
`instagram_business_manage_messages`, `instagram_business_manage_insights`.
Não pedir `instagram_manage_comments` (variante do login pelo Facebook,
não usada).

## Justificativas (inglês, como a Meta pede)

**instagram_business_basic**

> ReplyFlow is a comment-to-DM automation tool for Instagram professional accounts. After a business authorizes the app through Instagram Business Login, we call `GET /me?fields=id,username,name,profile_picture_url` to identify the connected professional account, show it in the workspace settings and attach every campaign to the right account. We also read the account's own media (`GET /me/media`) so the business can pick which post or reel a campaign applies to. We never read data of other accounts and never scrape Instagram.

**instagram_business_manage_comments**

> When someone comments a keyword the business configured (for example "LINK") on the business's own post, reel or live, we receive the comment through the `comments` / `live_comments` webhook and, if the business enabled it, publish a short public reply under that comment with `POST /{comment-id}/replies`. We also poll `GET /{media-id}/comments` as a fallback when a webhook is missed. Comments are only read and answered on media owned by the connected account, and only for campaigns the business created.

**instagram_business_manage_messages**

> After a matching comment, we send that person a single private reply with the content the business configured (a link, a coupon, an answer) using `POST /{ig-user-id}/messages` with the `comment_id` recipient (private reply) or, when the person taps a button or writes to the account first, the standard messaging endpoint within the 24-hour window. We also use `messaging_postbacks`, `messaging_referral` (ig.me links), story replies/mentions and the ice-breaker profile (`me/messenger_profile`) so the business can start conversations from the entry points Instagram offers. Each comment gets at most one private reply, sends are rate-limited per account with a human-like delay, and negative or hostile comments can be held for a human instead of answered automatically.

**instagram_business_manage_insights**

> The Performance report shows the business how its automated campaigns perform: we read media insights (`GET /{media-id}/insights`: reach, likes, comments, saves, shares) and the follower count series (`GET /me/insights?metric=follower_count`) of the connected account only, and compare them with the DMs the app sent. This is the only use of the permission; no insights of other accounts are read.

## Instruções para o revisor (colar em "Instructions" da submissão)

> 1. Open https://replyflow.kz3solucoes.cloud/login and sign in with the e-mail **contato@estudioonze.com.br** (magic link — the message arrives in that inbox; the reviewer inbox is forwarded to us, tell us if you prefer a different address).
> 2. In *Configurações → Instagram*, click **Conectar Instagram** and authorize with the test professional account **@<conta_de_teste>** (it has the Instagram Tester role on the app).
> 3. In *Campanhas*, open the campaign **"Teste ReplyFlow"** (keyword `TESTE`) or create a new one on any post of the connected account.
> 4. From another Instagram account, comment `TESTE` on that post.
> 5. Within about a minute the app posts a public reply under the comment (instagram_business_manage_comments) and sends a private reply with a button/link to the commenter (instagram_business_manage_messages). The *Registros* page shows the delivery as SENT.
> 6. Open *Relatórios → Desempenho* to see reach/likes/comments of the post and the follower series next to the DMs sent (instagram_business_manage_insights). The account name and picture in Settings come from instagram_business_basic.
> The interface is in Brazilian Portuguese; every screen has the same layout as the screencast.

## Roteiro do screencast (2–3 min, gravar no app publicado)

1. Login por link mágico → painel.
2. Configurações → Conectar Instagram → tela de consentimento da Meta mostrando as 4 permissões → conta conectada aparece com nome e foto.
3. Campanhas → nova campanha em um post recente, palavra-chave, resposta pública, DM com link → salvar.
4. No celular, com outra conta, comentar a palavra-chave.
5. Mostrar a resposta pública sob o comentário e a DM recebida (com botão).
6. Registros com a linha SENT; Relatórios → Desempenho com alcance/curtidas e seguidores.
7. Configurações → Desconectar Instagram (mostra que o usuário controla a conexão).

## Pendência de infraestrutura (não bloqueia a submissão, mas convém resolver)

O robô da Meta (`facebookexternalhit`) recebe **HTTP 403 com corpo vazio** ao
buscar qualquer URL de `*.kz3solucoes.cloud` (ReplyFlow e Coolify), enquanto
navegadores, curl no próprio servidor (IPv4 e IPv6, com o mesmo User-Agent)
e os webhooks da Meta funcionam. O servidor tem AAAA (`2a02:4780:75:db3e::1`)
e o robô chega por IPv6; o tcpdump mostra a conexão TLS completa chegando ao
Traefik. Para fechar o diagnóstico é preciso ligar o access log do Traefik
(`--accesslog=true` no `docker-compose.yml` do proxy no Coolify, "Proxy →
Configuration") e repetir o teste no Depurador de Compartilhamento
(`developers.facebook.com/tools/debug`). Enquanto isso o campo de exclusão de
dados usa o **callback**, que a Meta aceitou.

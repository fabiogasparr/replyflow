# Homologação do ReplyFlow e conexão com o Instagram

Este ambiente usa uma instalação limpa e independente da prévia Casa Aurora.
O banco é `replyflow_staging`; PostgreSQL e Redis não publicam portas no host.
Web, worker e agendador usam a mesma imagem e as mesmas chaves de criptografia.

## Inicialização

```sh
node scripts/staging.mjs init
node scripts/staging.mjs preflight && docker-compose --env-file .env.staging -f compose.staging.yml build migrate
docker-compose --env-file .env.staging -f compose.staging.yml up -d --no-build
node scripts/staging.mjs check
```

Também é possível usar `docker compose` em máquinas com o plugin instalado.
O comando `init` gera segredos aleatórios em `.env.staging`, com permissão 0600,
e se recusa a substituir um arquivo existente. Nenhum segredo é copiado para
a imagem Docker ou versionado. As migrations executam antes da aplicação.
O pré-teste exige ao menos 6 GiB livres para evitar esgotar o disco durante a
construção; reserve mais espaço conforme o crescimento do banco e dos logs.
O serviço `migrate` é o único responsável por construir a imagem compartilhada;
web, worker e cron a reutilizam para evitar construções concorrentes da mesma tag.

Aplicação local: `http://localhost:3100`. Captura dos e-mails de acesso:
`http://localhost:8026`. Apenas `tester@replyflow.test` e
`tenant2@replyflow.test` estão liberados inicialmente. Solicite o acesso na tela
de login e abra o link recebido no Mailpit. Esses e-mails não saem pela internet.
O login real continua obrigatório; não existe sessão administrativa pública.
Cada usuário novo recebe seu workspace, assinatura Free e permissões próprias.

## Endereço HTTPS temporário

```sh
docker-compose --env-file .env.staging -f compose.staging.yml --profile public up -d tunnel
docker-compose --env-file .env.staging -f compose.staging.yml logs tunnel
node scripts/staging.mjs url https://ENDERECO.trycloudflare.com
docker-compose --env-file .env.staging -f compose.staging.yml up -d --no-deps web worker cron
```

Use exatamente a origem impressa pelo túnel. O script aceita somente endereços
HTTPS `trycloudflare.com`. O túnel publica apenas a aplicação web; Mailpit,
PostgreSQL e Redis não ficam acessíveis por ele. O endereço depende do processo
do túnel e muda quando ele é recriado; o computador e o Docker precisam ficar
ligados. O recurso não tem garantia de disponibilidade e é apenas para testes.

Uma mudança do endereço exige atualizar `NEXTAUTH_URL`, recriar web/worker/cron
e cadastrar novamente callback OAuth e webhook na Meta. Para App Review e
operação comercial, use uma origem HTTPS estável em um servidor permanente.

### Recuperar um endereço temporário indisponível

Em 12/09/2026, o túnel antigo deixou de resolver no DNS e passou a registrar
`Unauthorized: Tunnel not found`, embora web, banco, Redis e worker estivessem saudáveis.
Nesse caso, reiniciar a aplicação ou apagar seus volumes não corrige o registro do túnel.

1. Consulte `docker-compose --env-file .env.staging -f compose.staging.yml ps`,
   `/api/health` em `http://localhost:3100` e os logs do serviço `tunnel`.
2. Se essa falha de registro for confirmada, execute `restart tunnel` no mesmo compose.
   Aguarde o novo endereço e a mensagem `Registered tunnel connection` nos logs.
3. Configure a nova origem com `node scripts/staging.mjs url https://ENDERECO.trycloudflare.com`.
4. Aplique com `docker-compose --env-file .env.staging -f compose.staging.yml up -d --no-deps --no-build web worker cron`.
5. Verifique saúde, login e `/api/auth/providers` pelo novo HTTPS. Solicite um novo
   link de acesso, pois e-mails anteriores podem apontar para o endereço antigo.
   Caso a Meta já esteja configurada, atualize também callback e webhook no painel.

Essa recuperação mantém bancos, volumes e segredos. Não representa garantia de
disponibilidade do endereço substituto nem substitui uma hospedagem permanente.

## Meta: o que ainda precisa de validação externa

1. Aplicativo Meta com Instagram API with Instagram Login habilitada.
2. Preencher `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` e `FACEBOOK_APP_SECRET`
   diretamente no arquivo privado/gerenciador de segredos. O segredo usado para
   assinatura de webhook deve corresponder ao aplicativo Meta que envia o evento.
3. Cadastrar a URL exata `/api/instagram/callback`, `/api/webhook` e o token de
   verificação já gerado. Configurar os eventos de comentários e mensagens.
4. Cadastrar `/privacy`, `/terms` e `/data-deletion` no painel Meta; revisar dados
   do controlador, contatos e procedimentos antes de receber clientes reais.
5. Autorizar uma conta profissional Business ou Creator como conta de teste.
6. Testar autorização, recebimento de evento real, processamento no worker,
   entrega de DM e resposta manual com uma conta de teste que interaja voluntariamente.
7. Solicitar acesso avançado às permissões efetivamente utilizadas e concluir
   App Review/verificações exigidas no painel para atender contas de terceiros.
8. Repetir o fluxo em dois tenants: eventos, contas, filas e resultados devem
   permanecer no workspace correto. Cada cliente precisa autorizar sua conta.

Permissões pedidas pelo código: `instagram_business_basic`,
`instagram_business_manage_comments`, `instagram_business_manage_messages` e
`instagram_business_manage_insights`. Não pedir publicação de conteúdo, que
este produto não implementa. Não presumir aprovação a partir de uma variável
ou de uma conta demonstrativa. Tokens não devem ser enviados em chat nem commit.

## Verificação e retorno

`/api/health` responde 200 somente quando banco, Redis, fila e heartbeat do worker
estão disponíveis; esse estado não confirma a aprovação ou uma entrega na Meta.
O endpoint público mostra apenas estados, sem conteúdo de tenants ou erros brutos.
Diagnósticos detalhados continuam exigindo autenticação.

Execute `node scripts/test-staging.mjs` depois de iniciar o ambiente para testar
o login completo de ambos os usuários, criação automática de assinatura, leitura
isolada e rejeição de alteração entre tenants. O script só aceita a configuração
de homologação com Mailpit e deixa um campo sintético no primeiro workspace.
Ele também verifica o wizard autenticado, a rejeição de destinatários ambíguos
sem novos e-mails e os atributos de segurança do cookie de sessão em HTTPS.
Com a proteção de login instalada, também exige bloqueio do reenvio imediato
sem novo e-mail e autenticação usando o primeiro link. Não execute esta versão
do teste contra imagens anteriores ao controle de reenvio.
Execute sem outros logins simultâneos no Mailpit para manter a contagem de
mensagens verificável. Consulte a [auditoria e correções](SECURITY_DEPENDENCIES_2026_09.md)
antes de publicar uma nova imagem e execute `npm run security:audit`.

A conexão OAuth exige estado assinado, prazo de dez minutos, usuário iniciador
e cookie HTTP-only do mesmo navegador. Uma implantação desta alteração invalida
tentativas OAuth iniciadas pela versão antiga; basta começar a conexão novamente.
Tokens existentes permanecem válidos e não há alteração de schema nesta entrega.

Para parar o endereço público, execute `stop tunnel` no mesmo compose. Para
parar o ambiente completo use `down` sem `-v`: os volumes são preservados.
Para voltar à versão anterior da aplicação, reconstrua a imagem a partir do
commit anterior preservando `.env.staging` e volumes. Não use `down -v` sem
backup: isso remove o banco e a fila de homologação.

## Fontes oficiais

- [Instagram Platform, coleção oficial da Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Cloudflare Quick Tunnels e limitações](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

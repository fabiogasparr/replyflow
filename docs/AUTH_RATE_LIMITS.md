# Proteção dos links de acesso por e-mail

## Comportamento

O callback compartilhado de autenticação reserva uma vaga no Redis antes de o Auth.js criar um token ou solicitar o envio. A proteção atende ao endpoint de login e à Server Action, pois ambos usam a mesma configuração Auth.js. A lista `ALLOWED_EMAILS` é verificada antes da reserva.

Limites padrão por instalação:

- Um pedido aceito por endereço a cada 60 segundos.
- Até cinco pedidos aceitos por endereço em uma janela de 15 minutos.
- Até 300 pedidos aceitos no total em uma janela de uma hora.

As janelas começam no primeiro pedido aceito após a expiração, não são janelas móveis. Pedidos negados não incrementam contadores nem renovam o tempo de espera. Falhas de entrega posteriores à reserva também consomem a vaga; não há devolução automática que permita abuso durante falhas do provedor.

O teto global pode ser ajustado com `AUTH_EMAIL_GLOBAL_LIMIT`, inteiro entre 1 e 100000. Se a variável não existir, vale 300. Valor vazio, zero, inválido ou fora da faixa desabilita novos envios de forma segura até a configuração ser corrigida. Esse limite deve acompanhar a capacidade contratada do provedor de e-mail.

## Privacidade e disponibilidade

As chaves usam HMAC-SHA256 com `NEXTAUTH_SECRET`, sem endereço de e-mail em texto aberto, token de autenticação ou conteúdo da mensagem. Instalações com segredos diferentes têm namespaces diferentes. As chaves têm expiração e não se misturam às chaves de automações. O limite é por instalação, não por workspace: antes do login não existe um contexto de tenant confiável.

A reserva combina os três limites em uma única operação Lua. Isso evita a sequência insegura de consultar e incrementar separadamente. As chaves compartilham uma hash tag; o cliente atual continua sendo o Redis simples já utilizado pelo projeto, não um cliente Redis Cluster.

O login utiliza uma conexão própria de curta duração, sem fila offline ou tentativas infinitas. Conexão e comando têm timeout de dois segundos cada. Se Redis ou o segredo estiverem indisponíveis, somente **novos envios** são recusados. Links já emitidos e sessões existentes não passam por essa reserva; continuam sujeitos à validade e às regras normais do Auth.js.

Erros exibidos ao usuário:

- `TooManyRequests`: conferir o link recebido e aguardar antes de pedir outro.
- `ServiceUnavailable`: aguardar a recuperação da verificação de limite.

Nenhum erro bruto do Redis, endereço ou segredo é retornado ou registrado por esse módulo.

## Limites desta proteção

Não é uma solução completa de DDoS, CAPTCHA ou limitação por IP. A consulta de usuário do Auth.js ainda ocorre antes de seu callback `signIn`. Em uma instalação com cadastro aberto, um ataque distribuído pode consumir o teto global e atrasar novos acessos. Para produção, combinar este controle com proteção de borda, observabilidade de volume e limites adequados à demanda. Não afrouxar permissões ou desabilitar a lista de acesso da homologação para testar.

## Testes e estado da entrega

- Testes de unidade cobrem chaves privadas, argumentos da reserva, falhas fechadas, configuração inválida, timeout configurado e preservação do callback de um link existente.
- Testes locais executam o pipeline real de requisições do Auth.js com banco em memória, reserva de limite e entrega de e-mail simulados. Cobrem CSRF, destinatário inválido ou não autorizado, ausência de criação de token/envio em pedidos recusados, preservação do primeiro link, armazenamento do token com hash, expiração, uso único e sessão com cookie seguro. Não substituem a validação com PostgreSQL, Redis, SMTP e servidor HTTPS reais.
- `npm run test:auth-rate-limit-redis`, com `TEST_REDIS_URL` apontando para loopback, foi preparado para testar concorrência, expiração, limites por destinatário/global e isolamento com Redis real. Cria nomes únicos e remove somente as chaves sintéticas conhecidas; nunca executa `FLUSHDB`.
- O CI inclui esse teste usando o Redis descartável do próprio job.
- O teste de homologação agora solicita um reenvio imediato, exige `TooManyRequests`, comprova ausência de novo e-mail e depois utiliza o primeiro link para entrar. Executar sem outros logins simultâneos e respeitando o intervalo entre execuções.

Em 12/09/2026, os 599 testes locais, lint, typecheck e build passaram; a auditoria de dependências não apontou vulnerabilidades. O teste com Redis 7 descartável também passou: 50 requisições simultâneas para o mesmo endereço reservaram apenas um envio; 20 destinatários concorrentes respeitaram o teto global de três; expiração, quotas por endereço, namespaces independentes e a conexão real usada no login foram verificados. O script foi corrigido para executar com `tsx` no formato de módulos do projeto, sem `await` no nível superior.

**Pendente:** teste HTTPS atualizado, publicação na prévia e CI desta branch. O bloqueio anterior do serviço de aprovação não se repetiu nesta execução; não presumir que o controle esteja ativo antes de concluir a implantação.

## Implantação e rollback

Não há migration, troca de provedor, rotação de segredo ou alteração de sessão. Manter o mesmo `NEXTAUTH_SECRET` em todas as réplicas web que compartilham o limite e garantir acesso ao Redis. Uma rotação do segredo também cria um novo namespace de contadores; não usá-la como mecanismo de desbloqueio.

Depois dos testes pendentes, reconstruir a imagem pelo serviço `migrate` e atualizar web/worker/cron sem apagar volumes ou recriar o túnel. Revalidar o login HTTPS e o uso do primeiro link após uma recusa de reenvio. A nova dependência operacional do login é a disponibilidade do Redis para emitir links.

Para rollback, retirar primeiro o túnel do ar ou restringir o acesso na borda e implantar a versão anterior da aplicação. O banco e as sessões permanecem intactos; as chaves de limite expiram sozinhas. A versão anterior perde a proteção contra reenvios, portanto não deve ser tratada como equivalente em segurança.

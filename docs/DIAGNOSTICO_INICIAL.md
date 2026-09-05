# Diagnóstico inicial do ReplyFlow

Data da análise: 3 de setembro de 2026  
Base analisada: `diwenne/openreply`  
Commit de origem: `d2cfccdb73974956730567af117642ef15160813`

## Resumo executivo

O OpenReply é uma base funcional e ativa para automação de comentários e mensagens do Instagram. O projeto já contém o núcleo mais difícil do domínio: OAuth com a Meta, validação de webhooks, correspondência de palavras-chave, filas, retentativas, limites de envio, worker permanente, múltiplas contas do Instagram, workspaces, inbox e relatórios.

O código é uma boa fundação para o ReplyFlow e não deve ser refeito do zero. Entretanto, ainda não é um SaaS comercial completo. Faltam cobrança, planos reais, administração global, CRM de contatos, seleção explícita de workspace, internacionalização, testes integrados e uma revisão de segurança das dependências.

## Resultado das validações

| Verificação | Resultado |
| --- | --- |
| Instalação com `npm ci` | Aprovada |
| Prisma Client | Gerado com sucesso |
| Typecheck | Aprovado |
| ESLint | Aprovado |
| Testes | 184 aprovados em 16 arquivos |
| Build de produção | Aprovado; 52 rotas/páginas |
| Docker | Docker CLI 29 e Compose 5 instalados; runtime Colima/QEMU funcionando |
| PostgreSQL e Redis | Iniciados e saudáveis via Docker Compose |
| Migrations | 18 migrations executadas em banco PostgreSQL limpo |
| Aplicação web e worker | Aplicação, worker e health check validados localmente |
| Auditoria de pacotes | Após atualização: 8 alertas altos e nenhum crítico |

Os testes existentes são predominantemente unitários e usam mocks para Prisma, Redis, BullMQ e API da Meta. O resultado é positivo para regressões de lógica, mas não comprova o funcionamento integrado da infraestrutura.

## Tecnologias

- Next.js 16 com App Router e React 19.
- TypeScript 5.
- Tailwind CSS 4.
- Prisma 7 com PostgreSQL e adapter `pg`.
- BullMQ 5 com Redis e `ioredis`.
- Auth.js/NextAuth 5 beta com sessões persistidas no banco.
- Resend ou SMTP/Nodemailer para links mágicos de acesso.
- Zod para validação.
- Recharts para gráficos.
- Vitest para testes.
- API oficial do Instagram/Meta.
- Docker Compose para serviços locais.

O gerenciador de pacotes é o npm, comprovado por `package-lock.json` e pelo uso de `npm ci` no CI.

## Estrutura da aplicação

O sistema tem quatro partes operacionais:

1. A aplicação Next.js entrega o site, o painel autenticado e as APIs.
2. A rota `/api/webhook` recebe e valida eventos da Meta.
3. O BullMQ persiste jobs no Redis e controla retentativas e atrasos.
4. O processo `worker/dm-worker.ts` consome jobs, chama a Meta e registra resultados no PostgreSQL.

Além do processamento por webhook, o worker executa reconciliação periódica de comentários. Essa varredura funciona como proteção para eventos não entregues pela Meta. O worker também grava heartbeat operacional a cada 30 segundos.

## Banco de dados

O schema contém os seguintes grupos principais:

- Autenticação: `User`, `Account`, `Session` e `VerificationToken`.
- Multiempresa: `Workspace`, `WorkspaceMember` e `WorkspaceInvitation`.
- Instagram: `InstagramAccount` e `FollowerSnapshot`.
- Automação: `Automation`, `DmLog` e `ProcessedComment`.
- Rastreamento: `TrackedLink` e `LinkClick`.
- Operação: `WebhookEvent` e `OperationalEvent`.

Há migrations incrementais para a fundação SaaS, produção, tracking, relatórios, workspaces, respostas públicas, seleção do próximo reel, follow gate, seguidores, follow-up e gatilhos por DM.

Pontos relevantes:

- O isolamento lógico é feito principalmente por `workspaceId`.
- Tokens de acesso do Instagram são armazenados criptografados.
- Existe deduplicação de DM por automação e comentário.
- Não existem entidades persistentes de contato, lead, tag, campo personalizado, assinatura, plano ou pagamento.
- Conversas do inbox não formam ainda um CRM persistente de relacionamento.

## Filas e worker

O webhook converte eventos válidos em jobs do BullMQ. O worker processa:

- comentários recebidos;
- mensagens e respostas a Stories;
- postbacks de botões;
- entrega posterior de mensagens;
- follow-ups com atraso;
- retentativas por rate limit ou falhas transitórias.

O worker aplica deduplicação, limite por conta do Instagram, contagem por workspace, tratamento de token expirado e registro de falhas. PostgreSQL, Redis e a chave de criptografia precisam ser iguais na aplicação web e no worker.

Durante a validação, o worker originalmente não carregava o arquivo `.env` quando iniciado pelo script documentado. O processo agora importa `dotenv/config`, preservando variáveis fornecidas pelo ambiente em produção e carregando o arquivo local apenas como fallback.

Risco estrutural: `lib/queue/dm-worker.ts` concentra muita lógica de domínio em um único módulo. Antes de adicionar um construtor visual de fluxos, convém separar handlers de comentário, mensagem, postback, follow gate e follow-up.

## Webhooks

A integração valida `x-hub-signature-256` usando o segredo do aplicativo. Eventos recebidos são registrados em `WebhookEvent`, associados ao workspace quando possível e marcados como processados ou com falha.

São tratados comentários, DMs, postbacks e eventos de leitura. A rota responde à verificação inicial do webhook por token. A aplicação também inclui reconciliação de comentários para reduzir perdas de eventos.

## Autenticação e autorização

O login usa link mágico via Resend ou SMTP. As sessões são persistidas no PostgreSQL. Um usuário novo recebe um workspace automaticamente, e convites permitem papéis `OWNER`, `ADMIN` e `MEMBER`.

A maioria das APIs consulta o usuário e inclui `workspaceId` nos filtros. Existem funções para comparar níveis de papel e restringir operações administrativas.

Lacunas:

- O sistema escolhe a primeira associação do usuário como workspace corrente; não há um seletor persistente completo.
- As permissões são amplas e limitadas aos três papéis.
- Não há autenticação multifator, SSO ou trilha completa de auditoria de ações administrativas.
- A allowlist de e-mails é opcional; sem ela, uma instalação pública aceita novos usuários por link mágico.

## Recursos reutilizáveis

- OAuth e cliente da API oficial da Meta.
- Validação e parsing dos webhooks.
- Motor de correspondência de palavras-chave, inclusive Unicode e escrita árabe.
- Fila, retentativas, rate limiting e worker.
- Campanhas por publicação, qualquer publicação ou próxima publicação.
- Respostas públicas e privadas.
- Botões, links rastreáveis e relatórios de clique.
- Follow gate, mensagem inicial e follow-up.
- Múltiplas contas do Instagram.
- Workspaces, convites e papéis básicos.
- Inbox e respostas dentro da janela permitida pela Meta.
- Logs de DM e diagnóstico operacional.
- Histórico de seguidores.
- Templates e importação de campanhas.
- CI, Dockerfile e Docker Compose.

## Recursos incompletos para o ReplyFlow

- Interface em português do Brasil e infraestrutura de i18n.
- Onboarding comercial e assistente de configuração da Meta.
- Troca e administração de múltiplos workspaces.
- Contatos, tags, segmentos, campos personalizados e notas.
- Histórico unificado de cada contato.
- Construtor visual de fluxos e condições.
- Planos, assinaturas, cobrança, trial e inadimplência.
- Limites por plano, conta, membro e volume.
- Painel administrativo global.
- Notificações proativas de falhas.
- Facebook Pages e outros canais.
- Recursos de inteligência artificial.
- Consentimento, retenção, portabilidade e exclusão alinhados à LGPD.

## Riscos técnicos

- O worker é obrigatório e não pode ser hospedado como função serverless comum.
- A operação depende das políticas, permissões, revisão e limites da Meta.
- Web e worker precisam compartilhar banco, Redis e chave de criptografia.
- A maior parte dos testes não usa PostgreSQL, Redis ou Meta reais.
- O módulo principal do worker possui responsabilidades demais.
- O módulo de envios agora oferece reprocessamento manual conservador para falhas anteriores à entrega; uma fila de descarte dedicada continua como evolução operacional.
- O plano gratuito sugerido na documentação original pode não ser suficiente para operação comercial.
- Alterações futuras do upstream podem conflitar com rebranding e mudanças profundas de domínio.

## Riscos de segurança

O diagnóstico inicial encontrou 23 alertas, incluindo 3 críticos. Next.js, React, Auth.js/NextAuth, Prisma e Nodemailer foram atualizados, e `npm audit fix` foi aplicado sem mudanças incompatíveis. Após as validações, não restam alertas críticos; o audit registra 8 alertas altos.

Os alertas restantes estão concentrados no Nodemailer aceito pelo Auth.js beta e em dependências de configuração/CLI do Prisma. O Auth.js ainda declara compatibilidade apenas com Nodemailer 7 ou 8, enquanto a correção do alerta residual está na versão 9. O Prisma inclui componentes de MySQL que esta aplicação PostgreSQL não utiliza. Não foi usado `npm audit fix --force`, pois a sugestão automática faria downgrades incompatíveis de Auth.js e Prisma.

Outros pontos para validar antes de produção:

- isolamento de workspace em todas as consultas e jobs;
- rate limiting de login e APIs autenticadas;
- rotação e recriptografia de tokens da Meta;
- política de expiração de sessões e convites;
- mascaramento de payloads e dados pessoais nos logs;
- proteção e retenção de backups;
- cabeçalhos de segurança, CSP e proteção CSRF;
- política de acesso ao diagnóstico operacional;
- exclusão e exportação de dados conforme LGPD.

O `.gitignore` já ignora `.env*` e permite apenas `.env.example`. O exemplo não contém segredos reais e documenta as variáveis necessárias.

## O que deve ser refatorado

Não é necessário substituir Next.js, Prisma, BullMQ ou a integração da Meta. Recomenda-se refatorar progressivamente:

1. Dividir o worker por tipo de job e caso de uso.
2. Introduzir uma camada explícita de domínio para contatos, campanhas e fluxos.
3. Centralizar autorização de workspace e conta do Instagram.
4. Criar adaptadores para cobrança, e-mail e futuros canais.
5. Adicionar testes integrados com containers e testes end-to-end.
6. Implementar observabilidade antes de escalar clientes.

## Serviços necessários

Para desenvolvimento local são necessários:

- Node.js 20 ou superior;
- npm;
- PostgreSQL 16;
- Redis 7;
- aplicação Next.js;
- worker BullMQ;
- conta Resend ou servidor SMTP para login real;
- aplicativo da Meta e conta profissional do Instagram para validação ponta a ponta.

O `docker-compose.yml` existente foi usado com sucesso para iniciar PostgreSQL 16 e Redis 7. Como a virtualização nativa não está disponível neste ambiente, o Colima usa QEMU sem aceleração. O primeiro boot é lento, mas os serviços e o encaminhamento das portas locais funcionam.

O modo de produção foi validado em `http://localhost:3000`. O modo de desenvolvimento encontrou o limite de watchers do macOS quando iniciado normalmente; `npm run dev:poll` usa polling e foi validado como alternativa estável. A rota `/api/health` confirmou banco, Redis, fila e heartbeat do worker em estado saudável.

## Conclusão

O projeto pode ser reutilizado como base do ReplyFlow. A prioridade não é reescrever o núcleo de automação, mas proteger a base, comprovar a integração completa, traduzir a experiência e construir as camadas comercial e de CRM em cima dela.

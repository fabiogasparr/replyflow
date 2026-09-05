# Roadmap do MVP ReplyFlow

## Visão do produto

O ReplyFlow será uma plataforma SaaS brasileira para automação de conversas e campanhas no Instagram. O primeiro produto deve resolver comentário ou palavra-chave para DM com confiabilidade, oferecer operação multiempresa e cobrar por uso sem tentar reproduzir todo o ManyChat na primeira versão.

## Princípios

- APIs oficiais e conformidade com as políticas da Meta.
- Português do Brasil como idioma inicial da experiência.
- Isolamento rigoroso entre workspaces.
- Nenhum segredo versionado.
- Mudanças de banco sempre acompanhadas de migration.
- Testes para regras de automação e limites comerciais.
- Observabilidade e capacidade de reprocessamento desde o MVP.
- Evolução incremental sobre o OpenReply, mantendo o remote `upstream`.

## Marco 0 — Fundação segura

Objetivo: tornar a base confiável para desenvolvimento do produto.

- [x] Criar repositório ReplyFlow.
- [x] Preservar o OpenReply como `upstream`.
- [x] Criar branch `chore/bootstrap-saas`.
- [x] Instalar dependências e gerar Prisma Client.
- [x] Executar lint, typecheck, testes e build.
- [x] Confirmar proteção de `.env` e credenciais.
- [x] Documentar diagnóstico e roadmap.
- [x] Definir a visibilidade remota: publicação incremental no repositório público autorizada pelo responsável.
- [x] Instalar Docker CLI, Compose e runtime Colima/QEMU.
- [x] Subir PostgreSQL e Redis.
- [x] Executar todas as migrations em banco limpo.
- [x] Iniciar aplicação web e worker simultaneamente.
- [x] Remover alertas críticos por atualização de dependências, sem regressões.
- [ ] Tratar ou aceitar formalmente os 8 alertas altos bloqueados por dependências upstream.
- [ ] Adicionar testes integrados com PostgreSQL e Redis. (PostgreSQL coberto no CRM; Redis ainda pendente.)
- [ ] Criar teste end-to-end mínimo de login e criação de campanha.

Critério de saída: ambiente reproduzível, auditoria de segurança tratada, CI verde e fluxo local validado com serviços reais.

## Marco 1 — Identidade e experiência brasileira

Objetivo: apresentar um produto coerente com a marca ReplyFlow.

- [x] Definir identidade visual e tom de voz.
- [ ] Definir domínio de produção.
- [x] Substituir referências visuais e textuais do OpenReply no código do produto.
- [x] Adicionar infraestrutura de internacionalização.
- [ ] Traduzir site, autenticação, painel, mensagens de erro e e-mails.
- [ ] Criar onboarding em etapas.
- [ ] Explicar configuração da Meta em linguagem não técnica.
- [ ] Adaptar termos, privacidade e exclusão de dados para o Brasil.
- [ ] Garantir acessibilidade e experiência responsiva.

Critério de saída: usuário brasileiro consegue criar uma conta e entender o produto sem documentação técnica externa.

Progresso validado em 4 de setembro de 2026:

- Landing page, autenticação, navegação principal, manifesto e metadados usam a marca ReplyFlow.
- Superfícies redesenhadas usam pt-BR e foram verificadas em desktop e celular.
- Termos, privacidade e exclusão de dados receberam uma primeira adaptação textual; ainda precisam de revisão jurídica antes da produção.
- Configuração central de produto e títulos do painel adicionada com testes automatizados.
- Catálogo tipado em pt-BR e formatadores compartilhados de datas e números adicionados com testes automatizados.
- Início, campanhas, desempenho, conversas, histórico e diagnóstico passaram a usar textos e formatos brasileiros; a tradução das superfícies restantes continua em andamento.
- Configurações, convites, relatórios compartilhados, páginas públicas e os oito modelos de campanha foram traduzidos; contraste e apresentação em telas estreitas receberam correções.
- E-mails de acesso por SMTP e Resend usam o mesmo conteúdo em pt-BR, com testes de preservação do link, escape HTML e falha de entrega. Nenhum e-mail real foi enviado nesta validação.
- Mensagens de validação de campanhas usam português; requisições JSON malformadas retornam erro de entrada. Ainda há mensagens técnicas e textos de fallback do worker a revisar antes de considerar a tradução integral concluída.

## Marco 2 — SaaS multiempresa

Objetivo: permitir que empresas e agências operem com isolamento e segurança.

- [x] Implementar seletor e workspace ativo persistente.
- [x] Permitir criação, edição, arquivamento e restauração de workspaces.
- [x] Revisar papéis `OWNER`, `ADMIN` e `MEMBER`.
- [x] Criar matriz de permissões para automações, inbox, relatórios, integrações, equipe e cobrança.
- [x] Melhorar convites, expiração, renovação e revogação.
- [x] Adicionar trilha de auditoria administrativa.
- [x] Revisar todas as queries para isolamento por workspace.
- [x] Definir limites de contas do Instagram e membros por plano.

Critério de saída: uma agência administra vários clientes sem risco de acesso cruzado.

Progresso validado em 4 de setembro de 2026:

- Workspace ativo persistido por usuário e validado contra `WorkspaceMember` em cada seleção.
- Seleções antigas são reparadas automaticamente quando o acesso do usuário é removido.
- Painel e APIs passam a resolver o mesmo workspace ativo; a troca remonta o painel para descartar estado do cliente anterior.
- Migração aplicada em PostgreSQL real e contratos protegidos por testes de unidade e de rota.
- Criação, renomeação, arquivamento e restauração validados pela API contra o banco real.
- Arquivar preserva os dados e pausa automações ativas; restaurar não reativa campanhas sem revisão do usuário.
- Proprietários controlam cobrança, arquivamento e administradores; administradores operam integrações, automações e membros comuns.
- Membros não recebem tokens de convites pendentes e convites repetidos nunca alteram o papel do proprietário.
- Convites vencidos são expirados automaticamente; gestores podem copiar, renovar ou revogar links com retorno explícito na interface.
- A trilha de auditoria registra ações administrativas de workspace, equipe, convites e conexões do Instagram, sempre isoladas pelo workspace ativo.
- Somente proprietários e administradores consultam os 50 eventos mais recentes; tokens e conteúdo de conversas não são armazenados nos eventos.
- Consultas autenticadas e mutações sensíveis foram revisadas para repetir o filtro de workspace; alertas Redis do worker agora são isolados antes de chegar ao diagnóstico.
- Entradas públicas por capacidade e processos globais estão classificados em `docs/WORKSPACE_ISOLATION.md`, com invariantes e gate de verificação.
- Planos Free, Pro e Agência centralizam capacidades progressivas de contas do Instagram e assentos; API, OAuth e interface aplicam os mesmos limites.
- Reconexões e renovações não consomem uma nova vaga, enquanto convites pendentes reservam assentos para impedir excesso posterior.

## Marco 3 — Automação MVP

Objetivo: consolidar o principal caso de uso comercial.

- [ ] Preservar campanhas por publicação, qualquer publicação e próximo reel.
- [ ] Preservar gatilhos de comentário, DM e Story.
- [ ] Refinar palavras-chave, correspondência parcial e palavra inteira.
- [ ] Preservar respostas públicas, mensagens privadas e personalização.
- [ ] Melhorar botões, links rastreáveis e follow-up.
- [ ] Criar estados claros para pausado, ativo, com erro e aguardando publicação.
- [ ] Dividir o worker em handlers menores.
- [ ] Criar fila de falhas e reprocessamento manual seguro.
- [ ] Exibir saúde do worker e atraso das filas no painel.
- [ ] Testar idempotência, concorrência e limites com Redis real.

Critério de saída: campanhas processam eventos duplicados, falhas e rate limits sem enviar mensagens indevidas.

## Marco 4 — Contatos e conversas

Objetivo: transformar interações isoladas em relacionamento persistente.

- [ ] Criar entidades `Contact`, `Conversation`, `Message`, `Tag` e `CustomField`. (`Contact` concluído.)
- [x] Migrar ou associar logs existentes aos contatos.
- [ ] Criar perfil do contato com histórico de comentários, DMs e cliques. (Comentários e respostas de automação concluídos; cliques aguardam identificação do destinatário.)
- [ ] Permitir tags manuais e automáticas. (Etiquetas manuais concluídas.)
- [ ] Criar segmentos por origem, campanha, engajamento e data.
- [ ] Evoluir o inbox com atribuição, status, busca e notas.
- [ ] Aplicar a janela de mensagens da Meta na interface.
- [ ] Implementar exportação e exclusão de dados pessoais.

Critério de saída: a equipe consegue identificar um contato, acompanhar seu histórico e responder com contexto.

Progresso validado em 5 de setembro de 2026:

- Perfis de contato são projetados automaticamente dos logs existentes e dos novos eventos, sem alterar o fluxo oficial da Meta.
- A identidade composta por workspace, conta do Instagram e usuário impede colisões entre empresas e contas.
- A lista oferece busca, filtros, paginação e acesso ao perfil com histórico das automações.
- Proprietários e administradores editam etiquetas e anotações; membros possuem acesso somente de leitura.
- Edição concorrente retorna conflito e preserva o rascunho local para comparação com a versão mais recente.
- O PostgreSQL foi validado com todas as 23 migrations, backfill, eventos fora de ordem, concorrência, cascata e rollback atômico em schema descartável.
- Limitações e rollback operacional estão documentados em `docs/CONTACTS.md`.

## Marco 5 — Planos e cobrança

Objetivo: operar comercialmente com limites previsíveis.

- [ ] Definir planos, preços e métricas de uso.
- [ ] Criar modelos `Plan`, `Subscription`, `UsageRecord` e `BillingEvent`.
- [ ] Integrar provedor de cobrança com cartão e Pix.
- [ ] Implementar trial, upgrade, downgrade e cancelamento.
- [ ] Aplicar limites atomicamente no worker.
- [ ] Limitar DMs, contas do Instagram, membros e workspaces por plano.
- [ ] Criar portal de cobrança e histórico de faturas.
- [ ] Processar webhooks de pagamento com idempotência.
- [ ] Definir tolerância e bloqueio por inadimplência.

Critério de saída: o sistema mede uso, cobra, altera planos e impede excesso sem perder eventos.

## Marco 6 — Relatórios e administração

Objetivo: dar visibilidade ao cliente e à operação do SaaS.

- [ ] Consolidar envios, falhas, cliques, CTR e conversão por campanha.
- [ ] Criar filtros por conta, workspace e período.
- [ ] Criar relatórios compartilháveis com marca do cliente.
- [ ] Implementar painel global de clientes, planos e uso.
- [ ] Exibir contas com tokens vencidos e workers indisponíveis.
- [ ] Criar ferramentas seguras de suporte e reprocessamento.
- [ ] Adicionar alertas de fila, webhook, autenticação e cobrança.

Critério de saída: clientes acompanham resultados e a equipe administra incidentes sem acessar diretamente o banco.

## Marco 7 — Expansões posteriores ao MVP

- [ ] Facebook Pages e Messenger.
- [ ] Construtor visual de fluxos com condições e ramificações.
- [ ] Respostas assistidas por inteligência artificial.
- [ ] Geração de campanhas e variações de texto por IA.
- [ ] Classificação e resumo de conversas.
- [ ] Webhooks e API pública para integrações.
- [ ] Integração com CRM e ferramentas de automação.
- [ ] Idiomas adicionais.

Esses itens não devem atrasar o lançamento do núcleo comentário/DM, contatos e cobrança.

## Próxima execução recomendada

1. Evoluir contatos e inbox sobre a base multiempresa já validada.
2. Concluir a tradução dos textos de fallback do worker e das mensagens técnicas exibidas ao usuário.
3. Adicionar cobrança recorrente e aplicação de limites de uso por plano.
4. Criar o painel administrativo global de clientes, planos e uso.
5. Publicar cada módulo validado em uma branch própria, conforme autorização do responsável.

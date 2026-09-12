# Dependências: auditoria e correções de setembro de 2026

Auditoria iniciada durante a homologação do wizard, em 11–12/09/2026. O diagnóstico inicial abaixo foi preservado; as correções estão registradas ao final.

## Evidência

- `npm audit --json`: 10 pacotes sinalizados, 8 altos e 2 moderados, nenhum crítico.
- `npm audit --omit=dev --json`: 8 pacotes sinalizados como altos. A contagem inclui propagação para dependentes; não significa oito falhas independentes.
- Os testes funcionais e o build passaram. Isso não elimina os alertas de segurança.

## Triagem inicial

| Cadeia | Evidência e exposição ainda a avaliar | Próximo passo |
| --- | --- | --- |
| Nodemailer → Auth.js/adaptador | Alertas de parsing de destinatário, disponibilidade e opções de conteúdo. O ReplyFlow gera seu próprio texto/HTML e não recebe `raw` do usuário. A homologação limita endereços completos e captura e-mails localmente. Isso reduz exposição, mas não prova ausência de todos os vetores. | Revisar os advisories, verificar versão corrigida compatível e reforçar validação de entrada. Repetir testes de autenticação SMTP/Resend antes de atualizar. |
| Prisma → deepmerge-ts | Esgotamento de pilha em grafos recursivos. A configuração Prisma é local; não há configuração de banco enviada pelo usuário na interface. | Confirmar alcançabilidade e correção compatível. Não aplicar downgrade automático para Prisma 6 em um projeto Prisma 7. |
| Prisma → mysql2 | Alertas de autenticação MySQL e descompressão. O ReplyFlow usa PostgreSQL, mas a imagem inclui a ferramenta Prisma e suas dependências. | Verificar atualização da cadeia e reduzir componentes de ferramentas no runtime quando compatível com migrations e worker. |
| Vitest/mocker | Alerta moderado relacionado a redirecionamento de mocks e leitura de arquivos. Testes são executados localmente/CI, não há servidor Vitest publicado. | Atualizar para versão corrigida compatível e repetir toda a suíte. |

Referências retornadas pelo registro: [Nodemailer: conteúdo raw](https://github.com/advisories/GHSA-p6gq-j5cr-w38f), [Nodemailer: parser](https://github.com/advisories/GHSA-2x7j-588g-ccc2), [DeepmergeTS](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), [MySQL2](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr), [Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). Consultar novamente o registro antes de decidir versões; o relatório é um retrato desta data, não garantia futura.

## Decisão inicial de implantação

Manter a homologação somente em loopback, com dados sintéticos e Mailpit. O túnel público **não foi iniciado**. Revisar/corrigir os alertas altos antes da próxima publicação externa, documentando eventual não alcançabilidade com evidência e testes. Não usar `npm audit fix --force` nem substituir dependências críticas por versões antigas apenas para zerar o contador.

Esta pendência não impede a revisão local do wizard. Não representa validação de segurança do SaaS completo nem comprovação de aprovação pela Meta.

## Correções em 12/09/2026

- Nodemailer `10.0.8`, com tipos próprios; removido `@types/nodemailer` 8. Esta versão exige Node 20 ou superior; Docker e CI já usam Node 24.
- Vitest `4.1.11`, mantendo a versão principal 4.
- Prisma continua `7.10.0`, assim como o cliente e o adaptador PostgreSQL. Overrides restritos corrigem `@prisma/config → deepmerge-ts` para `8.0.2` e `prisma → mysql2` para `3.24.4`. Não foi necessário migrar o banco ou adotar Prisma 8 em pré-lançamento.
- Auth.js e seu núcleo ainda declaram o peer Nodemailer 7/8. Dois overrides explícitos usam o Nodemailer corrigido. Trata-se de uma exceção de compatibilidade mantida pelo ReplyFlow, não de uma declaração de suporte upstream. Remover esses overrides quando uma versão compatível do Auth.js declarar a faixa corrigida. Não usar `--force` ou `--legacy-peer-deps`.
- Normalização única e limitada antes da consulta de usuário/autorização no Auth.js e antes do envio em SMTP/Resend. Aceita apenas um endereço simples em ASCII (domínios internacionalizados devem usar a forma punycode); recusa listas, grupos, comentários, nomes formatados, controles, parte local acima de 64 caracteres e endereço acima de 254. Mantém normalização para minúsculas e espaços externos comuns.
- SMTP recebe o destinatário como objeto estruturado. Mensagens proíbem leitura de arquivos e busca de conteúdo por URL, além de usar somente texto/HTML gerados pelo aplicativo.
- `npm run security:audit` entrou no CI. Uma vulnerabilidade de nível alto ou crítico interrompe a verificação; indisponibilidade do registro não é tratada como auditoria aprovada.

O resultado após a instalação selecionada foi **zero vulnerabilidades reportadas**. Isso não prova ausência de vulnerabilidades desconhecidas nem substitui análise de código e testes de isolamento.

Fontes das mudanças: [changelog do Nodemailer](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md), [changelog do DeepmergeTS](https://github.com/RebeccaStevens/deepmerge-ts/blob/main/CHANGELOG.md) e advisories acima. Versões e requisitos foram conferidos no registro npm.

## Impacto e validação

Não muda o banco, as sessões existentes, o identificador do provedor de e-mail, as permissões da Meta ou as regras de envio de DM. Pode rejeitar formatos de e-mail ambíguos que antes passavam; o usuário deve informar somente o endereço, sem nome de exibição ou lista.

Validação local: 569 testes em 75 arquivos, lint, typecheck, geração do Prisma e build aprovados. Os testes adicionais incluem composição com o transporte real do Nodemailer sem envio externo e bloqueio das opções `raw.path` e `raw.href` pelo sandbox da biblioteca. O teste de homologação exercita destinatários ambíguos pelo próprio endpoint Auth.js antes de repetir o login e o isolamento de dois tenants. Resend é coberto com transporte simulado; entrega por um serviço Resend real não está validada.

## Implantação e rollback

Construir a imagem com `npm ci` pelo serviço `migrate`, sem alterar `.env.staging` ou volumes. Iniciar novamente web/worker/cron com essa imagem e executar `node scripts/test-staging.mjs` antes de habilitar o túnel. Revalidar a auditoria antes de cada publicação.

Se a atualização de e-mail apresentar regressão, retirar primeiro o túnel do ar. Reverter os commits de dependências e reconstruir a imagem anterior preserva banco, sessões e chaves, mas também restaura os alertas conhecidos: a versão anterior deve permanecer apenas local até uma correção segura. Nunca usar `down -v`, apagar o banco ou girar chaves como forma de rollback de bibliotecas.

## Resultado da homologação corrigida

A imagem foi construída com instalação limpa (`npm ci`) e auditoria sem alertas. O teste SMTP passou tanto em loopback quanto pelo endereço HTTPS temporário: rejeitou três formatos ambíguos sem gerar mensagens no Mailpit, autenticou os dois usuários de teste e confirmou o isolamento do CRM e do wizard. O CI do commit de correção também passou, incluindo o novo gate de auditoria e os testes de banco/Redis existentes.

Depois dessas verificações, o túnel foi habilitado somente para a aplicação de homologação. Mailpit permanece em `127.0.0.1:8026`; PostgreSQL e Redis continuam sem portas publicadas. A lista de acesso permanece restrita aos dois endereços sintéticos. O host atual fica em `NEXTAUTH_URL` do arquivo privado de homologação, pois pode mudar quando o túnel é recriado. Isso libera testes controlados, não uma operação comercial irrestrita.

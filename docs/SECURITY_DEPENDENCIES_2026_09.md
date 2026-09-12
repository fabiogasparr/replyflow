# Dependências: pendências antes da publicação pública

Auditoria executada durante a homologação do wizard, em 11–12/09/2026, sem alterações automáticas de versões.

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

## Decisão de implantação

Manter a homologação somente em loopback, com dados sintéticos e Mailpit. O túnel público **não foi iniciado**. Revisar/corrigir os alertas altos antes da próxima publicação externa, documentando eventual não alcançabilidade com evidência e testes. Não usar `npm audit fix --force` nem substituir dependências críticas por versões antigas apenas para zerar o contador.

Esta pendência não impede a revisão local do wizard. Não representa validação de segurança do SaaS completo nem comprovação de aprovação pela Meta.

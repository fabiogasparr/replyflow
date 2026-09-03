<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Regras permanentes do ReplyFlow

- A interface do produto e a documentação voltada ao usuário devem usar português do Brasil.
- Código, nomes técnicos, commits e APIs podem permanecer em inglês.
- Nunca incluir senhas, tokens, cookies, chaves privadas ou outros segredos no repositório.
- Toda alteração no banco de dados deve ser acompanhada de uma migration do Prisma.
- Toda nova regra de automação deve ter testes automatizados.
- Preservar o isolamento entre workspaces em todas as consultas, comandos e jobs.
- Nunca permitir acesso cruzado a dados de empresas ou contas do Instagram diferentes.
- Usar branches por funcionalidade e commits com escopo claro.
- Executar lint, typecheck, testes e build antes de concluir alterações relevantes.
- Informar os arquivos alterados e os resultados das validações ao concluir uma tarefa.
- Não alterar integrações críticas sem explicar o impacto, a migração e o rollback.
- Usar somente APIs oficiais e respeitar as políticas e os limites da Meta.
- Manter `https://github.com/diwenne/openreply.git` como remote `upstream`.

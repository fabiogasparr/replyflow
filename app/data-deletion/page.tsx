import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";
import { findDeletionRequest } from "@/lib/meta/data-deletion-status";

export const metadata: Metadata = {
  title: "Exclusão de Dados",
  description:
    "Como desconectar o Instagram e solicitar a exclusão de dados no ReplyFlow.",
};

export const dynamic = "force-dynamic";

interface DataDeletionPageProps {
  searchParams: Promise<{ code?: string | string[] }>;
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(value);
}

export default async function DataDeletionPage({ searchParams }: DataDeletionPageProps) {
  const params = await searchParams;
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = rawCode?.trim().toUpperCase() ?? null;
  const request = code ? await findDeletionRequest(code).catch(() => null) : null;

  return (
    <LegalShell
      title="Exclusão de Dados"
      description="Use esta página para solicitar a remoção de dados de conta, espaço de trabalho, Instagram e campanhas do ReplyFlow."
      updatedAt="12 de setembro de 2026"
    >
      {code && (
        <section
          className="rounded-2xl border border-border bg-surface p-5"
          aria-live="polite"
        >
          <h2 className="text-xl font-bold text-foreground">
            Status da solicitação {code}
          </h2>
          {request ? (
            <>
              <p className="mt-3">
                Solicitação recebida da Meta em {formatDateTime(request.receivedAt)} e
                concluída.{" "}
                {request.removedAccounts > 0
                  ? `A conexão do Instagram e os dados vinculados a ela (campanhas, registros de envio, contatos e conversas) foram removidos do ReplyFlow.`
                  : `Não havia nenhuma conta do Instagram conectada ao ReplyFlow para esse perfil; nenhum dado precisou ser removido.`}
              </p>
              <p className="mt-3 text-muted">
                Guarde este código de confirmação. Se precisar de mais alguma coisa,
                escreva para o suporte informando o código.
              </p>
            </>
          ) : (
            <p className="mt-3">
              Não encontramos uma solicitação com este código. Confira o código
              informado pela Meta ou entre em contato com o suporte.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold text-foreground">Pela Meta (Instagram ou Facebook)</h2>
        <p className="mt-3">
          Ao remover o ReplyFlow em Configurações → Apps e sites do Instagram ou do
          Facebook e solicitar a exclusão dos dados, a Meta avisa o ReplyFlow
          automaticamente. A conexão daquela conta profissional é removida na hora,
          junto com campanhas, registros de envio, contatos e conversas vinculados, e
          a Meta exibe um código de confirmação que pode ser consultado nesta página.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Desconectar o Instagram</h2>
        <p className="mt-3">
          Entre na plataforma, abra Configurações e selecione Desconectar. Isso remove
          o token armazenado da conexão com o Instagram e interrompe os envios de
          respostas privadas para esse espaço de trabalho.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Dados de um contato</h2>
        <p className="mt-3">
          Proprietários e administradores podem exportar os dados de um contato pelo
          perfil. A anonimização permanente fica disponível ao proprietário e remove
          do ReplyFlow o perfil, as anotações, as conversas locais e o conteúdo
          diretamente identificável dos registros de automação. Datas, resultados e
          IDs técnicos de deduplicação podem ser mantidos para evitar reenvios e
          preservar métricas operacionais, conforme a política de retenção aplicável.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Excluir dados do espaço de trabalho</h2>
        <p className="mt-3">
          Para excluir dados do espaço de trabalho, campanhas, registros, webhooks,
          referências de cobrança e diagnósticos operacionais, contate o suporte pelo
          e-mail usado no acesso. Informe o nome do espaço e o usuário do Instagram conectado.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Verificação</h2>
        <p className="mt-3">
          Podemos solicitar a confirmação do controle sobre o e-mail ou a conta
          profissional conectada antes da exclusão. Pedidos são processados assim que
          possível, salvo quando a retenção for necessária por motivos legais, de
          cobrança, prevenção a fraude ou segurança.
        </p>
        <p className="mt-3">
          A remoção no ReplyFlow não exclui automaticamente dados mantidos pela Meta.
          Quando aplicável, o controlador deve tratar também a solicitação pelos canais
          próprios do Instagram.
        </p>
      </section>
    </LegalShell>
  );
}

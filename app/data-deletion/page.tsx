import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Exclusão de Dados",
  description:
    "Como desconectar o Instagram e solicitar a exclusão de dados no ReplyFlow.",
};

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="Exclusão de Dados"
      description="Use esta página para solicitar a remoção de dados de conta, espaço de trabalho, Instagram e campanhas do ReplyFlow."
      updatedAt="11 de setembro de 2026"
    >
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

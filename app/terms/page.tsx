import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: "Termos para uso das automações de comentários e mensagens do ReplyFlow.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Termos de Uso"
      description="Estes termos definem o uso aceitável do serviço de automação de comentários e mensagens do ReplyFlow."
      updatedAt="4 de setembro de 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">Uso autorizado</h2>
        <p className="mt-3">
          Você pode usar o ReplyFlow somente com contas profissionais do Instagram
          que possui ou está autorizado a gerenciar. Você é responsável pelas campanhas,
          palavras-chave, links e mensagens que configurar.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Conformidade com a plataforma</h2>
        <p className="mt-3">
          Você concorda em seguir os Termos da Plataforma Meta, as políticas do
          Instagram, regras de mensagens, leis de privacidade, publicidade e combate
          a spam aplicáveis. O ReplyFlow pode limitar, pausar ou desativar campanhas
          que criem riscos de conformidade, abuso, segurança ou entrega.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Disponibilidade</h2>
        <p className="mt-3">
          O ReplyFlow depende de plataformas de terceiros, incluindo Meta e provedores
          de e-mail, hospedagem, banco de dados e filas. Trabalhamos para operar o
          serviço com confiabilidade, mas não garantimos disponibilidade ininterrupta.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Núcleo de código aberto</h2>
        <p className="mt-3">
          O repositório público usa a licença MIT. A infraestrutura SaaS hospedada,
          suporte gerenciado, fluxos para agências, análises, relatórios e outros
          serviços pagos podem ser fornecidos separadamente do núcleo aberto.
        </p>
      </section>
    </LegalShell>
  );
}

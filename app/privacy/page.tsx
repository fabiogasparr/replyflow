import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como o ReplyFlow trata dados de contas do Instagram, webhooks, cobrança e campanhas.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Política de Privacidade"
      description="O ReplyFlow ajuda empresas a enviar respostas privadas em conformidade com a Meta quando alguém comenta em posts ou reels conectados."
      updatedAt="4 de setembro de 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">Dados que coletamos</h2>
        <p className="mt-3">
          Coletamos endereços de e-mail para autenticação, metadados do espaço de
          trabalho e cobrança, identificadores das contas conectadas do Instagram,
          tokens de acesso criptografados, configurações de campanhas, eventos de
          webhook, comentários necessários ao processamento, registros de entrega e
          diagnósticos operacionais.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Como usamos os dados</h2>
        <p className="mt-3">
          Usamos esses dados para autenticar usuários, conectar integrações do
          Instagram, identificar palavras-chave, enviar respostas privadas pelas APIs
          oficiais da Meta, evitar envios duplicados, investigar falhas e proteger o serviço.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Dados do Instagram e da Meta</h2>
        <p className="mt-3">
          O ReplyFlow não solicita senhas do Instagram, não faz scraping e não usa
          automação de navegador. Os tokens do Instagram são criptografados em repouso
          e usados somente nas ações autorizadas pela conta profissional conectada.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Fornecedores de infraestrutura</h2>
        <p className="mt-3">
          O serviço pode usar fornecedores de hospedagem, banco de dados, filas Redis,
          e-mail e observabilidade. Esses fornecedores processam dados somente na
          medida necessária para operar o serviço.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Retenção e exclusão</h2>
        <p className="mt-3">
          Clientes podem desconectar o Instagram nas configurações, removendo a
          conexão armazenada e interrompendo as campanhas. Para excluir a conta ou
          outros dados, siga as orientações da página de Exclusão de Dados.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Contato</h2>
        <p className="mt-3">
          Para questões de privacidade, entre em contato pelo canal de suporte
          informado no serviço ou com o responsável pelo repositório no GitHub.
        </p>
      </section>
    </LegalShell>
  );
}

import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Suporte à análise do aplicativo pela Meta — ReplyFlow",
  description:
    "Orientações para a análise do fluxo oficial de respostas privadas do ReplyFlow no Instagram pela Meta.",
};

export default function MetaReviewPage() {
  return (
    <LegalShell
      title="Análise do aplicativo pela Meta"
      description="O ReplyFlow permite que contas profissionais do Instagram enviem respostas privadas após comentários com palavras-chave em suas próprias publicações ou Reels."
      updatedAt="4 de setembro de 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">Fluxo de uso</h2>
        <p className="mt-3">
          O responsável pela empresa entra com seu e-mail, conecta uma conta
          profissional do Instagram pela autorização oficial da Meta e cria uma
          campanha com palavras-chave para uma publicação ou Reel. Quando alguém
          comenta, o ReplyFlow recebe uma notificação, coloca o evento na fila,
          verifica duplicidades e limites de envio e responde em privado usando
          o identificador do comentário.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Integração e proteção de dados</h2>
        <p className="mt-3">
          O aplicativo usa as APIs oficiais da Meta, verifica as assinaturas das
          notificações recebidas e armazena os tokens de acesso criptografados.
          Não coleta senhas do Instagram nem extrai dados por raspagem. O
          processamento controla duplicidades para evitar repetir respostas
          privadas ao mesmo comentário em uma campanha.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Orientações para o teste de análise</h2>
        <p className="mt-3">
          A equipe de análise pode usar uma empresa de teste da Meta, conectar
          uma conta profissional do Instagram e criar uma campanha com uma
          palavra-chave, como LINK. Depois, deve comentar essa palavra na
          publicação selecionada e confirmar que a resposta privada foi enviada
          e registrada uma única vez.
        </p>
      </section>
    </LegalShell>
  );
}

import type { Metadata } from "next";
import SeoPageShell from "@/components/seo-page-shell";
import { manychatAlternativePage } from "@/lib/seo-pages";

export const metadata: Metadata = {
  title: "Alternativa ao Manychat para campanhas de comentário para DM",
  description:
    "Uma alternativa focada ao Manychat para comentários com palavras-chave, respostas privadas, links rastreados e relatórios.",
  alternates: { canonical: "/manychat-alternative" },
  openGraph: {
    title: "Alternativa ao Manychat para campanhas de comentário para DM",
    description:
      "Use o ReplyFlow em campanhas focadas de comentário para DM no Instagram, sem um construtor complexo de chatbot.",
    url: "/manychat-alternative",
  },
};

export default function ManychatAlternativePage() {
  return <SeoPageShell config={manychatAlternativePage} />;
}

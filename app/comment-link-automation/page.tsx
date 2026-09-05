import type { Metadata } from "next";
import SeoPageShell from "@/components/seo-page-shell";
import { commentLinkSeoPage } from "@/lib/seo-pages";

export const metadata: Metadata = {
  title: "Automação de comentário LINK para Instagram",
  description:
    "Automatize comentários LINK no Instagram com palavras-chave, respostas privadas oficiais da Meta, links rastreados e métricas.",
  alternates: { canonical: "/comment-link-automation" },
  openGraph: {
    title: "Automação de comentário LINK para Instagram",
    description:
      "Transforme comentários como LINK, LOJA, GUIA e PREÇO em respostas privadas rastreadas com o ReplyFlow.",
    url: "/comment-link-automation",
  },
};

export default function CommentLinkAutomationPage() {
  return <SeoPageShell config={commentLinkSeoPage} />;
}

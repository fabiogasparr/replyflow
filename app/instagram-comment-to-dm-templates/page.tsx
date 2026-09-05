import type { Metadata } from "next";
import SeoPageShell from "@/components/seo-page-shell";
import { templatesSeoPage } from "@/lib/seo-pages";

export const metadata: Metadata = {
  title: "Modelos de campanhas de comentário para DM no Instagram",
  description:
    "Conheça modelos de comentário para DM para materiais gratuitos, produtos, preços, listas de espera, criadores e agências.",
  alternates: { canonical: "/instagram-comment-to-dm-templates" },
  openGraph: {
    title: "Modelos de campanhas de comentário para DM no Instagram",
    description:
      "Comece com modelos do ReplyFlow para comentários de alta intenção e respostas privadas no Instagram.",
    url: "/instagram-comment-to-dm-templates",
  },
};

export default function InstagramCommentToDmTemplatesPage() {
  return <SeoPageShell config={templatesSeoPage} />;
}

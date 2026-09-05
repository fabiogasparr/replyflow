import type { Metadata } from "next";
import SeoPageShell from "@/components/seo-page-shell";
import { agenciesSeoPage } from "@/lib/seo-pages";

export const metadata: Metadata = {
  title: "Automação de DM no Instagram para agências",
  description:
    "Automação de DM para agências com múltiplas contas, campanhas de comentário para DM, links rastreados e relatórios compartilháveis.",
  alternates: { canonical: "/instagram-dm-automation-agencies" },
  openGraph: {
    title: "Automação de DM no Instagram para agências",
    description:
      "Gerencie campanhas de comentário para DM dos seus clientes com os espaços de agência do ReplyFlow.",
    url: "/instagram-dm-automation-agencies",
  },
};

export default function InstagramDmAutomationAgenciesPage() {
  return <SeoPageShell config={agenciesSeoPage} />;
}

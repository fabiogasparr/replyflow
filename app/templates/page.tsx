import type { Metadata } from "next";
import Link from "next/link";
import PublicSiteHeader from "@/components/public-site-header";
import TemplateVisual from "@/components/template-visual";
import { CAMPAIGN_TEMPLATES } from "@/lib/templates/campaign-templates";

export const metadata: Metadata = {
  title: "Modelos de comentários para DM no Instagram — ReplyFlow",
  description:
    "Copie modelos prontos de campanhas que transformam comentários em DMs para produtos, materiais gratuitos, imóveis, fitness, restaurantes, eventos e criadores.",
  keywords: [
    "modelos de comentários para DM no Instagram",
    "campanhas de comentários para DM",
    "modelos de automação de DM no Instagram",
    "modelos alternativos ao Manychat",
  ],
};

export default function TemplatesPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicSiteHeader active="templates" />

      <section className="border-b border-border bg-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:px-8 lg:py-20">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-success">
              Biblioteca pública de modelos
            </p>
            <h1 className="mt-4 text-5xl font-black leading-[1.02] text-foreground sm:text-6xl">
              Campanhas para Instagram que você copia em minutos
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-foreground/80">
              Comece com estratégias comprovadas para transformar comentários em
              DMs de materiais gratuitos, produtos, eventos, cardápios de serviços
              e campanhas de clientes da sua agência.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center bg-accent px-6 py-3 text-sm font-bold text-foreground transition hover:bg-accent-hover"
              >
                Começar grátis
              </Link>
              <a
                href="#template-grid"
                className="inline-flex items-center justify-center border border-border bg-white px-6 py-3 text-sm font-bold text-foreground transition hover:border-border-hover hover:bg-surface"
              >
                Ver modelos
              </a>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {CAMPAIGN_TEMPLATES.slice(0, 2).map((template) => (
              <TemplateVisual key={template.slug} template={template} compact />
            ))}
          </div>
        </div>
      </section>

      <section
        id="template-grid"
        className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-6 lg:px-8"
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {CAMPAIGN_TEMPLATES.map((template) => (
            <article
              key={template.slug}
              className="flex min-h-full flex-col border border-border bg-white p-5 transition hover:border-border-hover hover:bg-surface"
            >
              <div className="mb-5">
                <TemplateVisual template={template} compact />
              </div>
              <p className="text-xs font-semibold uppercase tracking-wide text-success">
                {template.category}
              </p>
              <h2 className="mt-3 text-xl font-black leading-tight text-foreground">
                {template.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-foreground/80">
                {template.summary}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {template.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="border border-border bg-surface px-2 py-1 text-xs font-semibold text-foreground/80"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
              <div className="mt-auto grid gap-2 pt-6">
                <Link
                  href={`/templates/${template.slug}`}
                  className="inline-flex w-full items-center justify-center border border-border bg-white px-4 py-3 text-sm font-bold text-foreground transition hover:border-border-hover hover:bg-surface"
                >
                  Ver passo a passo
                </Link>
                <Link
                  href={`/login?template=${template.slug}`}
                  className="inline-flex w-full items-center justify-center bg-accent px-4 py-3 text-sm font-bold text-foreground transition hover:bg-accent-hover"
                >
                  Usar este modelo
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

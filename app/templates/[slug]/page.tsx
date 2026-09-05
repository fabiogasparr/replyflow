import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicSiteHeader from "@/components/public-site-header";
import TemplateVisual from "@/components/template-visual";
import {
  CAMPAIGN_TEMPLATES,
  getCampaignTemplate,
  getCampaignTemplateSlugs,
} from "@/lib/templates/campaign-templates";

type TemplatePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getCampaignTemplateSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: TemplatePageProps): Promise<Metadata> {
  const { slug } = await params;
  const template = getCampaignTemplate(slug);

  if (!template) {
    return {
      title: "Modelo não encontrado — ReplyFlow",
    };
  }

  return {
    title: `${template.title} — Modelo de comentários para DM no Instagram`,
    description: template.summary,
    keywords: [
      `modelo ${template.title}`,
      "modelo de comentários para DM no Instagram",
      "modelo de campanha de DM no Instagram",
      template.category,
      template.audience,
    ],
  };
}

export default async function TemplateDetailPage({ params }: TemplatePageProps) {
  const { slug } = await params;
  const template = getCampaignTemplate(slug);

  if (!template) {
    notFound();
  }

  const relatedTemplates = CAMPAIGN_TEMPLATES.filter(
    (item) => item.slug !== template.slug
  ).slice(0, 3);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicSiteHeader active="templates" />

      <section className="border-b border-border bg-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-14 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-20">
          <div>
            <Link
              href="/templates"
              className="text-sm font-semibold text-foreground/80 transition hover:text-foreground"
            >
              Voltar aos modelos
            </Link>
            <p className="mt-8 text-sm font-bold uppercase tracking-wide text-success">
              Modelo · {template.category}
            </p>
            <h1 className="mt-4 text-5xl font-black leading-[1.02] text-foreground sm:text-6xl">
              {template.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-foreground/80">
              {template.summary}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/login?template=${template.slug}`}
                className="inline-flex items-center justify-center bg-accent px-6 py-3 text-sm font-bold text-foreground transition hover:bg-accent-hover"
              >
                Usar este modelo
              </Link>
              <a
                href="#playbook"
                className="inline-flex items-center justify-center border border-border bg-white px-6 py-3 text-sm font-bold text-foreground transition hover:border-border-hover hover:bg-surface"
              >
                Ver passo a passo
              </a>
            </div>
          </div>

          <TemplateVisual template={template} />
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-16 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:px-8">
        <aside className="space-y-4">
          <div className="border border-border bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
              Público
            </p>
            <p className="mt-2 text-lg font-bold text-foreground">{template.audience}</p>
          </div>
          <div className="border border-border bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
              Tempo de configuração
            </p>
            <p className="mt-2 text-lg font-bold text-foreground">
              {template.setupMinutes} minutos
            </p>
          </div>
          <div className="border border-border bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
              Objetivo da campanha
            </p>
            <p className="mt-2 text-lg font-bold text-foreground">{template.goal}</p>
          </div>
        </aside>

        <div id="playbook" className="space-y-8">
          <section className="border border-border bg-white p-6">
            <h2 className="text-2xl font-black text-foreground">Resultado esperado</h2>
            <p className="mt-3 text-base leading-8 text-foreground/80">
              {template.outcome}
            </p>
          </section>

          <section className="border border-border bg-white p-6">
            <h2 className="text-2xl font-black text-foreground">Passo a passo</h2>
            <ol className="mt-5 space-y-3">
              {template.playbook.map((step, index) => (
                <li key={step} className="grid gap-3 sm:grid-cols-[40px_1fr]">
                  <span className="flex h-8 w-8 items-center justify-center bg-accent text-sm font-black text-foreground">
                    {index + 1}
                  </span>
                  <span className="text-sm leading-7 text-foreground/80">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="border border-border bg-white p-6">
              <h2 className="text-xl font-black text-foreground">Ideal para</h2>
              <ul className="mt-4 space-y-2">
                {template.bestFor.map((item) => (
                  <li key={item} className="text-sm text-foreground/80">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border border-border bg-white p-6">
              <h2 className="text-xl font-black text-foreground">Métricas para acompanhar</h2>
              <ul className="mt-4 space-y-2">
                {template.metrics.map((item) => (
                  <li key={item} className="text-sm text-foreground/80">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="border border-accent/20 bg-accent/10 p-6">
            <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <h2 className="text-2xl font-black text-foreground">
                  Copie esta campanha no ReplyFlow
                </h2>
                <p className="mt-2 text-sm leading-6 text-foreground/80">
                  Entre, conecte o Instagram, escolha uma publicação ou Reel e
                  os textos do modelo estarão prontos no rascunho da campanha.
                </p>
              </div>
              <Link
                href={`/login?template=${template.slug}`}
                className="inline-flex items-center justify-center bg-accent px-6 py-3 text-sm font-bold text-foreground transition hover:bg-accent-hover"
              >
                Usar este modelo
              </Link>
            </div>
          </section>
        </div>
      </section>

      <section className="border-t border-border bg-surface py-14">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-black text-foreground">Mais modelos</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {relatedTemplates.map((item) => (
              <Link
                key={item.slug}
                href={`/templates/${item.slug}`}
                className="border border-border bg-white p-5 transition hover:border-border-hover hover:bg-surface"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-success">
                  {item.category}
                </p>
                <h3 className="mt-3 text-lg font-black text-foreground">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-foreground/80">
                  {item.summary}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

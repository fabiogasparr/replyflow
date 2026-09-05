import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignReportBySlug } from "@/lib/reports/data";
import { formatNumber } from "@/lib/i18n";

type ReportPageProps = {
  params: Promise<{ shareSlug: string }>;
};

function formatDate(date: Date | null) {
  if (!date) return "Nenhum envio ainda";
  return date.toLocaleDateString("pt-BR", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="border border-border bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
        {label}
      </p>
      <p className="mt-3 text-3xl font-black tracking-tight text-foreground">
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      <p className="mt-2 text-xs leading-5 text-foreground/80">{helper}</p>
    </div>
  );
}

export async function generateMetadata({
  params,
}: ReportPageProps): Promise<Metadata> {
  const { shareSlug } = await params;
  const report = await getCampaignReportBySlug(shareSlug);

  if (!report) {
    return {
      title: "Relatório não encontrado",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${report.campaign.name} — Relatório da campanha`,
    description: `Relatório somente para leitura da campanha de comentários para DM no Instagram ${report.campaign.name}.`,
    robots: { index: false, follow: false },
  };
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { shareSlug } = await params;
  const report = await getCampaignReportBySlug(shareSlug);

  if (!report) {
    notFound();
  }

  const maxDaily = Math.max(
    ...report.daily.map((day) => Math.max(day.sent, day.clicks)),
    1
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold uppercase tracking-wide text-success">
                Relatório da campanha para o cliente
              </p>
              <h1 className="mt-4 max-w-3xl break-words text-4xl font-black leading-tight text-foreground sm:text-5xl">
                {report.campaign.name}
              </h1>
              <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-foreground/80">
                <span>@{report.campaign.instagramUsername}</span>
                {report.campaign.goal && (
                  <>
                    <span>·</span>
                    <span>{report.campaign.goal}</span>
                  </>
                )}
                <span>·</span>
                <span>
                  {report.campaign.isActive ? "Campanha ativa" : "Campanha pausada"}
                </span>
              </div>
            </div>

            <div className="border border-border bg-white p-4 text-sm text-foreground/80 md:min-w-64">
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                Espaço de trabalho
              </p>
              <p className="mt-2 break-words font-bold text-foreground">{report.workspace.name}</p>
              <p className="mt-4 text-xs text-foreground/80">
                Gerado em {formatDate(report.generatedAt)}
              </p>
              {report.branded && (
                <Link
                  href="/"
                  className="mt-4 inline-flex items-center justify-center border border-accent/20 bg-accent/10 px-3 py-2 text-xs font-semibold text-success transition hover:border-accent/40"
                >
                  Criado com ReplyFlow
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            label="DMs enviadas"
            value={report.metrics.sent}
            helper="Respostas privadas enviadas com sucesso."
          />
          <MetricCard
            label="Ignoradas"
            value={report.metrics.skipped}
            helper="Duplicidades, limites ou resultados sem envio."
          />
          <MetricCard
            label="Falhas"
            value={report.metrics.failed}
            helper="Respostas que precisam de revisão operacional."
          />
          <MetricCard
            label="Cliques"
            value={report.metrics.clicks}
            helper="Visitas rastreadas aos links enviados nas respostas."
          />
          <MetricCard
            label="CTR"
            value={`${formatNumber(report.metrics.ctr)}%`}
            helper="Cliques divididos pelas respostas enviadas."
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="border border-border bg-white p-4 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-foreground">
                  Últimos 7 dias
                </h2>
                <p className="mt-2 text-sm text-foreground/80">
                  Respostas enviadas e cliques rastreados por dia.
                </p>
              </div>
              <p className="text-xs text-foreground/80">
                Último envio: {formatDate(report.metrics.latestSentAt)}
              </p>
            </div>
            <div className="mt-8 grid h-56 grid-cols-7 items-end gap-1.5 sm:gap-3">
              {report.daily.map((day) => (
                <div key={day.date} className="flex h-full flex-col justify-end gap-2">
                  <div className="flex min-h-0 flex-1 items-end gap-1">
                    <div
                      className="w-full bg-accent/75"
                      style={{
                        height: `${Math.max((day.sent / maxDaily) * 100, 4)}%`,
                      }}
                      title={`${formatNumber(day.sent)} envios`}
                    />
                    <div
                      className="w-full bg-success/75"
                      style={{
                        height: `${Math.max((day.clicks / maxDaily) * 100, 4)}%`,
                      }}
                      title={`${formatNumber(day.clicks)} cliques`}
                    />
                  </div>
                  <p className="truncate text-center text-[11px] text-foreground/80">
                    {day.date}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-4 text-xs text-foreground/80">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 bg-accent" />
                Respostas enviadas
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 bg-success" />
                Cliques nos links
              </span>
            </div>
          </section>

          <aside className="space-y-6">
            <section className="border border-border bg-white p-4 sm:p-6">
              <h2 className="text-xl font-black text-foreground">Principais palavras-chave</h2>
              <div className="mt-5 space-y-3">
                {report.topKeywords.length === 0 && (
                  <p className="text-sm text-foreground/80">
                    Ainda não há dados de palavras-chave correspondentes.
                  </p>
                )}
                {report.topKeywords.map((keyword) => (
                  <div
                    key={keyword.keyword}
                    className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <span className="text-sm font-semibold text-foreground">
                      {keyword.keyword}
                    </span>
                    <span className="text-sm text-foreground/80">
                      {formatNumber(keyword.count)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="border border-border bg-white p-4 sm:p-6">
              <h2 className="text-xl font-black text-foreground">Links rastreados</h2>
              <div className="mt-5 space-y-3">
                {report.trackedLinks.length === 0 && (
                  <p className="text-sm text-foreground/80">
                    Esta campanha não possui um link rastreado.
                  </p>
                )}
                {report.trackedLinks.map((link) => (
                  <div
                    key={link.slug}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground/80">
                      {link.destinationHost}
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {formatNumber(link.clicks)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section className="mt-8 border border-border bg-white p-4 sm:p-6">
          <h2 className="text-xl font-black text-foreground">Configuração da campanha</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                Palavras-chave
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {report.campaign.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="border border-border bg-surface px-2 py-1 text-xs font-semibold text-foreground/80"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                Criada em
              </p>
              <p className="mt-3 text-sm text-foreground/80">
                {formatDate(report.campaign.createdAt)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                Publicação de origem
              </p>
              {report.campaign.postUrl ? (
                <a
                  href={report.campaign.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-sm font-semibold text-success transition hover:text-foreground"
                >
                  Ver publicação no Instagram
                </a>
              ) : (
                <p className="mt-3 text-sm text-foreground/80">Não vinculada</p>
              )}
            </div>
          </div>
        </section>

        {report.branded && (
          <footer className="mt-8 border-t border-border pt-6 text-center text-xs text-foreground/80">
            Criado com ReplyFlow, automação de comentários e mensagens no Instagram.
          </footer>
        )}
      </section>
    </main>
  );
}

import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignReportBySlug } from "@/lib/reports/data";
import { formatNumber } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReportPageProps = {
  params: Promise<{ shareSlug: string }>;
};

type BrandStyle = CSSProperties & {
  "--client-brand": string;
  "--client-brand-text": string;
};

function formatDate(value: Date | string | null, compact = false) {
  if (!value) return "Nenhum envio ainda";
  const parsed =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00Z`)
      : new Date(value);
  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: compact ? "short" : "long",
    ...(compact ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function MetricCard({
  eyebrow,
  value,
  helper,
}: {
  eyebrow: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-[#ded5c6] bg-[#fffdf8] p-5 shadow-[0_14px_45px_rgba(17,38,32,0.04)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#68736e]">
        {eyebrow}
      </p>
      <p className="mt-3 font-display text-4xl leading-none text-[#112620]">
        {value}
      </p>
      <p className="mt-3 text-xs leading-5 text-[#66736e]">{helper}</p>
    </article>
  );
}

function chartPoints(
  values: number[],
  max: number,
  width = 960,
  height = 260
) {
  const usableHeight = height - 32;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - 16 - (value / max) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
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
    title: `${report.campaign.name} — ${report.branding.name}`,
    description: `Relatório de resultados da campanha ${report.campaign.name}, compartilhado por ${report.branding.name}.`,
    robots: { index: false, follow: false },
  };
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { shareSlug } = await params;
  const report = await getCampaignReportBySlug(shareSlug);
  if (!report) notFound();

  const maxDaily = Math.max(
    ...report.daily.map((day) => Math.max(day.sent, day.clicks)),
    1
  );
  const chartLabels = [...new Set([0, Math.floor((report.daily.length - 1) / 2), report.daily.length - 1])];
  const brandStyle: BrandStyle = {
    "--client-brand": report.branding.color,
    "--client-brand-text": report.branding.textColor,
  };

  return (
    <main
      className="brand-dots min-h-screen overflow-x-hidden bg-[#fbf8f2] text-[#112620]"
      style={brandStyle}
    >
      <div className="mx-auto min-w-0 w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="w-full min-w-0 overflow-hidden rounded-[2rem] border border-[#d8cfbf] bg-[#fffdf8] shadow-[0_28px_90px_rgba(17,38,32,0.10)]">
          <div className="h-2 bg-[var(--client-brand)]" />
          <div className="grid min-w-0 gap-8 px-6 py-7 sm:px-9 sm:py-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:px-12 lg:py-11">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--client-brand)] text-sm font-black tracking-[0.08em] text-[var(--client-brand-text)]"
                  aria-hidden="true"
                >
                  {report.branding.initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#112620]">
                    {report.branding.name}
                  </p>
                  <p className="text-xs text-[#68736e]">Relatório para acompanhamento</p>
                </div>
              </div>
              <p className="mt-9 text-[10px] font-bold uppercase tracking-[0.22em] text-[#68736e]">
                Resultado da campanha
              </p>
              <h1 className="mt-3 max-w-3xl break-words font-display text-3xl leading-[1.05] sm:text-5xl lg:text-6xl">
                {report.campaign.name}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66736e] sm:text-base">
                {report.campaign.goal ??
                  "Desempenho das conversas iniciadas a partir de interações no Instagram."}
              </p>
            </div>

            <aside className="min-w-0 rounded-2xl bg-[#112620] p-5 text-white lg:min-w-72">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f5c451]">
                Período observado
              </p>
              <p className="mt-3 font-display text-2xl">
                {formatDate(report.period.from, true)} — {formatDate(report.period.to, true)}
              </p>
              <p className="mt-2 text-xs leading-5 text-[#b8cbc3]">
                Últimos {report.period.days} dias · horário de São Paulo
              </p>
              <div className="mt-5 border-t border-white/10 pt-4 text-xs text-[#b8cbc3]">
                <p>@{report.campaign.instagramUsername}</p>
                <p className="mt-1">Atualizado em {formatDate(report.generatedAt)}</p>
              </div>
            </aside>
          </div>
        </header>

        <section className="mt-5 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            eyebrow="Mensagens enviadas"
            value={formatNumber(report.metrics.sent)}
            helper="Respostas privadas concluídas."
          />
          <MetricCard
            eyebrow="Cliques rastreados"
            value={formatNumber(report.metrics.clicks)}
            helper="Acessos aos links da campanha."
          />
          <MetricCard
            eyebrow="CTR"
            value={`${formatNumber(report.metrics.ctr)}%`}
            helper="Cliques divididos pelos envios."
          />
          <MetricCard
            eyebrow="Taxa de entrega"
            value={`${formatNumber(report.metrics.deliveryRate)}%`}
            helper={`${formatNumber(report.metrics.failed)} falhas no período.`}
          />
          <MetricCard
            eyebrow="Descartes"
            value={formatNumber(report.metrics.skipped)}
            helper="Regras, duplicidades ou limites."
          />
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.65fr)]">
          <div className="rounded-3xl border border-[#ded5c6] bg-[#fffdf8] p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#68736e]">Ritmo diário</p>
                <h2 className="mt-2 font-display text-3xl">Interesse ao longo do período</h2>
              </div>
              <div className="flex gap-4 text-xs text-[#66736e]" aria-hidden="true">
                <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[var(--client-brand)]" />Envios</span>
                <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#e36d4e]" />Cliques</span>
              </div>
            </div>
            <div className="mt-8 overflow-hidden" role="img" aria-label="Evolução diária de mensagens enviadas e cliques rastreados">
              <svg viewBox="0 0 960 260" className="h-64 w-full" preserveAspectRatio="none">
                {[0.25, 0.5, 0.75, 1].map((ratio) => (
                  <line key={ratio} x1="0" x2="960" y1={244 - ratio * 228} y2={244 - ratio * 228} stroke="#ded5c6" strokeDasharray="5 7" />
                ))}
                <polyline points={chartPoints(report.daily.map((day) => day.sent), maxDaily)} fill="none" stroke="var(--client-brand)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                <polyline points={chartPoints(report.daily.map((day) => day.clicks), maxDaily)} fill="none" stroke="#e36d4e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="mt-2 flex justify-between text-[11px] text-[#75807a]">
                {chartLabels.map((index) => (
                  <span key={report.daily[index]?.date}>{formatDate(report.daily[index]?.date ?? report.period.from, true)}</span>
                ))}
              </div>
            </div>
          </div>

          <aside className="overflow-hidden rounded-3xl bg-[var(--client-brand)] text-[var(--client-brand-text)]">
            <div className="px-6 py-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">Caminho observado</p>
              <h2 className="mt-2 font-display text-3xl">Do envio ao clique</h2>
              <div className="mt-7 space-y-4">
                <div className="border-b border-current/20 pb-4">
                  <p className="text-xs opacity-70">Mensagens entregues</p>
                  <p className="mt-1 text-3xl font-bold">{formatNumber(report.metrics.sent)}</p>
                </div>
                <div>
                  <p className="text-xs opacity-70">Cliques rastreados</p>
                  <p className="mt-1 text-3xl font-bold">{formatNumber(report.metrics.clicks)}</p>
                </div>
              </div>
            </div>
            <div className="border-t border-current/20 bg-black/10 px-6 py-5 text-xs leading-5 opacity-85">
              {report.conversion.reason}
            </div>
          </aside>
        </section>

        <section className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-[#ded5c6] bg-[#f3eee4] p-6 sm:p-7">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#68736e]">Sinais de intenção</p>
            <h2 className="mt-2 font-display text-3xl">Palavras mais usadas</h2>
            {report.topKeywords.length === 0 ? (
              <p className="mt-6 text-sm text-[#66736e]">Ainda não há palavras-chave registradas neste período.</p>
            ) : (
              <ol className="mt-6 space-y-2">
                {report.topKeywords.map((keyword, index) => (
                  <li key={keyword.keyword} className="flex items-center gap-3 rounded-xl border border-[#ded5c6] bg-[#fffdf8] px-4 py-3">
                    <span className="font-display text-xl text-[var(--client-brand)]">{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{keyword.keyword}</span>
                    <span className="tabular-nums text-[#66736e]">{formatNumber(keyword.count)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-3xl border border-[#ded5c6] bg-[#fffdf8] p-6 sm:p-7">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#68736e]">Destinos</p>
            <h2 className="mt-2 font-display text-3xl">Links da campanha</h2>
            {report.trackedLinks.length === 0 ? (
              <p className="mt-6 text-sm text-[#66736e]">Esta campanha não possui links rastreados.</p>
            ) : (
              <div className="mt-6 space-y-3">
                {report.trackedLinks.map((link) => (
                  <div key={link.slug} className="flex items-center justify-between gap-4 border-b border-[#ded5c6] pb-3 last:border-0">
                    <span className="min-w-0 truncate text-sm text-[#66736e]">{link.destinationHost}</span>
                    <span className="shrink-0 font-semibold">{formatNumber(link.clicks)} cliques</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-6 text-xs leading-5 text-[#75807a]">Último envio registrado: {formatDate(report.metrics.latestSentAt)}</p>
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-[#ded5c6] bg-[#fffdf8] p-6 sm:p-8">
          <div className="grid gap-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#68736e]">Contexto da campanha</p>
              <h2 className="mt-2 font-display text-3xl">Como as conversas começaram</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                {report.campaign.keywords.map((keyword) => (
                  <span key={keyword} className="rounded-full border border-[#ded5c6] bg-[#f3eee4] px-3 py-1.5 text-xs font-semibold">{keyword}</span>
                ))}
                {report.campaign.keywords.length === 0 && (
                  <span className="text-sm text-[#66736e]">Qualquer palavra configurada na automação</span>
                )}
              </div>
            </div>
            {report.campaign.postUrl && (
              <a href={report.campaign.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center rounded-xl bg-[#112620] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#28463c]">
                Ver publicação no Instagram ↗
              </a>
            )}
          </div>
        </section>

        <footer className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-[#ded5c6] py-6 text-center text-xs text-[#66736e] sm:flex-row sm:text-left">
          <p>Relatório somente para leitura · nenhum dado pessoal é exibido.</p>
          {report.branded && (
            <Link href="/" className="font-semibold text-[#112620] transition hover:text-[#e95538]">
              Relatório seguro por ReplyFlow
            </Link>
          )}
        </footer>
      </div>
    </main>
  );
}

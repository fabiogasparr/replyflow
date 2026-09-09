"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ReportPreset,
  WorkspacePerformanceReport,
} from "@/lib/reports/performance";

type AppliedFilters = {
  preset: ReportPreset;
  from?: string;
  to?: string;
  instagramAccountId?: string;
  automationId?: string;
};

type ReportPayload = {
  success: boolean;
  data?: WorkspacePerformanceReport;
  error?: string;
};

const PRESETS: ReadonlyArray<{ value: Exclude<ReportPreset, "custom">; label: string }> = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

const numberFormatter = new Intl.NumberFormat("pt-BR");
const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatDate(dateKey: string, compact = false) {
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: compact ? "short" : "long",
    ...(compact ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function Comparison({
  value,
  inverse = false,
}: {
  value: number | null;
  inverse?: boolean;
}) {
  if (value === null) {
    return <span className="text-[#80621b]">novo no período</span>;
  }
  if (value === 0) return <span className="text-muted">sem variação</span>;
  const positive = value > 0;
  const favorable = inverse ? !positive : positive;
  return (
    <span className={favorable ? "text-success" : "text-error"}>
      {positive ? "↑" : "↓"} {percentFormatter.format(Math.abs(value))}%
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  comparison,
  inverseComparison,
}: {
  label: string;
  value: string;
  detail: string;
  comparison?: number | null;
  inverseComparison?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-[#d8cfbf] bg-[#fffdf8] p-4 shadow-[0_12px_35px_rgba(17,38,32,0.04)] sm:p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#738079]">
        {label}
      </p>
      <p className="mt-3 font-display text-3xl leading-none text-foreground sm:text-[2.15rem]">
        {value}
      </p>
      <p className="mt-3 text-xs leading-5 text-muted">
        {comparison !== undefined && (
          <>
            <Comparison value={comparison} inverse={inverseComparison} /> · {detail}
          </>
        )}
        {comparison === undefined && detail}
      </p>
    </article>
  );
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { date: string; sent: number; clicks: number };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-[#d8cfbf] bg-[#fffdf8] px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-foreground">{formatDate(point.date)}</p>
      <p className="mt-1 text-[#1d7a5d]">{numberFormatter.format(point.sent)} enviadas</p>
      <p className="text-[#c25d3f]">{numberFormatter.format(point.clicks)} cliques</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5" aria-label="Carregando relatório" aria-busy="true">
      <div className="h-40 animate-pulse rounded-3xl border border-border bg-surface" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="h-32 animate-pulse rounded-2xl border border-border bg-surface" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-2xl border border-border bg-surface" />
    </div>
  );
}

export default function PerformanceReport() {
  const [filters, setFilters] = useState<AppliedFilters>({ preset: "30d" });
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [data, setData] = useState<WorkspacePerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({ preset: filters.preset });
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.instagramAccountId) {
      params.set("instagramAccountId", filters.instagramAccountId);
    }
    if (filters.automationId) params.set("automationId", filters.automationId);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/reports/performance?${query}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const payload = (await response.json()) as ReportPayload;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? "Não foi possível carregar o relatório");
        }
        return payload.data;
      })
      .then((report) => {
        setData(report);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }
        setData(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Não foi possível carregar o relatório"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, refreshKey]);

  function applyFilters(next: AppliedFilters) {
    setLoading(true);
    setError(null);
    setFilters(next);
  }

  function selectPreset(preset: Exclude<ReportPreset, "custom">) {
    applyFilters({ ...filters, preset, from: undefined, to: undefined });
  }

  function applyCustomPeriod(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftFrom || !draftTo) {
      setError("Informe as datas inicial e final");
      return;
    }
    applyFilters({ ...filters, preset: "custom", from: draftFrom, to: draftTo });
  }

  function retry() {
    setLoading(true);
    setError(null);
    setRefreshKey((current) => current + 1);
  }

  if (loading && !data) return <LoadingState />;

  if (error && !data) {
    return (
      <div className="rounded-3xl border border-[#e3c7bd] bg-[#fff7f2] px-6 py-14 text-center">
        <p className="font-display text-2xl text-foreground">O relatório não abriu desta vez.</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#28463c]"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  const exportUrl = `/api/reports/performance?${query}&format=csv`;
  const selectedAccountCampaigns = data.options.campaigns.filter(
    (campaign) =>
      !filters.instagramAccountId ||
      campaign.instagramAccountId === filters.instagramAccountId
  );

  return (
    <div className="space-y-6 pb-8">
      <section className="replyflow-rise overflow-hidden rounded-3xl border border-[#294b40] bg-[#112620] text-white shadow-[0_24px_70px_rgba(17,38,32,0.15)]">
        <div className="grid gap-8 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-10 lg:py-9">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#f5c451]">
              Leitura comercial
            </p>
            <h1 className="mt-3 max-w-2xl font-display text-3xl leading-tight sm:text-4xl">
              Relatórios de resultado
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#bad0c7] sm:text-base">
              Entenda o caminho do comentário ao clique, compare períodos e descubra quais automações geram mais intenção.
            </p>
          </div>
          <a
            href={exportUrl}
            download
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#f5c451]/45 bg-[#f5c451] px-4 py-2.5 text-sm font-bold text-[#112620] transition hover:bg-[#ffda72]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2" aria-hidden="true">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Exportar CSV
          </a>
        </div>
      </section>

      <section className="replyflow-rise replyflow-rise-delay-1 rounded-2xl border border-border bg-[#f3eee4] p-4 sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[auto_minmax(180px,1fr)_minmax(220px,1.25fr)] xl:items-end">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Período</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => selectPreset(preset.value)}
                  aria-pressed={filters.preset === preset.value}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    filters.preset === preset.value
                      ? "bg-foreground text-white"
                      : "border border-border bg-[#fffdf8] text-muted hover:border-border-hover hover:text-foreground"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Conta</span>
            <select
              value={filters.instagramAccountId ?? ""}
              onChange={(event) =>
                applyFilters({
                  ...filters,
                  instagramAccountId: event.target.value || undefined,
                  automationId: undefined,
                })
              }
              className="w-full rounded-xl border border-border bg-[#fffdf8] px-3 py-2.5 text-sm text-foreground outline-none"
            >
              <option value="">Todas as contas</option>
              {data.options.accounts.map((account) => (
                <option key={account.id} value={account.id}>@{account.username}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Automação</span>
            <select
              value={filters.automationId ?? ""}
              onChange={(event) =>
                applyFilters({ ...filters, automationId: event.target.value || undefined })
              }
              className="w-full rounded-xl border border-border bg-[#fffdf8] px-3 py-2.5 text-sm text-foreground outline-none"
            >
              <option value="">Todas as automações</option>
              {selectedAccountCampaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} · @{campaign.instagramUsername}
                </option>
              ))}
            </select>
          </label>
        </div>

        <form onSubmit={applyCustomPeriod} className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <label>
            <span className="mb-1.5 block text-xs text-muted">De</span>
            <input
              type="date"
              value={draftFrom}
              onChange={(event) => setDraftFrom(event.target.value)}
              className="rounded-lg border border-border bg-[#fffdf8] px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label>
            <span className="mb-1.5 block text-xs text-muted">Até</span>
            <input
              type="date"
              value={draftTo}
              onChange={(event) => setDraftTo(event.target.value)}
              className="rounded-lg border border-border bg-[#fffdf8] px-3 py-2 text-sm text-foreground"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-[#294b40] px-3.5 py-2 text-sm font-semibold text-foreground transition hover:bg-[#112620] hover:text-white"
          >
            Aplicar datas
          </button>
          <p className="ml-auto text-xs text-muted">
            {formatDate(data.period.from)} — {formatDate(data.period.to)} · São Paulo
          </p>
        </form>
        {error && <p className="mt-3 text-sm text-error" role="alert">{error}</p>}
      </section>

      <section className="replyflow-rise replyflow-rise-delay-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard
          label="Mensagens enviadas"
          value={numberFormatter.format(data.totals.sent)}
          comparison={data.comparison.sent.changePercent}
          detail={`${numberFormatter.format(data.comparison.sent.previous)} no período anterior`}
        />
        <MetricCard
          label="Cliques rastreados"
          value={numberFormatter.format(data.totals.clicks)}
          comparison={data.comparison.clicks.changePercent}
          detail={`${numberFormatter.format(data.comparison.clicks.previous)} no período anterior`}
        />
        <MetricCard
          label="CTR"
          value={`${percentFormatter.format(data.totals.ctr)}%`}
          detail="cliques ÷ mensagens enviadas"
        />
        <MetricCard
          label="Taxa de entrega"
          value={`${percentFormatter.format(data.totals.deliveryRate)}%`}
          detail={`${numberFormatter.format(data.totals.failed)} falhas registradas`}
        />
        <MetricCard
          label="Falhas"
          value={numberFormatter.format(data.totals.failed)}
          comparison={data.comparison.failed.changePercent}
          inverseComparison
          detail={`${numberFormatter.format(data.comparison.failed.previous)} no período anterior`}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
        <div className="rounded-2xl border border-border bg-[#fffdf8] p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#b45b42]">Ritmo diário</p>
              <h2 className="mt-1 font-display text-2xl text-foreground">Envios que viraram interesse</h2>
            </div>
            <div className="flex gap-4 text-xs text-muted" aria-hidden="true">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#1d7a5d]" />Envios</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#e36d4e]" />Cliques</span>
            </div>
          </div>
          <div className="mt-6 h-72" role="img" aria-label="Gráfico diário de mensagens enviadas e cliques rastreados">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={288}
              initialDimension={{ width: 800, height: 288 }}
            >
              <AreaChart data={data.daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="sent-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1d7a5d" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#1d7a5d" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="click-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e36d4e" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#e36d4e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e5ddd0" strokeDasharray="3 4" />
                <XAxis dataKey="date" tickFormatter={(date) => formatDate(date, true)} minTickGap={30} tick={{ fill: "#6d7772", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compactNumber} allowDecimals={false} tick={{ fill: "#6d7772", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: "#a9b5af" }} />
                <Area type="monotone" dataKey="sent" stroke="#1d7a5d" strokeWidth={2.5} fill="url(#sent-fill)" isAnimationActive={false} />
                <Area type="monotone" dataKey="clicks" stroke="#e36d4e" strokeWidth={2.25} fill="url(#click-fill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <aside className="overflow-hidden rounded-2xl border border-[#294b40] bg-[#17362c] text-white">
          <div className="border-b border-white/10 px-5 py-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f5c451]">Funil observado</p>
            <h2 className="mt-1 font-display text-2xl">Do gatilho ao clique</h2>
          </div>
          <div className="space-y-1 px-5 py-5">
            <div className="rounded-xl bg-white/[0.06] px-4 py-3">
              <p className="text-xs text-[#a9c2b8]">Interações processadas</p>
              <p className="mt-1 text-2xl font-semibold">{numberFormatter.format(data.totals.sent + data.totals.skipped + data.totals.failed)}</p>
            </div>
            <div className="ml-5 h-4 border-l border-dashed border-[#f5c451]/60" />
            <div className="rounded-xl bg-white/[0.09] px-4 py-3">
              <p className="text-xs text-[#a9c2b8]">Mensagens entregues</p>
              <p className="mt-1 text-2xl font-semibold">{numberFormatter.format(data.totals.sent)}</p>
            </div>
            <div className="ml-5 h-4 border-l border-dashed border-[#f5c451]/60" />
            <div className="rounded-xl bg-[#f5c451] px-4 py-3 text-[#112620]">
              <p className="text-xs font-semibold opacity-70">Cliques rastreados</p>
              <p className="mt-1 text-2xl font-bold">{numberFormatter.format(data.totals.clicks)}</p>
            </div>
          </div>
          <div className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-[#a9c2b8]">
            Conversão em venda aparecerá quando um evento comercial for integrado. Cliques não são tratados como vendas.
          </div>
        </aside>
      </section>

      <section className="rounded-2xl border border-border bg-[#fffdf8]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-5 sm:px-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Comparativo</p>
            <h2 className="mt-1 font-display text-2xl text-foreground">Resultado por automação</h2>
          </div>
          <p className="text-xs text-muted">{data.campaigns.length} {data.campaigns.length === 1 ? "automação" : "automações"}</p>
        </div>
        {data.campaigns.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold text-foreground">Nenhuma automação neste filtro</p>
            <p className="mt-1 text-sm text-muted">Troque a conta ou amplie o período para comparar resultados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border bg-[#f6f1e8] text-left text-[10px] uppercase tracking-[0.14em] text-muted">
                  <th className="px-6 py-3 font-bold">Automação</th>
                  <th className="px-3 py-3 text-right font-bold">Enviadas</th>
                  <th className="px-3 py-3 text-right font-bold">Cliques</th>
                  <th className="px-3 py-3 text-right font-bold">CTR</th>
                  <th className="px-3 py-3 text-right font-bold">Entrega</th>
                  <th className="px-6 py-3 text-right font-bold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b border-border last:border-0">
                    <td className="px-6 py-4">
                      <p className="max-w-xs truncate font-semibold text-foreground">{campaign.name}</p>
                      <p className="mt-0.5 text-xs text-muted">@{campaign.instagramUsername}</p>
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums text-foreground">{numberFormatter.format(campaign.sent)}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-foreground">{numberFormatter.format(campaign.clicks)}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-foreground">{percentFormatter.format(campaign.ctr)}%</td>
                    <td className="px-3 py-4 text-right tabular-nums text-foreground">{percentFormatter.format(campaign.deliveryRate)}%</td>
                    <td className="px-6 py-4 text-right">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${campaign.isActive ? "bg-[#dfeee7] text-[#16634c]" : "bg-[#eee9df] text-[#6e756f]"}`}>
                        {campaign.isActive ? "Ativa" : "Pausada"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="rounded-2xl border border-border bg-[#f3eee4] p-5 sm:p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#b45b42]">Sinais de intenção</p>
          <h2 className="mt-1 font-display text-2xl text-foreground">Palavras que mais ativaram conversas</h2>
          {data.topKeywords.length === 0 ? (
            <p className="mt-6 text-sm text-muted">Ainda não há palavras-chave registradas neste período.</p>
          ) : (
            <ol className="mt-5 grid gap-2 sm:grid-cols-2">
              {data.topKeywords.map((keyword, index) => (
                <li key={keyword.keyword} className="flex items-center gap-3 rounded-xl border border-border bg-[#fffdf8] px-4 py-3">
                  <span className="font-display text-xl text-[#b45b42]">{String(index + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{keyword.keyword}</span>
                  <span className="text-sm tabular-nums text-muted">{numberFormatter.format(keyword.count)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-[#fffdf8] p-5 sm:p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Como ler</p>
          <h2 className="mt-1 font-display text-2xl text-foreground">Métricas sem maquiagem</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div><dt className="font-semibold text-foreground">CTR</dt><dd className="mt-1 leading-5 text-muted">Cliques rastreados divididos pelas mensagens enviadas.</dd></div>
            <div><dt className="font-semibold text-foreground">Entrega</dt><dd className="mt-1 leading-5 text-muted">Envios concluídos entre todas as tentativas enviadas ou falhas.</dd></div>
            <div><dt className="font-semibold text-foreground">Período anterior</dt><dd className="mt-1 leading-5 text-muted">Janela imediatamente anterior com a mesma quantidade de dias.</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}

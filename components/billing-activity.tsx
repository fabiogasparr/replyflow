"use client";

import { useEffect, useState } from "react";

type BillingEventStatus = "PENDING" | "PROCESSED" | "FAILED" | "IGNORED";
type StatusFilter = "ALL" | BillingEventStatus;

type BillingEventItem = {
  id: string;
  providerEventId: string;
  providerLabel: string;
  type: string;
  status: BillingEventStatus;
  statusLabel: string;
  occurredAt: string;
  processedAt: string | null;
  failureReason: string | null;
};

type BillingActivityData = {
  events: BillingEventItem[];
  summary: Record<BillingEventStatus, number>;
  nextCursor: string | null;
};

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "PROCESSED", label: "Processados" },
  { value: "FAILED", label: "Falhas" },
  { value: "IGNORED", label: "Ignorados" },
  { value: "PENDING", label: "Pendentes" },
];

const STATUS_CLASSES: Record<BillingEventStatus, string> = {
  PENDING: "border-warning/20 bg-warning/10 text-warning",
  PROCESSED: "border-success/20 bg-success/10 text-success",
  FAILED: "border-error/20 bg-error/10 text-error",
  IGNORED: "border-border bg-surface-hover text-muted",
};

function eventCount(data: BillingActivityData | null, filter: StatusFilter) {
  if (!data) return 0;
  if (filter !== "ALL") return data.summary[filter];
  return Object.values(data.summary).reduce((total, count) => total + count, 0);
}

export default function BillingActivity() {
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [data, setData] = useState<BillingActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ limit: "10" });
    if (filter !== "ALL") params.set("status", filter);

    fetch(`/api/billing/events?${params}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Não foi possível carregar a atividade");
        }
        if (active) setData(payload.data);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Não foi possível carregar a atividade"
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filter]);

  function changeFilter(nextFilter: StatusFilter) {
    if (nextFilter === filter) return;
    setLoading(true);
    setError(null);
    setData(null);
    setFilter(nextFilter);
  }

  async function loadMore() {
    if (!data?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    const params = new URLSearchParams({
      limit: "10",
      cursor: data.nextCursor,
    });
    if (filter !== "ALL") params.set("status", filter);

    try {
      const response = await fetch(`/api/billing/events?${params}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível carregar mais eventos");
      }
      setData((current) => ({
        ...payload.data,
        events: [...(current?.events ?? []), ...payload.data.events],
      }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar mais eventos"
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="panel rounded p-4 sm:p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold">Atividade da assinatura</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          Histórico técnico para conferência de mudanças do plano. Metadados
          internos e credenciais nunca aparecem nesta tela.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Filtrar eventos de cobrança">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => changeFilter(item.value)}
            aria-pressed={filter === item.value}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === item.value
                ? "border-accent bg-accent text-white"
                : "border-border text-muted hover:border-border-hover hover:text-foreground"
            }`}
          >
            {item.label} {eventCount(data, item.value)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-5 h-28 animate-pulse rounded-lg bg-surface-hover" />
      ) : error && !data ? (
        <p role="alert" className="mt-5 rounded-lg border border-error/20 bg-error/5 p-3 text-sm text-error">
          {error}
        </p>
      ) : data?.events.length ? (
        <div className="mt-5 space-y-3">
          {data.events.map((event) => (
            <article key={event.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {event.type}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {event.providerLabel} · {new Date(event.occurredAt).toLocaleString("pt-BR")}
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[event.status]}`}>
                  {event.statusLabel}
                </span>
              </div>
              {event.failureReason && (
                <p className="mt-3 rounded-md bg-error/5 p-2 text-xs leading-5 text-error">
                  {event.failureReason}
                </p>
              )}
              <p className="mt-3 truncate font-mono text-[10px] text-zinc-500" title={event.providerEventId}>
                Referência: {event.providerEventId}
              </p>
            </article>
          ))}

          {error && (
            <p role="alert" className="text-sm text-error">{error}</p>
          )}
          {data.nextCursor && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? "Carregando..." : "Carregar mais"}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-5 rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted">
          Nenhum evento de assinatura neste filtro.
        </p>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatNumber } from "@/lib/i18n";

type HealthStatus = "HEALTHY" | "DEGRADED" | "CRITICAL";
type QueueStatus = "IDLE" | "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNAVAILABLE";

type FailureComparison = {
  current: { total: number; issues: number; rate: number };
  previous: { total: number; issues: number; rate: number };
  trend: "UP" | "DOWN" | "STABLE";
  anomaly: boolean;
  severity: "NONE" | "WARNING" | "CRITICAL";
};

type IncidentWorkspace = {
  workspaceId: string;
  name: string;
  archived: boolean;
  webhookFailures: number;
  deliveryFailures: number;
  operationalErrors: number;
  authenticationErrors: number;
  billingProblems: number;
  expiredTokens: number;
  expiringTokens: number;
  pendingWebhooks: number;
  score: number;
};

type OperationsSnapshot = {
  generatedAt: string;
  status: HealthStatus;
  services: {
    database: { available: boolean };
    redis: { available: boolean };
    worker: {
      healthy: boolean;
      ageMs: number | null;
      lastSeenAt: string | null;
      startedAt: string | null;
    };
    queue: {
      status: QueueStatus;
      counts: { waiting: number; active: number; delayed: number; failed: number };
      oldestWaitingAgeMs: number | null;
      truncated: boolean;
    };
    emailAuthentication: { ready: boolean; provider: "resend" | "smtp" };
  };
  metrics: {
    webhooks: {
      counts: Record<"PENDING" | "PROCESSED" | "FAILED", number>;
      comparison: FailureComparison;
    };
    deliveries: {
      counts: Record<
        | "PENDING"
        | "SENT"
        | "FAILED"
        | "SKIPPED_DEDUP"
        | "SKIPPED_RATE_LIMIT"
        | "SKIPPED_PLAN_LIMIT"
        | "SKIPPED_NO_MATCH",
        number
      >;
      comparison: FailureComparison;
    };
    operationalEvents: {
      byLevel: Record<"INFO" | "WARNING" | "ERROR", number>;
      bySource: Record<"WORKER" | "TOKEN_REFRESH" | "HEALTH" | "SYSTEM", number>;
      comparison: FailureComparison;
    };
    automations: { authenticationErrors: number; configurationErrors: number };
    billing: { counts: Record<"PENDING" | "PROCESSED" | "FAILED" | "IGNORED", number> };
    integrations: { expiredTokens: number; expiringTokens: number; pendingWebhooks: number };
    authentication: { activeSessions: number; verifiedUsers: number; pendingVerificationUsers: number };
    incidentWorkspaces: IncidentWorkspace[];
  } | null;
  issues: Array<{ code: string; severity: "WARNING" | "CRITICAL"; message: string }>;
};

const statusPresentation: Record<HealthStatus, { label: string; classes: string }> = {
  HEALTHY: { label: "Operação saudável", classes: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  DEGRADED: { label: "Operação degradada", classes: "border-amber-200 bg-amber-50 text-amber-900" },
  CRITICAL: { label: "Atenção imediata", classes: "border-red-200 bg-red-50 text-red-900" },
};

const queueLabels: Record<QueueStatus, string> = {
  IDLE: "Ociosa",
  HEALTHY: "Saudável",
  DEGRADED: "Degradada",
  CRITICAL: "Crítica",
  UNAVAILABLE: "Indisponível",
};

function formatAge(milliseconds: number | null) {
  if (milliseconds == null) return "sem heartbeat";
  if (milliseconds < 60_000) return `há ${Math.max(1, Math.round(milliseconds / 1_000))}s`;
  if (milliseconds < 3_600_000) return `há ${Math.round(milliseconds / 60_000)}min`;
  return `há ${Math.round(milliseconds / 3_600_000)}h`;
}

function trendLabel(comparison: FailureComparison) {
  if (comparison.trend === "STABLE") return "estável";
  const difference = Math.abs(
    comparison.current.rate - comparison.previous.rate
  ).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return comparison.trend === "UP"
    ? `alta de ${difference} p.p.`
    : `queda de ${difference} p.p.`;
}

class OperationsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function fetchOperations(period: string, signal?: AbortSignal) {
  const response = await fetch(`/api/platform/operations?period=${period}`, {
    signal,
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new OperationsRequestError(
      payload.error ?? "Não foi possível carregar a operação",
      response.status
    );
  }
  return payload.data as OperationsSnapshot;
}

function ServiceCard({ label, value, detail, healthy }: { label: string; value: string; detail: string; healthy: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${healthy ? "bg-emerald-500" : "bg-red-500"}`} aria-hidden="true" />
      </div>
      <p className="mt-2 text-sm font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </div>
  );
}

function MetricCard({ title, primary, detail, comparison }: { title: string; primary: string; detail: string; comparison?: FailureComparison }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-2 text-xl font-semibold text-foreground">{primary}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
      {comparison && (
        <p className={`mt-2 text-xs font-semibold ${comparison.anomaly ? "text-red-700" : comparison.trend === "DOWN" ? "text-emerald-700" : "text-muted"}`}>
          {comparison.current.rate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% de incidentes · {trendLabel(comparison)}
        </p>
      )}
    </div>
  );
}

export default function PlatformOperations() {
  const router = useRouter();
  const [period, setPeriod] = useState("24h");
  const [refreshKey, setRefreshKey] = useState(0);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const handleFailure = (loadError: unknown, showMessage: boolean) => {
      if (
        loadError instanceof OperationsRequestError &&
        (loadError.status === 401 || loadError.status === 403)
      ) {
        setSnapshot(null);
        router.replace(
          loadError.status === 401
            ? "/login?callbackUrl=%2Fadmin"
            : "/dashboard"
        );
        router.refresh();
        return;
      }
      if (showMessage) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Não foi possível carregar a operação"
        );
      }
    };
    fetchOperations(period, controller.signal)
      .then((data) => {
        setSnapshot(data);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        handleFailure(loadError, true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    const timer = window.setInterval(() => {
      fetchOperations(period, controller.signal)
        .then((data) => {
          setSnapshot(data);
          setError(null);
        })
        .catch((loadError: unknown) => handleFailure(loadError, false));
    }, 30_000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [period, refreshKey, router]);

  function changePeriod(value: string) {
    if (value === period) return;
    setLoading(true);
    setPeriod(value);
  }

  const presentation = statusPresentation[snapshot?.status ?? "DEGRADED"];
  const metrics = snapshot?.metrics;
  const deliveryBlocks = metrics
    ? metrics.deliveries.counts.FAILED +
      metrics.deliveries.counts.SKIPPED_RATE_LIMIT +
      metrics.deliveries.counts.SKIPPED_PLAN_LIMIT
    : 0;

  return (
    <section className="space-y-4" aria-labelledby="platform-operations-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="platform-operations-title" className="text-base font-semibold text-foreground">Central de operações</h2>
          <p className="mt-1 text-sm text-muted">Serviços ao vivo e métricas comparadas ao período anterior equivalente.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Período móvel
            <select value={period} onChange={(event) => changePeriod(event.target.value)} className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-[#d9a91e]">
              <option value="1h">Última hora</option>
              <option value="24h">Últimas 24 horas</option>
              <option value="7d">Últimos 7 dias</option>
            </select>
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => { setLoading(true); setRefreshKey((key) => key + 1); }}
            className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-zinc-50 disabled:opacity-60"
          >
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div>}

      {snapshot && (
        <>
          <div className={`rounded-xl border px-4 py-3 ${presentation.classes}`}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold">{presentation.label}</p>
              <p className="text-xs opacity-80">Atualizado às {new Date(snapshot.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
            </div>
            <p className="mt-1 text-sm opacity-90">{snapshot.issues.length === 0 ? "Nenhum sinal operacional exige atenção." : `${snapshot.issues.length} sinal(is) exigem acompanhamento.`}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <ServiceCard label="Banco" value={snapshot.services.database.available ? "Disponível" : "Indisponível"} detail="métricas persistidas" healthy={snapshot.services.database.available} />
            <ServiceCard label="Redis" value={snapshot.services.redis.available ? "Disponível" : "Indisponível"} detail="fila e heartbeat" healthy={snapshot.services.redis.available} />
            <ServiceCard label="Worker" value={snapshot.services.worker.healthy ? "Saudável" : "Sem resposta"} detail={formatAge(snapshot.services.worker.ageMs)} healthy={snapshot.services.worker.healthy} />
            <ServiceCard label="Fila" value={queueLabels[snapshot.services.queue.status]} detail={`${snapshot.services.queue.counts.waiting} aguardando · ${snapshot.services.queue.counts.failed} falhos`} healthy={["IDLE", "HEALTHY"].includes(snapshot.services.queue.status)} />
            <ServiceCard label="Login por e-mail" value={snapshot.services.emailAuthentication.ready ? "Pronto" : "Não configurado"} detail={snapshot.services.emailAuthentication.provider === "smtp" ? "SMTP" : "Resend"} healthy={snapshot.services.emailAuthentication.ready} />
          </div>

          {snapshot.issues.length > 0 && (
            <div className="panel rounded p-4">
              <h3 className="text-sm font-semibold text-foreground">Sinais ativos</h3>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {snapshot.issues.map((issue) => (
                  <div key={issue.code} className={`rounded-lg border px-3 py-2 text-sm ${issue.severity === "CRITICAL" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    {issue.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {metrics ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="Webhooks" primary={`${formatNumber(metrics.webhooks.counts.PROCESSED)} processados`} detail={`${metrics.webhooks.counts.FAILED} falhos · ${metrics.webhooks.counts.PENDING} pendentes`} comparison={metrics.webhooks.comparison} />
              <MetricCard title="Entregas" primary={`${formatNumber(metrics.deliveries.counts.SENT)} enviadas`} detail={`${deliveryBlocks} falhas ou bloqueios`} comparison={metrics.deliveries.comparison} />
              <MetricCard title="Eventos operacionais" primary={`${formatNumber(metrics.operationalEvents.byLevel.ERROR)} erros`} detail={`${metrics.operationalEvents.byLevel.WARNING} avisos · ${metrics.operationalEvents.bySource.WORKER} do worker`} comparison={metrics.operationalEvents.comparison} />
              <MetricCard title="Integrações" primary={`${formatNumber(metrics.integrations.expiredTokens)} tokens vencidos`} detail={`${metrics.integrations.expiringTokens} vencem em 7 dias · ${metrics.integrations.pendingWebhooks} webhooks pendentes`} />
              <MetricCard title="Automações" primary={`${formatNumber(metrics.automations.authenticationErrors)} erros de acesso`} detail={`${metrics.automations.configurationErrors} erros de configuração`} />
              <MetricCard title="Autenticação" primary={`${formatNumber(metrics.authentication.activeSessions)} sessões ativas`} detail={`${metrics.authentication.verifiedUsers} usuários verificados · ${metrics.authentication.pendingVerificationUsers} pendentes`} />
              <MetricCard title="Cobrança" primary={`${formatNumber(metrics.billing.counts.FAILED)} eventos falhos`} detail={`${metrics.billing.counts.PENDING} pendentes · ${metrics.billing.counts.PROCESSED} processados`} />
              <MetricCard title="Fila de DMs" primary={`${formatNumber(snapshot.services.queue.counts.waiting + snapshot.services.queue.counts.active)} em processamento`} detail={`${snapshot.services.queue.counts.delayed} agendados · ${snapshot.services.queue.counts.failed} falhos${snapshot.services.queue.truncated ? " · leitura limitada" : ""}`} />
            </div>
          ) : (
            <div className="panel rounded p-6 text-center text-sm text-muted">As métricas persistidas estão temporariamente indisponíveis.</div>
          )}

          {metrics && (
            <div className="panel overflow-hidden rounded">
              <div className="border-b border-border px-4 py-4 sm:px-5">
                <h3 className="text-sm font-semibold text-foreground">Empresas que precisam de atenção</h3>
                <p className="mt-0.5 text-xs text-muted">Prioridade calculada apenas por contagens de incidentes, sem conteúdo de clientes.</p>
              </div>
              {metrics.incidentWorkspaces.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted">Nenhuma empresa possui incidente no período selecionado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-5 py-3 font-semibold">Empresa</th><th className="px-3 py-3 font-semibold">Entrega</th><th className="px-3 py-3 font-semibold">Operação</th><th className="px-3 py-3 font-semibold">Integração</th><th className="px-3 py-3 font-semibold">Cobrança</th><th className="px-5 py-3 text-right font-semibold">Prioridade</th>
                    </tr></thead>
                    <tbody>{metrics.incidentWorkspaces.map((workspace) => (
                      <tr key={workspace.workspaceId} className="border-b border-border last:border-0">
                        <td className="px-5 py-3"><p className="font-semibold text-foreground">{workspace.name}</p>{workspace.archived && <p className="text-xs text-muted">Arquivada</p>}</td>
                        <td className="px-3 py-3 text-xs text-muted">{workspace.webhookFailures} webhooks · {workspace.deliveryFailures} DMs</td>
                        <td className="px-3 py-3 text-xs text-muted">{workspace.operationalErrors} erros · {workspace.authenticationErrors} de acesso</td>
                        <td className="px-3 py-3 text-xs text-muted">{workspace.expiredTokens} tokens · {workspace.pendingWebhooks} inscrições</td>
                        <td className="px-3 py-3 text-xs text-muted">{workspace.billingProblems} ocorrências</td>
                        <td className="px-5 py-3 text-right font-semibold text-foreground">{workspace.score}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!snapshot && loading && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Carregando operação">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-zinc-100" />)}</div>}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";
import { formatDateTime } from "@/lib/i18n";

interface DiagnosticsData {
  services: {
    database: { available: boolean };
    redis: { available: boolean };
    worker: { available: boolean };
  };
  queue: {
    status: "IDLE" | "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNAVAILABLE";
    counts: Record<string, number>;
    oldestWaitingAt: string | null;
    oldestWaitingAgeMs: number | null;
    nextDelayedAt: string | null;
    truncated: boolean;
    scanLimit: number;
    checkedAt: string;
  };
  queueCounts: Record<string, number>;
  workerHealth: {
    healthy: boolean;
    ageMs: number | null;
    heartbeat: {
      checkedAt: string;
      hostname?: string;
      pid: number;
      startedAt?: string;
    } | null;
  };
  workerAlerts: Array<{
    level: string;
    message: string;
    jobId?: string;
    commentId?: string;
    createdAt: string;
  }>;
  webhookFailures: Array<{
    id: string;
    object: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  dmFailures: Array<{
    id: string;
    status: string;
    commentId: string;
    commentText: string;
    errorMessage: string | null;
    updatedAt: string;
    automation: { name: string };
  }>;
  tokenRefreshFailures: Array<{
    id: string;
    message: string;
    createdAt: string;
  }>;
  operationalEvents: Array<{
    id: string;
    source: string;
    level: string;
    message: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

function formatDate(value: string) {
  return formatDateTime(value);
}

const queueLabels: Record<string, string> = {
  waiting: "aguardando",
  active: "em processamento",
  delayed: "agendadas",
  failed: "com falha",
};

const queueHealthLabels = {
  IDLE: "Sem pendências",
  HEALTHY: "Fluxo normal",
  DEGRADED: "Fila atrasada",
  CRITICAL: "Atraso crítico",
  UNAVAILABLE: "Indisponível",
};

function formatDuration(value: number | null) {
  if (value == null) return "Sem espera";
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  return `${Math.round(minutes / 60)}h`;
}

function EmptyState({ label }: { label: string }) {
  return <p className="py-5 text-center text-sm text-muted">{label}</p>;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel rounded p-4 sm:p-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/diagnostics", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível atualizar o diagnóstico");
      }
      setData(payload.data);
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Não foi possível atualizar o diagnóstico"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshDiagnostics(), 0);
    const interval = window.setInterval(
      () => void refreshDiagnostics(),
      30_000
    );
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refreshDiagnostics]);

  if (loading && !data) {
    return <div className="panel rounded p-8 h-64" />;
  }

  const workerAgeSeconds =
    data?.workerHealth.ageMs == null
      ? null
      : Math.round(data.workerHealth.ageMs / 1000);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Diagnóstico da operação
          </h1>
          <p className="mt-1 text-sm text-muted">
            Saúde dos serviços, filas, webhooks, eventos e alertas do worker.
          </p>
          {data?.queue.checkedAt && (
            <p className="mt-1 text-xs text-muted">
              Atualização automática a cada 30s · última verificação {formatDate(data.queue.checkedAt)}
            </p>
          )}
        </div>
        <button
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void refreshDiagnostics();
          }}
          className="rounded border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground transition hover:border-border-hover"
        >
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-error/25 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="panel rounded p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase text-muted">
            Saúde do worker
          </p>
          <p
            className={`mt-3 text-2xl font-bold ${
              data?.workerHealth.healthy ? "text-success" : "text-warning"
            }`}
          >
            {data?.workerHealth.healthy ? "Saudável" : "Precisa de atenção"}
          </p>
          <p className="mt-2 text-xs text-muted">
            {workerAgeSeconds == null
              ? "Nenhum sinal de atividade encontrado"
              : `Último sinal há ${workerAgeSeconds}s`}
          </p>
        </div>
        <div className="panel rounded p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase text-muted">
            Conexão Redis
          </p>
          <p
            className={`mt-3 text-2xl font-bold ${
              data?.services.redis.available ? "text-success" : "text-error"
            }`}
          >
            {data?.services.redis.available ? "Disponível" : "Indisponível"}
          </p>
          <p className="mt-2 text-xs text-muted">
            Filas, alertas e heartbeat do worker
          </p>
        </div>
        <div className="panel rounded p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase text-muted">
            Atraso da fila
          </p>
          <p
            className={`mt-3 text-2xl font-bold ${
              data?.queue.status === "CRITICAL" ||
              data?.queue.status === "UNAVAILABLE"
                ? "text-error"
                : data?.queue.status === "DEGRADED"
                  ? "text-warning"
                  : "text-success"
            }`}
          >
            {data ? queueHealthLabels[data.queue.status] : "—"}
          </p>
          <p className="mt-2 text-xs text-muted">
            Mais antigo: {formatDuration(data?.queue.oldestWaitingAgeMs ?? null)}
          </p>
          {data?.queue.nextDelayedAt && (
            <p className="mt-1 text-xs text-muted">
              Próximo agendado: {formatDate(data.queue.nextDelayedAt)}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {["waiting", "active", "delayed", "failed"].map((key) => (
          <div key={key} className="panel rounded p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase text-muted">
              Fila: {queueLabels[key] ?? key}
            </p>
            <p className="mt-3 text-2xl font-bold text-foreground">
              {data?.queueCounts[key] ?? 0}
            </p>
          </div>
        ))}
      </div>

      {data?.queue.truncated && (
        <p className="rounded border border-warning/25 bg-warning/10 px-4 py-3 text-xs text-warning">
          A fila ultrapassou a amostra de {data.queue.scanLimit} jobs por estado.
          As contagens desta empresa são um limite inferior.
        </p>
      )}

      <Section title="Alertas recentes do worker">
        {data?.workerAlerts.length ? (
          <div className="space-y-3">
            {data.workerAlerts.map((alert) => (
              <div
                key={`${alert.createdAt}-${alert.jobId ?? alert.message}`}
                className="rounded border border-border bg-surface/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 break-words text-sm font-semibold text-foreground">
                    {alert.message}
                  </p>
                  <span className="shrink-0 rounded-full bg-error/10 px-2 py-1 text-xs font-semibold text-error">
                    {alert.level === "error" ? "erro" : "aviso"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {formatDate(alert.createdAt)}
                  {alert.commentId ? ` · ${alert.commentId}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState label="Nenhum alerta do worker registrado." />
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Falhas e mensagens ignoradas">
          <div className="mb-3 flex justify-end">
            <Link href="/logs" className="text-xs font-semibold text-accent hover:underline">
              Abrir todos os envios
            </Link>
          </div>
          {data?.dmFailures.length ? (
            <div className="space-y-3">
              {data.dmFailures.map((item) => (
                <div key={item.id} className="border-b border-border pb-3 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {item.automation.name}
                    </p>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {item.commentText}
                  </p>
                  {item.errorMessage && (
                    <p className="mt-1 text-xs text-error">{item.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="Nenhuma falha ou mensagem ignorada." />
          )}
        </Section>

        <Section title="Falhas de webhook">
          {data?.webhookFailures.length ? (
            <div className="space-y-3">
              {data.webhookFailures.map((event) => (
                <div key={event.id} className="border-b border-border pb-3 last:border-0">
                  <p className="text-sm font-semibold text-foreground">
                    {event.object ?? "Instagram webhook"}
                  </p>
                  <p className="mt-1 text-xs text-error">
                    {event.errorMessage ?? "Erro desconhecido"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(event.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="Nenhuma falha de webhook." />
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Falhas ao renovar tokens">
          {data?.tokenRefreshFailures.length ? (
            <div className="space-y-3">
              {data.tokenRefreshFailures.map((event) => (
                <div key={event.id} className="border-b border-border pb-3 last:border-0">
                  <p className="text-sm font-semibold text-foreground">
                    {event.message}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(event.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="Nenhuma falha de renovação de token." />
          )}
        </Section>

      </div>

      <Section title="Linha do tempo operacional">
        {data?.operationalEvents.length ? (
          <div className="space-y-3">
            {data.operationalEvents.map((event) => (
              <div key={event.id} className="grid gap-2 border-b border-border pb-3 last:border-0 sm:grid-cols-[140px_1fr_auto]">
                <p className="text-xs font-semibold text-muted">{event.source}</p>
                <p className="text-sm text-foreground">{event.message}</p>
                <p className="text-xs text-muted">{formatDate(event.createdAt)}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState label="Nenhum evento operacional registrado." />
        )}
      </Section>
    </div>
  );
}

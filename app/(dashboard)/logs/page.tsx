"use client";

/**
 * DM Logs Page
 *
 * Filterable, paginated table of DM logs.
 */

import { useEffect, useState, useCallback } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatusBadge from "@/components/status-badge";
import { formatDateTime, translate } from "@/lib/i18n";

interface DmLog {
  id: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  status: string;
  errorMessage: string | null;
  triggerType: "COMMENT" | "MESSAGE" | "POSTBACK";
  manualRetryCount: number;
  lastManualRetryAt: string | null;
  createdAt: string;
  automation: { name: string; keywords: string[] };
  instagramAccount: { username: string };
  retry: { allowed: boolean; reason: string | null };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_FILTERS = [
  "ALL",
  "SENT",
  "FAILED",
  "PENDING",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
  "SKIPPED_DEDUP",
  "SKIPPED_HUMAN_REVIEW",
];

const STATUS_FILTER_LABELS: Record<string, string> = {
  ALL: translate("common.all"),
  SENT: translate("status.sent"),
  FAILED: translate("status.failed"),
  PENDING: translate("status.pending"),
  SKIPPED_RATE_LIMIT: translate("status.rateLimited"),
  SKIPPED_PLAN_LIMIT: translate("status.planLimited"),
  SKIPPED_DEDUP: translate("status.deduplicated"),
  SKIPPED_HUMAN_REVIEW: translate("status.humanReview"),
};

export default function LogsPage() {
  const [logs, setLogs] = useState<DmLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [page, setPage] = useState(1);
  const [canManageRetries, setCanManageRetries] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }

      const res = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Não foi possível carregar os envios");
      }
      setLogs(data.data.logs);
      setPagination(data.data.pagination);
      setCanManageRetries(data.data.canManageRetries);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setError(
        err instanceof Error ? err.message : "Não foi possível carregar os envios"
      );
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, selectedAccountId]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchLogs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs]);

  function handleFilterChange(status: string) {
    setLoading(true);
    setStatusFilter(status);
    setPage(1);
  }

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
    setPage(1);
  }

  async function retryLog(log: DmLog) {
    setRetryingId(log.id);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/logs/${log.id}/retry`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível reprocessar o envio");
      }
      setNotice("Reprocessamento enviado para a fila com segurança.");
      await fetchLogs();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível reprocessar o envio"
      );
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="panel rounded p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Operação segura
        </p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          Envios e reprocessamento
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Reprocesse somente falhas que pararam antes da entrega à Meta. Quando
          o resultado do envio é incerto, o ReplyFlow bloqueia a ação para não
          duplicar mensagens para o contato.
        </p>
      </div>

      {notice && (
        <div className="rounded border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              onClick={() => handleFilterChange(status)}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${
                  statusFilter === status
                    ? "bg-accent/15 text-accent border border-accent/20"
                    : "bg-surface text-muted border border-border hover:border-border-hover hover:text-foreground"
                }
              `}
            >
              {STATUS_FILTER_LABELS[status] ?? status}
            </button>
          ))}
        </div>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={handleAccountChange}
          />
        )}
      </div>

      {/* Table */}
      <div className="panel rounded overflow-hidden">
        {/* Seven columns don't fit a phone; the table keeps its width and scrolls
            horizontally inside the panel rather than crushing every cell. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">Contato</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">Origem</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">Automação</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">Conta</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">Status</th>
                <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">Data</th>
                <th className="px-4 py-4 text-right text-xs font-semibold text-muted uppercase tracking-wider sm:px-6">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7} className="px-4 py-4 sm:px-6">
                        <div className="h-4 bg-surface-hover rounded" />
                      </td>
                    </tr>
                  ))}
                </>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted sm:px-6">
                    Nenhum envio encontrado
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-hover/50 transition-colors">
                    <td className="px-4 py-4 sm:px-6">
                      <span className="font-medium text-foreground">
                        @{log.commenterName ?? log.commenterId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-4 max-w-[200px] sm:px-6">
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
                        {log.triggerType === "MESSAGE"
                          ? "Mensagem recebida"
                          : log.triggerType === "POSTBACK"
                            ? "Clique em botão"
                            : "Comentário"}
                      </span>
                      <span className="text-muted truncate block" title={log.commentText}>
                        {log.commentText}
                      </span>
                    </td>
                    <td className="px-4 py-4 sm:px-6">
                      <span className="text-muted">{log.automation.name}</span>
                    </td>
                    <td className="px-4 py-4 sm:px-6">
                      <span className="text-muted">@{log.instagramAccount.username}</span>
                    </td>
                    <td className="px-4 py-4 sm:px-6">
                      <StatusBadge status={log.status} />
                      {log.errorMessage && (
                        <span
                          className="mt-1 block max-w-[210px] truncate text-xs text-red-300/80"
                          title={log.errorMessage}
                        >
                          {log.errorMessage}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-muted whitespace-nowrap sm:px-6">
                      {formatDateTime(log.createdAt, {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {log.manualRetryCount > 0 && (
                        <span className="mt-1 block text-[11px] text-muted">
                          {log.manualRetryCount} reprocessamento
                          {log.manualRetryCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right sm:px-6">
                      {canManageRetries && (
                        <button
                          type="button"
                          disabled={!log.retry.allowed || retryingId === log.id}
                          onClick={() => void retryLog(log)}
                          title={log.retry.reason ?? "Reprocessar este envio"}
                          className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {retryingId === log.id ? "Enfileirando..." : "Reprocessar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 border-t border-border sm:px-6">
            <p className="text-xs text-muted">
              Exibindo {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} de{" "}
              {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true);
                  setPage(page - 1);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:text-foreground hover:border-border-hover transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                {translate("common.previous")}
              </button>
              <span className="text-xs text-muted px-2">
                {page} / {pagination.totalPages}
              </span>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => {
                  setLoading(true);
                  setPage(page + 1);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:text-foreground hover:border-border-hover transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                {translate("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

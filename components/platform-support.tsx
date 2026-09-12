"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime, formatNumber } from "@/lib/i18n";

type SupportStatus =
  | "ALL"
  | "FAILED"
  | "SKIPPED_RATE_LIMIT"
  | "SKIPPED_PLAN_LIMIT"
  | "SKIPPED_HUMAN_REVIEW";

type SupportIncident = {
  id: string;
  workspace: { id: string; name: string };
  automation: { id: string; name: string };
  instagramAccount: { id: string; username: string };
  status: Exclude<SupportStatus, "ALL">;
  failureLabel: string;
  triggerType: "COMMENT" | "MESSAGE" | "POSTBACK";
  deliveryState: "AMBIGUOUS" | "NOT_ATTEMPTED";
  retry: { allowed: boolean; reason: string | null };
  manualRetryCount: number;
  lastManualRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SupportData = {
  generatedAt: string;
  readiness: {
    queueAvailable: boolean;
    workerHealthy: boolean;
    workerAgeMs: number | null;
    lastSeenAt: string | null;
  };
  summary: {
    total: number;
    retryableOnPage: number;
    blockedOnPage: number;
  };
  incidents: SupportIncident[];
  nextCursor: string | null;
};

type ApiPayload<T> = { success: boolean; data?: T; error?: string };

const STATUS_OPTIONS: Array<{ value: SupportStatus; label: string }> = [
  { value: "ALL", label: "Todas as falhas" },
  { value: "FAILED", label: "Falhas" },
  { value: "SKIPPED_RATE_LIMIT", label: "Limite da Meta" },
  { value: "SKIPPED_PLAN_LIMIT", label: "Limite do plano" },
  { value: "SKIPPED_HUMAN_REVIEW", label: "Revisão humana" },
];

const TRIGGER_LABELS = {
  COMMENT: "Comentário",
  MESSAGE: "Mensagem recebida",
  POSTBACK: "Clique em botão",
} as const;

const fieldClass =
  "h-11 rounded-xl border border-[#cfccc3] bg-[#fffdf8] px-3 text-sm text-[#112620] outline-none transition focus:border-[#b48713] focus:ring-2 focus:ring-[#e8c65f]/25";

class SupportRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function fetchSupport(params: URLSearchParams, signal?: AbortSignal) {
  const response = await fetch(`/api/platform/support?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json()) as ApiPayload<SupportData>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new SupportRequestError(
      payload.error ?? "Não foi possível carregar a central de suporte",
      response.status
    );
  }
  return payload.data;
}

function readinessText(data: SupportData) {
  if (!data.readiness.queueAvailable) return "Redis indisponível";
  if (!data.readiness.workerHealthy) return "Worker sem heartbeat";
  return "Fila pronta para receber um envio";
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dad4c8] bg-[#fffdf8] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6c7772]">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl text-[#112620]">
        {formatNumber(value)}
      </p>
      <p className="mt-1 text-xs text-[#6c7772]">{detail}</p>
    </div>
  );
}

export default function PlatformSupport() {
  const router = useRouter();
  const [data, setData] = useState<SupportData | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<{ q: string; status: SupportStatus }>({
    q: "",
    status: "ALL",
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SupportIncident | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ status: filters.status, limit: "20" });
    if (filters.q) params.set("q", filters.q);

    fetchSupport(params, controller.signal)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (
          loadError instanceof SupportRequestError &&
          (loadError.status === 401 || loadError.status === 403)
        ) {
          router.replace(loadError.status === 401 ? "/login?callbackUrl=%2Fadmin" : "/dashboard");
          router.refresh();
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Não foi possível carregar a central de suporte"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters, refreshKey, router]);

  async function loadMore(cursor: string) {
    const params = new URLSearchParams({ status: filters.status, limit: "20", cursor });
    if (filters.q) params.set("q", filters.q);
    setLoadingMore(true);
    try {
      const next = await fetchSupport(params);
      setData((current) =>
        current
          ? {
              ...next,
              incidents: [...current.incidents, ...next.incidents],
              summary: {
                ...current.summary,
                retryableOnPage:
                  current.summary.retryableOnPage + next.summary.retryableOnPage,
                blockedOnPage:
                  current.summary.blockedOnPage + next.summary.blockedOnPage,
              },
            }
          : next
      );
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar mais ocorrências"
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = searchInput.trim();
    if (q === filters.q) return;
    setLoading(true);
    setFilters((current) => ({ ...current, q }));
  }

  function changeStatus(status: SupportStatus) {
    if (status === filters.status) return;
    setLoading(true);
    setFilters((current) => ({ ...current, status }));
  }

  function openConfirmation(incident: SupportIncident) {
    setConfirming(incident);
    setConfirmation("");
    setError(null);
    setNotice(null);
  }

  function closeConfirmation() {
    if (submitting) return;
    setConfirming(null);
    setConfirmation("");
  }

  async function retryIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirming || confirmation.trim() !== confirming.workspace.name) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/platform/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: confirming.workspace.id,
          logId: confirming.id,
          confirmation,
        }),
      });
      const payload = (await response.json()) as ApiPayload<unknown>;
      if (!response.ok || !payload.success) {
        throw new SupportRequestError(
          payload.error ?? "Não foi possível reprocessar o envio",
          response.status
        );
      }
      const campaignName = confirming.automation.name;
      setConfirming(null);
      setConfirmation("");
      setNotice(`“${campaignName}” entrou na fila com auditoria de suporte.`);
      setLoading(true);
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível reprocessar o envio"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const operationallyReady = Boolean(
    data?.readiness.queueAvailable && data.readiness.workerHealthy
  );

  useEffect(() => {
    if (!confirming) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        setConfirming(null);
        setConfirmation("");
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [confirming, submitting]);

  return (
    <section
      className="overflow-hidden rounded-3xl border border-[#294b40] bg-[#f6f1e7] shadow-[0_22px_70px_rgba(17,38,32,0.08)]"
      aria-labelledby="platform-support-title"
    >
      <div className="grid gap-6 bg-[#112620] px-5 py-7 text-white sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-9">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f5c451]">
            Mesa de intervenção
          </p>
          <h2 id="platform-support-title" className="mt-2 font-display text-3xl sm:text-4xl">
            Suporte sem entrar na conta do cliente.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#b8cbc3]">
            Investigue somente metadados operacionais. Um reenvio exige causa corrigida,
            worker saudável e confirmação pelo nome da empresa — nunca há ação em lote.
          </p>
        </div>
        <div
          className={`rounded-2xl border px-4 py-3 ${
            operationallyReady
              ? "border-[#71b99d]/30 bg-[#1d6b52]/35"
              : "border-[#e6a187]/30 bg-[#8b3f2c]/35"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#b8cbc3]">
            Trava operacional
          </p>
          <p className="mt-1 text-sm font-semibold">
            {data ? readinessText(data) : "Verificando infraestrutura…"}
          </p>
        </div>
      </div>

      <div className="space-y-5 p-5 sm:p-7 lg:p-9">
        {(notice || error) && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              error
                ? "border-[#d98f78] bg-[#fff5ef] text-[#8a321e]"
                : "border-[#8bc4ae] bg-[#edf8f3] text-[#165d47]"
            }`}
            role={error ? "alert" : "status"}
          >
            {error ?? notice}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Ocorrências" value={data?.summary.total ?? 0} detail="nos filtros atuais" />
          <SummaryCard label="Elegíveis" value={data?.summary.retryableOnPage ?? 0} detail="nesta página" />
          <SummaryCard label="Protegidas" value={data?.summary.blockedOnPage ?? 0} detail="reenvio bloqueado" />
          <SummaryCard label="Ações em lote" value={0} detail="sempre desativadas" />
        </div>

        <form onSubmit={applySearch} className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_210px_auto_auto] md:items-end">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#596760]">
            Empresa, campanha ou conta
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              maxLength={80}
              placeholder="Buscar sem conteúdo de contatos"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#596760]">
            Tipo de ocorrência
            <select value={filters.status} onChange={(event) => changeStatus(event.target.value as SupportStatus)} className={fieldClass}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button type="submit" className="h-11 rounded-xl bg-[#b48713] px-4 text-sm font-bold text-white transition hover:bg-[#956f0d]">Buscar</button>
          <button
            type="button"
            disabled={loading}
            onClick={() => { setLoading(true); setRefreshKey((key) => key + 1); }}
            className="h-11 rounded-xl border border-[#cfccc3] bg-[#fffdf8] px-4 text-sm font-semibold text-[#112620] transition hover:border-[#9d978c] disabled:opacity-60"
          >
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </form>

        <div className="overflow-hidden rounded-2xl border border-[#d7d0c2] bg-[#fffdf8]">
          <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-[#ded8cd] px-4 py-3 sm:px-5">
            <div>
              <h3 className="text-sm font-semibold text-[#112620]">Fila de investigação</h3>
              <p className="mt-0.5 text-xs text-[#6c7772]">Sem nomes de contatos, comentários, mensagens ou tokens.</p>
            </div>
            {data && <p className="self-center text-xs text-[#6c7772]">{formatDateTime(data.generatedAt, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>}
          </div>

          {loading ? (
            <div className="space-y-3 p-5" aria-label="Carregando ocorrências de suporte">
              {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-[#eee9df]" />)}
            </div>
          ) : !data || data.incidents.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="font-display text-2xl text-[#112620]">Mesa limpa.</p>
              <p className="mt-1 text-sm text-[#6c7772]">Nenhuma ocorrência corresponde aos filtros.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#ded8cd]">
              {data.incidents.map((incident) => {
                const canRetry = operationallyReady && incident.retry.allowed;
                return (
                  <article key={incident.id} className="grid gap-4 px-4 py-5 sm:px-5 xl:grid-cols-[minmax(230px,1fr)_minmax(190px,0.8fr)_minmax(240px,1fr)_auto] xl:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold text-[#112620]">{incident.workspace.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${incident.retry.allowed ? "bg-[#daf0e6] text-[#16634c]" : "bg-[#f5dfd7] text-[#8a321e]"}`}>
                          {incident.retry.allowed ? "Elegível" : "Protegido"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-[#6c7772]">{incident.automation.name} · @{incident.instagramAccount.username}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#384b43]">{incident.failureLabel}</p>
                      <p className="mt-1 text-xs text-[#6c7772]">{TRIGGER_LABELS[incident.triggerType]} · {formatDateTime(incident.createdAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                    <div className="rounded-xl bg-[#f4efe6] px-3 py-2.5 text-xs leading-5 text-[#596760]">
                      {incident.retry.allowed
                        ? "Parou antes da entrega à Meta; a origem persistida permite reconstrução."
                        : incident.retry.reason}
                      {incident.manualRetryCount > 0 && (
                        <span className="mt-1 block font-semibold text-[#384b43]">
                          {incident.manualRetryCount} reprocessamento{incident.manualRetryCount === 1 ? "" : "s"} anterior{incident.manualRetryCount === 1 ? "" : "es"}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!canRetry}
                      onClick={() => openConfirmation(incident)}
                      title={!operationallyReady ? "Restaure Redis e worker antes de reprocessar" : incident.retry.reason ?? "Reprocessar um único envio"}
                      className="w-fit rounded-xl bg-[#112620] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#28463c] disabled:cursor-not-allowed disabled:bg-[#c7c4bc] disabled:text-[#73736f] xl:justify-self-end"
                    >
                      Reprocessar um
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          {data?.nextCursor && (
            <div className="border-t border-[#ded8cd] px-5 py-4 text-center">
              <button type="button" disabled={loadingMore} onClick={() => void loadMore(data.nextCursor as string)} className="rounded-xl border border-[#cfccc3] px-4 py-2 text-sm font-semibold text-[#112620] transition hover:border-[#9d978c] disabled:opacity-60">
                {loadingMore ? "Carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#071510]/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="support-confirmation-title" aria-describedby="support-confirmation-description">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-[#d6cdbd] bg-[#fffdf8] shadow-[0_28px_100px_rgba(0,0,0,0.35)]">
            <div className="border-b border-[#ded8cd] bg-[#fff4dc] px-6 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9a7310]">Confirmação de alto impacto</p>
              <h3 id="support-confirmation-title" className="mt-2 font-display text-3xl text-[#112620]">Um envio. Uma empresa.</h3>
            </div>
            <form onSubmit={retryIncident} className="space-y-5 p-6">
              <p id="support-confirmation-description" className="text-sm leading-6 text-[#596760]">
                O ReplyFlow reconstruirá somente o evento selecionado e registrará seu usuário na auditoria de <strong className="text-[#112620]">{confirming.workspace.name}</strong>. A mensagem poderá ser entregue pela Meta assim que entrar na fila.
              </p>
              <label className="block text-xs font-semibold text-[#596760]">
                Digite <span className="font-mono text-[#112620]">{confirming.workspace.name}</span> para confirmar
                <input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className={`mt-2 w-full ${fieldClass}`} />
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" disabled={submitting} onClick={closeConfirmation} className="rounded-xl border border-[#cfccc3] px-4 py-2.5 text-sm font-semibold text-[#384b43] disabled:opacity-60">Cancelar</button>
                <button type="submit" disabled={submitting || confirmation.trim() !== confirming.workspace.name} className="rounded-xl bg-[#b44930] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#963923] disabled:cursor-not-allowed disabled:opacity-40">
                  {submitting ? "Enfileirando…" : "Confirmar reprocessamento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

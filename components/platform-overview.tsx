"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatNumber } from "@/lib/i18n";

type PlatformWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  archivedAt: string | null;
  owner: { id: string; name: string | null; email: string | null };
  subscription: {
    provider: string;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    plan: {
      code: string;
      name: string;
      currency: string;
      monthlyPriceCents: number | null;
      monthlyDmLimit: number;
      instagramAccounts: number;
      members: number;
    };
  } | null;
  usage: { quantity: number; periodStart: string; periodEnd: string } | null;
  resources: { instagramAccounts: number; members: number; automations: number };
  alerts: { expiredTokens: number; pendingWebhooks: number };
};

type PlatformOverviewData = {
  generatedAt: string;
  summary: {
    workspaces: { filtered: number; active: number; archived: number };
    users: number;
    instagramAccounts: number;
    dmsSentThisMonth: number;
    subscriptionsByPlan: Record<string, number>;
    subscriptionsByStatus: Record<string, number>;
  };
  workspaces: PlatformWorkspace[];
  nextCursor: string | null;
};

const statusLabels: Record<string, string> = {
  TRIALING: "Em teste",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
  INCOMPLETE: "Incompleta",
};

const fieldClass =
  "rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-[#d9a91e]";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="panel rounded p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(value)}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

export default function PlatformOverview({ adminName }: { adminName: string | null }) {
  const [data, setData] = useState<PlatformOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({ q: "", plan: "", status: "", archived: "active" });

  useEffect(() => {
    const params = new URLSearchParams({ archived: filters.archived, limit: "20" });
    if (filters.q) params.set("q", filters.q);
    if (filters.plan) params.set("plan", filters.plan);
    if (filters.status) params.set("status", filters.status);
    const controller = new AbortController();

    fetch(`/api/platform/overview?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Não foi possível carregar a administração");
        }
        setData(payload.data as PlatformOverviewData);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Não foi possível carregar a administração"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters]);

  async function loadMore(cursor: string) {
    const params = new URLSearchParams({
      archived: filters.archived,
      limit: "20",
      cursor,
    });
    if (filters.q) params.set("q", filters.q);
    if (filters.plan) params.set("plan", filters.plan);
    if (filters.status) params.set("status", filters.status);

    setLoadingMore(true);
    try {
      const response = await fetch(`/api/platform/overview?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível carregar mais clientes");
      }
      const next = payload.data as PlatformOverviewData;
      setData((current) =>
        current
          ? { ...next, workspaces: [...current.workspaces, ...next.workspaces] }
          : next
      );
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar mais clientes"
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = searchInput.trim();
    if (q === filters.q) return;
    setLoading(true);
    setFilters((current) => ({ ...current, q }));
  }

  function changeFilter(key: "plan" | "status" | "archived", value: string) {
    if (filters[key] === value) return;
    setLoading(true);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a7310]">
          Operação ReplyFlow
        </p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Administração da plataforma</h1>
        <p className="mt-1 text-sm text-muted">
          Visão global somente leitura{adminName ? ` para ${adminName}` : ""}. Nenhuma ação altera clientes ou planos.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Empresas ativas" value={data.summary.workspaces.active} detail={`${data.summary.workspaces.archived} arquivadas`} />
          <SummaryCard label="Usuários" value={data.summary.users} detail="cadastros na plataforma" />
          <SummaryCard label="Contas Instagram" value={data.summary.instagramAccounts} detail="conexões cadastradas" />
          <SummaryCard label="DMs neste mês" value={data.summary.dmsSentThisMonth} detail="uso consolidado" />
        </div>
      )}

      <div className="panel rounded p-4 sm:p-5">
        <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_150px_190px_150px_auto]">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Buscar cliente ou proprietário
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              maxLength={80}
              placeholder="Nome ou e-mail"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Plano
            <select value={filters.plan} onChange={(event) => changeFilter("plan", event.target.value)} className={fieldClass}>
              <option value="">Todos</option>
              <option value="FREE">Free</option>
              <option value="PRO">Pro</option>
              <option value="AGENCY">Agency</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Assinatura
            <select value={filters.status} onChange={(event) => changeFilter("status", event.target.value)} className={fieldClass}>
              <option value="">Todas</option>
              <option value="TRIALING">Em teste</option>
              <option value="ACTIVE">Ativa</option>
              <option value="PAST_DUE">Pagamento pendente</option>
              <option value="CANCELED">Cancelada</option>
              <option value="INCOMPLETE">Incompleta</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Empresas
            <select value={filters.archived} onChange={(event) => changeFilter("archived", event.target.value)} className={fieldClass}>
              <option value="active">Ativas</option>
              <option value="archived">Arquivadas</option>
              <option value="all">Todas</option>
            </select>
          </label>
          <button type="submit" className="self-end rounded-xl bg-[#18342b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#23483c]">
            Buscar
          </button>
        </form>
      </div>

      <div className="panel overflow-hidden rounded">
        <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Clientes e consumo</h2>
            <p className="mt-0.5 text-xs text-muted">
              {data ? `${formatNumber(data.summary.workspaces.filtered)} resultados` : "Carregando dados"}
            </p>
          </div>
          {data && <span className="text-xs text-muted">Atualizado em {new Date(data.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>

        {loading ? (
          <div className="space-y-3 p-5" aria-label="Carregando clientes">
            {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-zinc-100" />)}
          </div>
        ) : !data || data.workspaces.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">Nenhuma empresa encontrada com estes filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-semibold">Empresa</th>
                  <th className="px-3 py-3 font-semibold">Plano</th>
                  <th className="px-3 py-3 font-semibold">Uso</th>
                  <th className="px-3 py-3 font-semibold">Recursos</th>
                  <th className="px-3 py-3 font-semibold">Alertas</th>
                  <th className="px-5 py-3 text-right font-semibold">Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {data.workspaces.map((workspace) => {
                  const usage = workspace.usage?.quantity ?? 0;
                  const limit = workspace.subscription?.plan.monthlyDmLimit ?? 0;
                  return (
                    <tr key={workspace.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-foreground">{workspace.name}</p>
                        <p className="mt-0.5 text-xs text-muted">{workspace.owner.name ?? "Sem nome"} · {workspace.owner.email ?? "sem e-mail"}</p>
                        {workspace.archivedAt && <span className="mt-1 inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">Arquivada</span>}
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-semibold text-foreground">{workspace.subscription?.plan.name ?? "Sem assinatura"}</p>
                        <p className="mt-0.5 text-xs text-muted">{workspace.subscription ? statusLabels[workspace.subscription.status] ?? workspace.subscription.status : "Configuração pendente"}</p>
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-semibold text-foreground">{formatNumber(usage)} / {limit ? formatNumber(limit) : "—"}</p>
                        <p className="mt-0.5 text-xs text-muted">DMs · período desde {formatDate(workspace.usage?.periodStart ?? null)}</p>
                      </td>
                      <td className="px-3 py-4 text-xs text-muted">
                        <p>{workspace.resources.instagramAccounts} Instagram</p>
                        <p>{workspace.resources.members} membros · {workspace.resources.automations} automações</p>
                      </td>
                      <td className="px-3 py-4 text-xs">
                        {workspace.alerts.expiredTokens === 0 && workspace.alerts.pendingWebhooks === 0 ? (
                          <span className="text-emerald-700">Sem alertas</span>
                        ) : (
                          <div className="text-amber-800">
                            {workspace.alerts.expiredTokens > 0 && <p>{workspace.alerts.expiredTokens} tokens expirados</p>}
                            {workspace.alerts.pendingWebhooks > 0 && <p>{workspace.alerts.pendingWebhooks} webhooks pendentes</p>}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right text-xs text-muted">{formatDate(workspace.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data?.nextCursor && (
          <div className="border-t border-border p-4 text-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore(data.nextCursor!)}
              className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-zinc-50 disabled:opacity-60"
            >
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="panel rounded p-4">
            <h3 className="text-sm font-semibold text-foreground">Assinaturas por plano</h3>
            <p className="mt-2 text-sm text-muted">Free {data.summary.subscriptionsByPlan.FREE ?? 0} · Pro {data.summary.subscriptionsByPlan.PRO ?? 0} · Agency {data.summary.subscriptionsByPlan.AGENCY ?? 0}</p>
          </div>
          <div className="panel rounded p-4">
            <h3 className="text-sm font-semibold text-foreground">Saúde financeira</h3>
            <p className="mt-2 text-sm text-muted">{data.summary.subscriptionsByStatus.ACTIVE ?? 0} ativas · {data.summary.subscriptionsByStatus.PAST_DUE ?? 0} pendentes · {data.summary.subscriptionsByStatus.CANCELED ?? 0} canceladas</p>
          </div>
        </div>
      )}
    </div>
  );
}

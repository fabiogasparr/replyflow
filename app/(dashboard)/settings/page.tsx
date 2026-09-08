"use client";

import { Suspense, useEffect, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import WorkspaceManager from "@/components/workspace-manager";
import WorkspaceAuditLog from "@/components/workspace-audit-log";
import { formatNumber } from "@/lib/i18n";

interface SettingsData {
  workspace: {
    name: string;
    plan: "FREE" | "PRO" | "AGENCY";
    planLabel: string;
    billingReady: boolean;
    limits: {
      instagramAccounts: number;
      members: number;
    };
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    id: string;
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  instagramAccounts: Array<
    AccountOption & {
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserId: string;
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    inviteUrl: string;
    expiresAt: string;
  }>;
}

interface BillingOverviewData {
  plan: {
    code: "FREE" | "PRO" | "AGENCY";
    name: string;
    currency: string;
    monthlyPriceCents: number | null;
    monthlyDmLimit: number;
    instagramAccounts: number;
    members: number;
  };
  subscription: {
    provider: "MANUAL" | "MERCADO_PAGO" | "STRIPE";
    status: string;
    statusLabel: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
  };
  usage: {
    used: number;
    limit: number;
    remaining: number;
    percentage: number;
  };
  checkoutAvailable: boolean;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    null
  );
  const [billingData, setBillingData] = useState<BillingOverviewData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [copiedInvitationId, setCopiedInvitationId] = useState<string | null>(
    null
  );

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((res) => res.json()),
      fetch("/api/workspace/members").then((res) => res.json()),
      fetch("/api/billing/overview").then((res) => res.json()),
    ])
      .then(([statsPayload, membersPayload, billingPayload]) => {
        if (statsPayload.success) setData(statsPayload.data);
        if (membersPayload.success) setMembersData(membersPayload.data);
        if (billingPayload.success) setBillingData(billingPayload.data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function disconnectInstagram(instagramAccountId: string) {
    if (!confirm("Desconectar o Instagram? As automações desta conta deixarão de enviar mensagens.")) {
      return;
    }

    setBusy(`disconnect:${instagramAccountId}`);
    await fetch("/api/instagram/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId }),
    });
    window.location.reload();
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
      setInviteEmail("");
    } else {
      setMemberError(payload.error ?? "Não foi possível convidar o integrante");
    }
    setBusy(null);
  }

  async function removeInvitation(invitationId: string) {
    setMemberError(null);
    setBusy(`invite:${invitationId}`);
    const res = await fetch("/api/workspace/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
    } else {
      setMemberError(payload.error ?? "Não foi possível revogar o convite");
    }
    setBusy(null);
  }

  async function renewInvitation(invitation: WorkspaceMembersData["invitations"][number]) {
    setMemberError(null);
    setBusy(`renew:${invitation.id}`);
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: invitation.email,
        role: invitation.role,
      }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
    } else {
      setMemberError(payload.error ?? "Não foi possível renovar o convite");
    }
    setBusy(null);
  }

  async function copyInvitation(invitationId: string, inviteUrl: string) {
    await navigator.clipboard.writeText(inviteUrl);
    setCopiedInvitationId(invitationId);
    window.setTimeout(() => setCopiedInvitationId(null), 1800);
  }

  async function updateMemberRole(
    memberId: string,
    role: "ADMIN" | "MEMBER"
  ) {
    setMemberError(null);
    setBusy(`member:${memberId}`);
    const res = await fetch("/api/workspace/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, role }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
    } else {
      setMemberError(payload.error ?? "Não foi possível alterar a função");
    }
    setBusy(null);
  }

  async function removeMember(memberId: string, memberName: string) {
    if (!confirm(`Remover ${memberName} deste espaço de trabalho?`)) return;

    setMemberError(null);
    setBusy(`member:${memberId}`);
    const res = await fetch("/api/workspace/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
    } else {
      setMemberError(payload.error ?? "Não foi possível remover o integrante");
    }
    setBusy(null);
  }

  if (loading) {
    return <div className="panel rounded p-8 h-64" />;
  }

  const accounts = data?.instagramAccounts ?? [];
  const canManageMembers =
    membersData?.currentUserRole === "OWNER" ||
    membersData?.currentUserRole === "ADMIN";
  const accountLimit = data?.workspace.limits.instagramAccounts ?? 1;
  const accountLimitReached = accounts.length >= accountLimit;
  const memberLimit = data?.workspace.limits.members ?? 2;
  const reservedSeats =
    (membersData?.members.length ?? 0) +
    (membersData?.invitations.length ?? 0);
  const memberLimitReached = reservedSeats >= memberLimit;
  const currentPlanLabel = data?.workspace.planLabel ?? "Plano indisponível";
  const monthlyPriceLabel =
    billingData?.plan.monthlyPriceCents == null
      ? "Preço em definição"
      : new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: billingData.plan.currency,
        }).format(billingData.plan.monthlyPriceCents / 100);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Surfaces the ?instagram= code the OAuth routes redirect back with.
          Needs a Suspense boundary: useSearchParams in a prerendered client
          page fails the production build without one. */}
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-6 text-base font-semibold">Conexão com o Instagram</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Status</p>
              <p className="text-xs text-muted mt-0.5">
                Comentários e respostas privadas dependem desta conexão.
              </p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                accounts.length > 0
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {accounts.length > 0 ? "Conectado" : "Não conectado"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Contas</p>
              <p className="text-xs text-muted mt-0.5">
                {accounts.length} de {accountLimit}{" "}
                {accountLimit === 1 ? "perfil incluído" : "perfis incluídos"}
              </p>
            </div>
            <span className="text-sm text-muted">
              {accounts.length > 0 ? `${accounts.length} conectada${accounts.length === 1 ? "" : "s"}` : "Nenhuma"}
            </span>
          </div>

          <div className="space-y-3 py-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted">
                Conecte uma conta profissional do Instagram para criar automações.
              </p>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    @{account.username}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Conexão válida até{" "}
                    {account.tokenExpiresAt
                      ? new Date(account.tokenExpiresAt).toLocaleDateString("pt-BR")
                      : "data indisponível"}{" "}
                    · {account.webhookSubscribed
                      ? "Notificações ativas"
                      : "Notificações pendentes"}
                  </p>
                </div>
                <button
                  onClick={() => disconnectInstagram(account.id)}
                  disabled={busy === `disconnect:${account.id}`}
                  className="inline-flex items-center justify-center rounded border border-error/20 px-4 py-2 text-sm font-medium text-error transition-all hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
                >
                  {busy === `disconnect:${account.id}`
                    ? "Desconectando..."
                    : "Desconectar"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border flex gap-3">
          {accountLimitReached ? (
            <span className="rounded border border-warning/20 bg-warning/10 px-4 py-2 text-sm font-medium text-warning">
              Limite do plano atingido
            </span>
          ) : (
            <a
              href="/api/instagram/connect"
              className="px-4 py-2 rounded text-sm font-medium transition-colors bg-accent text-white hover:bg-accent-hover"
            >
              {accounts.length > 0 ? "Conectar outra conta" : "Conectar Instagram"}
            </a>
          )}
        </div>
      </section>

      <WorkspaceManager />

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="mb-1 text-base font-semibold">Equipe</h2>
        <p className="mb-6 text-xs leading-5 text-muted">
          Proprietários controlam tudo; administradores operam contas e automações;
          membros acompanham resultados e respondem conversas. {reservedSeats} de{" "}
          {memberLimit} assentos estão reservados no plano {currentPlanLabel}.
        </p>
        <div className="space-y-3">
          {membersData?.members.map((member) => {
            const memberName =
              member.user.name ?? member.user.email ?? "Integrante sem nome";
            const canManageTarget =
              member.user.id !== membersData.currentUserId &&
              member.role !== "OWNER" &&
              (membersData.currentUserRole === "OWNER" || member.role === "MEMBER");

            return (
              <div
                key={member.id}
                className="flex flex-col gap-3 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {memberName}
                    {member.user.id === membersData.currentUserId ? " (você)" : ""}
                  </p>
                  <p className="text-xs text-muted">{member.user.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {membersData.currentUserRole === "OWNER" && canManageTarget ? (
                    <select
                      value={member.role}
                      onChange={(event) =>
                        void updateMemberRole(
                          member.id,
                          event.target.value as "ADMIN" | "MEMBER"
                        )
                      }
                      disabled={busy === `member:${member.id}`}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted outline-none focus:border-accent"
                      aria-label={`Função de ${memberName}`}
                    >
                      <option value="MEMBER">Membro</option>
                      <option value="ADMIN">Administrador</option>
                    </select>
                  ) : (
                    <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted">
                      {member.role === "OWNER"
                        ? "Proprietário"
                        : member.role === "ADMIN"
                          ? "Administrador"
                          : "Membro"}
                    </span>
                  )}
                  {canManageTarget && (
                    <button
                      type="button"
                      onClick={() => void removeMember(member.id, memberName)}
                      disabled={busy === `member:${member.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-semibold text-error transition hover:bg-error/10 disabled:opacity-50"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {membersData?.invitations.length ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Convites pendentes
            </p>
            <div className="space-y-3">
              {membersData.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {invitation.email}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {invitation.role === "ADMIN" ? "Administrador" : "Membro"} ·{" "}
                      válido até{" "}
                      {new Date(invitation.expiresAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void copyInvitation(invitation.id, invitation.inviteUrl)
                      }
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                    >
                      {copiedInvitationId === invitation.id ? "Copiado" : "Copiar link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void renewInvitation(invitation)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50"
                    >
                      {busy === `renew:${invitation.id}` ? "Renovando..." : "Renovar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInvitation(invitation.id)}
                      disabled={busy === `invite:${invitation.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      Revogar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canManageMembers && (
          <form
            onSubmit={inviteMember}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="pessoa@empresa.com.br"
              aria-label="E-mail do integrante"
              className="rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              required
              disabled={memberLimitReached}
            />
            <select
              value={inviteRole}
              aria-label="Função do integrante"
              onChange={(event) =>
                setInviteRole(event.target.value as "ADMIN" | "MEMBER")
              }
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              disabled={memberLimitReached}
            >
              <option value="MEMBER">Membro</option>
              {membersData.currentUserRole === "OWNER" && (
                <option value="ADMIN">Administrador</option>
              )}
            </select>
            <button
              type="submit"
              disabled={busy === "invite" || memberLimitReached}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "invite"
                ? "Convidando..."
                : memberLimitReached
                  ? "Limite atingido"
                  : "Convidar"}
            </button>
            {memberError && (
              <p className="sm:col-span-3 text-sm text-error">{memberError}</p>
            )}
          </form>
        )}
      </section>

      <WorkspaceAuditLog />

      <section className="panel rounded p-4 sm:p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Plano e uso</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Visão transparente da assinatura deste espaço de trabalho.
            </p>
          </div>
          {billingData && (
            <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
              {billingData.subscription.statusLabel}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-border py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Plano atual</p>
            <p className="mt-0.5 text-xs text-muted">
              Define a capacidade de contas e integrantes deste espaço.
            </p>
          </div>
          <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent">
            {billingData?.plan.name ?? currentPlanLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-border py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Mensalidade</p>
            <p className="mt-0.5 text-xs text-muted">
              Nenhum checkout ou pagamento automático está ativo.
            </p>
          </div>
          <span className="text-sm font-semibold text-foreground">
            {monthlyPriceLabel}
          </span>
        </div>
        <div className="py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Mensagens enviadas neste mês
            </p>
            <p className="text-xs text-muted mt-0.5">
              {billingData
                ? `${formatNumber(billingData.usage.used)} de ${formatNumber(billingData.usage.limit)} mensagens registradas.`
                : "Medição atual do espaço de trabalho."}
            </p>
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-surface-hover"
            role="progressbar"
            aria-label="Uso mensal de mensagens"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={billingData?.usage.percentage ?? 0}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${billingData?.usage.percentage ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-right text-xs font-semibold text-muted">
            {billingData
              ? `${formatNumber(billingData.usage.percentage)}% utilizado`
              : `${formatNumber(data?.workspace.dmsSentThisPeriod ?? 0)} mensagens`}
          </p>
        </div>
      </section>
    </div>
  );
}

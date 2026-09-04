"use client";

import { useEffect, useState } from "react";

type AuditEvent = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
};

const actionLabels: Record<string, string> = {
  WORKSPACE_CREATED: "criou o espaço de trabalho",
  WORKSPACE_RENAMED: "renomeou o espaço de trabalho",
  WORKSPACE_ARCHIVED: "arquivou o espaço de trabalho",
  WORKSPACE_RESTORED: "restaurou o espaço de trabalho",
  MEMBER_INVITED: "criou um convite",
  INVITATION_ACCEPTED: "aceitou um convite",
  INVITATION_RENEWED: "renovou um convite",
  INVITATION_REVOKED: "revogou um convite",
  MEMBER_ADDED: "adicionou um integrante",
  MEMBER_ROLE_CHANGED: "alterou a função de um integrante",
  MEMBER_REMOVED: "removeu um integrante",
  INSTAGRAM_CONNECTED: "conectou uma conta do Instagram",
  INSTAGRAM_DISCONNECTED: "desconectou uma conta do Instagram",
};

export default function WorkspaceAuditLog() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/workspace/audit")
      .then(async (response) => ({
        status: response.status,
        payload: await response.json(),
      }))
      .then(({ status, payload }) => {
        if (cancelled) return;
        if (status === 403) {
          setForbidden(true);
          return;
        }
        if (payload.success) setEvents(payload.data.events);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (forbidden) return null;

  return (
    <section className="rounded-2xl border border-border bg-white p-4 sm:p-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
        Segurança
      </p>
      <h2 className="mt-1 text-base font-bold text-foreground">Trilha de auditoria</h2>
      <p className="mt-1 text-xs leading-5 text-muted">
        As 50 ações administrativas mais recentes deste espaço de trabalho.
      </p>

      <div className="mt-5 divide-y divide-border border-y border-border">
        {events === null && (
          <div className="h-16 animate-pulse bg-surface/60" />
        )}
        {events?.length === 0 && (
          <p className="py-5 text-sm text-muted">Nenhuma ação registrada ainda.</p>
        )}
        {events?.map((event) => (
          <div key={event.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="min-w-0 text-sm text-foreground">
              <span className="font-semibold">
                {event.actor?.name ?? event.actor?.email ?? "Sistema"}
              </span>{" "}
              <span className="text-muted">
                {actionLabels[event.action] ?? "realizou uma ação administrativa"}
              </span>
            </p>
            <time
              dateTime={event.createdAt}
              className="shrink-0 text-[11px] text-muted"
            >
              {new Date(event.createdAt).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </time>
          </div>
        ))}
      </div>
    </section>
  );
}

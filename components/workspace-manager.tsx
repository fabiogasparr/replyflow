"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type WorkspaceItem = {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  archived: boolean;
};

type WorkspacesPayload = {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceItem[];
};

const roleLabels: Record<WorkspaceItem["role"], string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  MEMBER: "Membro",
};

export default function WorkspaceManager() {
  const router = useRouter();
  const [data, setData] = useState<WorkspacesPayload | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadWorkspaces() {
    const response = await fetch("/api/workspaces");
    const payload = await response.json();
    if (payload.success) {
      setData(payload.data);
      return;
    }
    setError(payload.error ?? "Não foi possível carregar os espaços de trabalho");
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/workspaces")
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        if (payload.success) {
          setData(payload.data);
        } else {
          setError(
            payload.error ?? "Não foi possível carregar os espaços de trabalho"
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);

    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const payload = await response.json();

    if (response.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    setError(payload.error ?? "Não foi possível criar o espaço de trabalho");
    setBusy(null);
  }

  function beginRename(workspace: WorkspaceItem) {
    setEditingId(workspace.id);
    setEditingName(workspace.name);
    setError(null);
  }

  async function saveName(workspaceId: string) {
    setBusy(`rename:${workspaceId}`);
    setError(null);
    const response = await fetch(`/api/workspaces/${workspaceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingName }),
    });
    const payload = await response.json();

    if (response.ok) {
      setEditingId(null);
      await loadWorkspaces();
      router.refresh();
    } else {
      setError(payload.error ?? "Não foi possível renomear o espaço");
    }
    setBusy(null);
  }

  async function setArchived(workspace: WorkspaceItem, archived: boolean) {
    if (
      archived &&
      !window.confirm(
        `Arquivar “${workspace.name}”? As automações ativas serão pausadas, mas nenhum dado será apagado.`
      )
    ) {
      return;
    }

    setBusy(`${archived ? "archive" : "restore"}:${workspace.id}`);
    setError(null);
    const response = await fetch(`/api/workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error ?? "Não foi possível alterar o espaço");
      setBusy(null);
      return;
    }

    if (archived && data?.activeWorkspaceId === workspace.id) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    await loadWorkspaces();
    router.refresh();
    setBusy(null);
  }

  return (
    <section id="workspaces" className="rounded-2xl border border-border bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
            Organização
          </p>
          <h2 className="mt-1 text-base font-bold text-foreground">Espaços de trabalho</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Separe marcas e clientes para manter contas, campanhas e conversas isoladas.
          </p>
        </div>
      </div>

      <form onSubmit={createWorkspace} className="mt-5 flex flex-col gap-2 sm:flex-row">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          minLength={2}
          maxLength={80}
          required
          placeholder="Nome da marca ou cliente"
          className="min-w-0 flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy !== null}
          className="rounded-xl bg-[#112620] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1d3b32] disabled:opacity-50"
        >
          {busy === "create" ? "Criando..." : "Novo espaço"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      <div className="mt-5 space-y-2">
        {!data && !error && (
          <div className="h-20 animate-pulse rounded-xl bg-surface" />
        )}
        {data?.workspaces.map((workspace) => {
          const isCurrent = data.activeWorkspaceId === workspace.id;
          const canRename = workspace.role === "OWNER" || workspace.role === "ADMIN";
          const canArchive = workspace.role === "OWNER";

          return (
            <article
              key={workspace.id}
              className={`rounded-xl border p-4 ${
                workspace.archived
                  ? "border-dashed border-border bg-surface/60"
                  : isCurrent
                    ? "border-[#f1b5a6] bg-[#fff5f1]"
                    : "border-border bg-background"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  {editingId === workspace.id ? (
                    <div className="flex max-w-md gap-2">
                      <input
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        minLength={2}
                        maxLength={80}
                        className="min-w-0 flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                        aria-label="Novo nome do espaço"
                      />
                      <button
                        type="button"
                        onClick={() => void saveName(workspace.id)}
                        disabled={busy !== null}
                        className="rounded-lg bg-[#112620] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Salvar
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-bold text-foreground">{workspace.name}</h3>
                      {isCurrent && !workspace.archived && (
                        <span className="rounded-full bg-[#ffded5] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#a83a25]">
                          Atual
                        </span>
                      )}
                      {workspace.archived && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-muted">
                          Arquivado
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-muted">{roleLabels[workspace.role]}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canRename && editingId !== workspace.id && (
                    <button
                      type="button"
                      onClick={() => beginRename(workspace)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted transition hover:text-foreground disabled:opacity-50"
                    >
                      Renomear
                    </button>
                  )}
                  {canArchive && !workspace.archived && (
                    <button
                      type="button"
                      onClick={() => void setArchived(workspace, true)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-error/30 hover:text-error disabled:opacity-50"
                    >
                      {busy === `archive:${workspace.id}` ? "Arquivando..." : "Arquivar"}
                    </button>
                  )}
                  {canArchive && workspace.archived && (
                    <button
                      type="button"
                      onClick={() => void setArchived(workspace, false)}
                      disabled={busy !== null}
                      className="rounded-lg border border-success/20 bg-white px-3 py-1.5 text-xs font-semibold text-success transition hover:bg-success/10 disabled:opacity-50"
                    >
                      {busy === `restore:${workspace.id}` ? "Restaurando..." : "Restaurar"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

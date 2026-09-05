"use client";

/* The inbox intentionally hydrates account/thread caches when their keys change. */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";
import { formatDateTime, formatNumber } from "@/lib/i18n";
import type { ConversationListItem, ConversationsResponse } from "@/app/api/instagram/conversations/route";
import type { ThreadMessage, ThreadResponse } from "@/app/api/instagram/conversations/[id]/route";

const POLL_MS = 12_000;
const CACHE_MAX_AGE_MS = 60_000;
const convCacheKey = (accountId: string) => `inbox:v2:conversations:${accountId}`;
const msgCacheKey = (accountId: string, conversationId: string) =>
  `inbox:v2:messages:${accountId}:${conversationId}`;

type Member = ConversationsResponse["members"][number];
type ConversationState = NonNullable<ConversationListItem["state"]>;
type MessagingWindow = ThreadResponse["messagingWindow"];
type StatusFilter = "ALL" | ConversationState["status"];

const statusLabels: Record<ConversationState["status"], string> = {
  OPEN: "Aberta",
  PENDING: "Pendente",
  RESOLVED: "Resolvida",
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function memberName(member: Member | NonNullable<ConversationState["assignedMember"]>) {
  return member.user.name?.trim() || member.user.email || "Integrante sem nome";
}

function StatusPill({ status }: { status: ConversationState["status"] }) {
  const styles = status === "RESOLVED"
    ? "border-success/20 bg-success/10 text-success"
    : status === "PENDING"
      ? "border-accent/30 bg-accent/10 text-foreground"
      : "border-border bg-white text-muted";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles}`}>{statusLabels[status]}</span>;
}

export default function InboxPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("inbox:selectedAccount") ?? "";
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [canReply, setCanReply] = useState(false);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [messagingWindow, setMessagingWindow] = useState<MessagingWindow | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [stateSaving, setStateSaving] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [stateNotice, setStateNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const filteredConversations = useMemo(() => {
    const query = search.trim().replace(/^@/, "").toLocaleLowerCase("pt-BR");
    return conversations.filter((conversation) => {
      if (query && !(
        conversation.contact.username?.toLocaleLowerCase("pt-BR").includes(query)
        || conversation.contact.id.toLocaleLowerCase("pt-BR").includes(query)
        || conversation.lastMessage?.text.toLocaleLowerCase("pt-BR").includes(query)
      )) return false;
      if (statusFilter !== "ALL" && conversation.state?.status !== statusFilter) return false;
      if (priorityOnly && conversation.state?.priority !== "HIGH") return false;
      if (ownerFilter === "UNASSIGNED" && conversation.state?.assignedMemberId) return false;
      if (!["ALL", "UNASSIGNED"].includes(ownerFilter) && conversation.state?.assignedMemberId !== ownerFilter) return false;
      return true;
    });
  }, [conversations, ownerFilter, priorityOnly, search, statusFilter]);

  const activeStateReady = Boolean(active?.state);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/instagram/accounts", { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => {
        if (!payload.success) throw new Error(payload.error);
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId((previous) => {
          const stillValid = previous && next.some((account) => account.id === previous);
          return stillValid ? previous : payload.data.selectedInstagramAccountId || next[0]?.id || "";
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setConvError("Não foi possível carregar as contas do Instagram.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    window.sessionStorage.setItem("inbox:selectedAccount", selectedAccountId);
  }, [selectedAccountId]);

  const loadConversations = useCallback(async (silent: boolean) => {
    if (!selectedAccountId) return;
    if (!silent) setConvLoading(true);
    try {
      const response = await fetch(
        `/api/instagram/conversations?instagramAccountId=${encodeURIComponent(selectedAccountId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível carregar as conversas.");
      }
      const next: ConversationsResponse = payload.data;
      setConversations(next.conversations);
      setMembers(next.members);
      setCanReply(next.canReply);
      writeCache(convCacheKey(selectedAccountId), next.conversations);
      setConvError(null);
    } catch (failure) {
      if (!silent) {
        setConvError(failure instanceof Error ? failure.message : "Não foi possível carregar as conversas.");
      }
    } finally {
      if (!silent) setConvLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) {
      setConvLoading(false);
      return;
    }
    // Account changes intentionally discard conversation-local state.
    setActiveId(null);
    setMessages([]);
    setMessagingWindow(null);
    const cached = readCache<ConversationListItem[]>(convCacheKey(selectedAccountId), CACHE_MAX_AGE_MS);
    setConversations(cached.data ?? []);
    setConvLoading(!cached.data);
    void loadConversations(Boolean(cached.data));
    const timer = window.setInterval(() => void loadConversations(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadConversations]);

  const loadMessages = useCallback(async (conversationId: string, silent: boolean) => {
    if (!selectedAccountId) return;
    if (!silent) setThreadLoading(true);
    try {
      const response = await fetch(
        `/api/instagram/conversations/${encodeURIComponent(conversationId)}?instagramAccountId=${encodeURIComponent(selectedAccountId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível carregar as mensagens.");
      }
      const next: ThreadResponse = payload.data;
      setMessages(next.messages);
      setMessagingWindow(next.messagingWindow);
      writeCache(msgCacheKey(selectedAccountId, conversationId), next.messages);
      setThreadError(null);
    } catch (failure) {
      if (!silent) {
        setThreadError(failure instanceof Error ? failure.message : "Não foi possível carregar as mensagens.");
      }
    } finally {
      if (!silent) setThreadLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (!activeId || !selectedAccountId) return;
    const cached = readCache<ThreadMessage[]>(msgCacheKey(selectedAccountId, activeId), CACHE_MAX_AGE_MS);
    // Thread changes intentionally paint the matching cache immediately.
    setMessages(cached.data ?? []);
    setThreadLoading(!cached.data);
    void loadMessages(activeId, Boolean(cached.data));
    const timer = window.setInterval(() => void loadMessages(activeId, true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeId, loadMessages, selectedAccountId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  useEffect(() => {
    // Selecting a new thread resets only its local note draft.
    setNotesDraft(active?.state?.notes ?? "");
    setStateError(null);
    setStateNotice(null);
    // Polling must not overwrite a note that the operator is currently typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeStateReady]);

  function openConversation(id: string) {
    setActiveId(id);
    setSendError(null);
    setThreadError(null);
    setMessagingWindow(null);
    if (selectedAccountId) {
      const cached = readCache<ThreadMessage[]>(msgCacheKey(selectedAccountId, id), CACHE_MAX_AGE_MS);
      setMessages(cached.data ?? []);
      setThreadLoading(!cached.data);
    }
  }

  function applyConversationState(metaConversationId: string, state: ConversationState) {
    setConversations((current) => current.map((conversation) =>
      conversation.id === metaConversationId ? { ...conversation, state } : conversation,
    ));
  }

  async function updateConversation(changes: Partial<Pick<ConversationState, "status" | "priority" | "assignedMemberId" | "notes">>) {
    if (!active?.state || stateSaving || !selectedAccountId) return;
    setStateSaving(true);
    setStateError(null);
    setStateNotice(null);
    try {
      const response = await fetch(
        `/api/instagram/conversations/${encodeURIComponent(active.id)}?instagramAccountId=${encodeURIComponent(selectedAccountId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...changes, version: active.state.version }),
        },
      );
      const payload = await response.json();
      if (response.status === 409) {
        await loadConversations(false);
        throw new Error("Outra pessoa atualizou esta conversa. Os dados mais recentes foram carregados; confira antes de tentar novamente.");
      }
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível atualizar a conversa.");
      }
      applyConversationState(active.id, payload.data.conversation);
      if (changes.notes !== undefined) setNotesDraft(payload.data.conversation.notes ?? "");
      setStateNotice("Conversa atualizada para toda a equipe.");
    } catch (failure) {
      setStateError(failure instanceof Error ? failure.message : "Não foi possível atualizar a conversa.");
    } finally {
      setStateSaving(false);
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !active?.contact.id || sending || !canReply) return;
    setSending(true);
    setSendError(null);
    const optimistic: ThreadMessage = {
      id: `optimistic-${Date.now()}`,
      text,
      fromMe: true,
      fromUsername: null,
      createdTime: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    try {
      const response = await fetch("/api/instagram/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: selectedAccountId,
          recipientId: active.contact.id,
          conversationId: active.id,
          text,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível enviar a mensagem.");
      }
      await loadMessages(active.id, true);
      void loadConversations(true);
    } catch (failure) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(text);
      setSendError(failure instanceof Error ? failure.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  const activeNotes = active?.state?.notes ?? "";
  const notesDirty = notesDraft.trim() !== activeNotes;
  const counts = conversations.reduce((result, conversation) => {
    if (conversation.state) result[conversation.state.status] += 1;
    return result;
  }, { OPEN: 0, PENDING: 0, RESOLVED: 0 });

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-success">Atendimento em equipe</p><h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Conversas</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Responda pelo canal oficial do Instagram e organize cada atendimento com responsável, prioridade e status.</p></div>
        <div className="flex flex-wrap items-center gap-2">{accounts.length > 1 && <AccountSelect accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} includeAll={false} />}<span className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-muted">{formatNumber(counts.OPEN)} abertas · {formatNumber(counts.PENDING)} pendentes</span></div>
      </header>

      <section aria-label="Filtros da caixa de entrada" className="grid gap-3 rounded-2xl border border-border bg-white p-4 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.5fr)_repeat(2,minmax(160px,0.8fr))_auto]">
        <label className="space-y-1.5 text-xs font-semibold"><span>Buscar conversa</span><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Nome, ID ou mensagem" className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none focus:border-accent" /></label>
        <label className="space-y-1.5 text-xs font-semibold"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none focus:border-accent"><option value="ALL">Todos</option><option value="OPEN">Abertas</option><option value="PENDING">Pendentes</option><option value="RESOLVED">Resolvidas</option></select></label>
        <label className="space-y-1.5 text-xs font-semibold"><span>Responsável</span><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none focus:border-accent"><option value="ALL">Toda a equipe</option><option value="UNASSIGNED">Sem responsável</option>{members.map((member) => <option key={member.id} value={member.id}>{memberName(member)}</option>)}</select></label>
        <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-border px-3 py-2.5 text-sm"><input type="checkbox" checked={priorityOnly} onChange={(event) => setPriorityOnly(event.target.checked)} className="accent-current" /><span>Somente prioritárias</span></label>
      </section>

      <section className="grid min-h-[620px] overflow-hidden rounded-2xl border border-border bg-white sm:h-[calc(100dvh-14rem)] sm:min-h-[520px] sm:grid-cols-[300px_minmax(0,1fr)]" aria-label="Caixa de entrada">
        <aside className={`min-h-0 flex-col border-border sm:flex sm:border-r ${active ? "hidden" : "flex"}`}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Atendimentos</h2><span className="text-xs text-muted">{formatNumber(filteredConversations.length)}</span></div>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={convLoading}>
            {convLoading ? <p className="px-4 py-8 text-sm text-muted">Sincronizando conversas…</p> : convError ? <div role="alert" className="p-4"><p className="text-sm text-error">{convError}</p><button type="button" onClick={() => void loadConversations(false)} className="mt-3 text-xs font-semibold underline">Tentar novamente</button></div> : !selectedAccountId ? <p className="px-4 py-8 text-sm leading-6 text-muted">Conecte uma conta do Instagram para visualizar as conversas.</p> : filteredConversations.length === 0 ? <p className="px-4 py-8 text-sm leading-6 text-muted">Nenhuma conversa corresponde aos filtros atuais.</p> : filteredConversations.map((conversation) => {
              const selected = conversation.id === activeId;
              return <button key={conversation.id} type="button" onClick={() => openConversation(conversation.id)} className={`block w-full border-b border-border px-4 py-4 text-left transition ${selected ? "bg-success/5" : "hover:bg-surface/60"}`}><div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-semibold">@{conversation.contact.username ?? "contato_sem_nome"}</span><span className="shrink-0 text-[10px] text-muted">{formatTime(conversation.updatedTime)}</span></div><p className="mt-1.5 truncate text-xs text-muted">{conversation.lastMessage ? `${conversation.lastMessage.fromMe ? "Você: " : ""}${conversation.lastMessage.text || "Mensagem sem texto"}` : "Sem prévia da mensagem"}</p><div className="mt-3 flex flex-wrap items-center gap-1.5">{conversation.state && <StatusPill status={conversation.state.status} />}{conversation.state?.priority === "HIGH" && <span className="rounded-full border border-error/20 bg-error/5 px-2 py-0.5 text-[10px] font-semibold text-error">Prioritária</span>}{conversation.state?.assignedMember && <span className="max-w-full truncate rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">{memberName(conversation.state.assignedMember)}</span>}</div></button>;
            })}
          </div>
        </aside>

        <div className={`min-h-0 ${active ? "grid" : "hidden sm:flex"} xl:grid-cols-[minmax(0,1fr)_300px]`}>
          {!active ? <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-2xl text-success">↗</span><h2 className="font-display mt-5 text-xl font-bold">Escolha um atendimento</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted">Abra uma conversa para consultar as mensagens, responder e coordenar a equipe.</p></div> : <>
            <div className="flex min-h-0 flex-col">
              <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3"><button type="button" onClick={() => setActiveId(null)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold sm:hidden">Voltar</button><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">@{active.contact.username ?? "contato_sem_nome"}</h2><p className="mt-0.5 truncate text-[11px] text-muted">Instagram · ID {active.contact.id}</p></div>{active.state && <StatusPill status={active.state.status} />}</div>
              {messagingWindow && <div className={`border-b px-4 py-2 text-xs leading-5 ${messagingWindow.isOpen ? "border-success/15 bg-success/5 text-success" : "border-accent/25 bg-accent/10 text-foreground"}`}>{messagingWindow.isOpen && messagingWindow.expiresAt ? `Janela padrão estimada aberta até ${formatDateTime(messagingWindow.expiresAt)}.` : "Não identificamos uma mensagem recebida nas últimas 24 horas. A Meta pode recusar uma nova resposta."}</div>}
              <div ref={scrollRef} className="min-h-[280px] flex-1 space-y-3 overflow-y-auto bg-background/50 p-4" aria-busy={threadLoading}>{threadLoading && messages.length === 0 ? <p className="text-sm text-muted">Carregando mensagens…</p> : threadError ? <div role="alert"><p className="text-sm text-error">{threadError}</p><button type="button" onClick={() => void loadMessages(active.id, false)} className="mt-3 text-xs font-semibold underline">Tentar novamente</button></div> : messages.length === 0 ? <p className="text-sm text-muted">Nenhuma mensagem disponível.</p> : messages.map((message) => <div key={message.id} className={`flex ${message.fromMe ? "justify-end" : "justify-start"}`}><div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${message.fromMe ? "rounded-br-md bg-success text-white" : "rounded-bl-md border border-border bg-white text-foreground"}`}><p className="whitespace-pre-wrap break-words leading-6">{message.text || "Mensagem sem texto"}</p><p className={`mt-1 text-[10px] ${message.fromMe ? "text-white/75" : "text-muted"}`}>{formatTime(message.createdTime)}</p></div></div>)}</div>
              <div className="shrink-0 border-t border-border bg-white p-3">{sendError && <p role="alert" className="mb-2 text-xs leading-5 text-error">{sendError}</p>}<div className="flex items-end gap-2"><textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 1000))} onKeyDown={handleKeyDown} disabled={!canReply || sending} rows={2} maxLength={1000} placeholder={canReply ? "Escreva uma resposta…" : "Seu perfil não pode responder"} aria-label="Resposta" className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60" /><button type="button" onClick={() => void handleSend()} disabled={sending || !draft.trim() || !canReply} className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">{sending ? "Enviando…" : "Enviar"}</button></div><p className="mt-1.5 text-right text-[10px] text-muted">{formatNumber(draft.length)} / 1.000</p></div>
            </div>
            <aside className="min-h-0 overflow-y-auto border-t border-border bg-surface/30 p-4 xl:border-l xl:border-t-0" aria-label="Organização da conversa">{!active.state ? <p className="text-sm leading-6 text-muted">Aguardando a sincronização do estado desta conversa.</p> : <div className="space-y-5"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-success">Organização</p><h3 className="font-display mt-1 text-xl font-bold">Trabalho da equipe</h3></div><label className="block space-y-1.5 text-xs font-semibold"><span>Status</span><select value={active.state.status} disabled={stateSaving} onChange={(event) => void updateConversation({ status: event.target.value as ConversationState["status"] })} className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-accent"><option value="OPEN">Aberta</option><option value="PENDING">Pendente</option><option value="RESOLVED">Resolvida</option></select></label><label className="block space-y-1.5 text-xs font-semibold"><span>Responsável</span><select value={active.state.assignedMemberId ?? ""} disabled={stateSaving} onChange={(event) => void updateConversation({ assignedMemberId: event.target.value || null })} className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-accent"><option value="">Sem responsável</option>{members.map((member) => <option key={member.id} value={member.id}>{memberName(member)}</option>)}</select></label><button type="button" disabled={stateSaving} onClick={() => void updateConversation({ priority: active.state?.priority === "HIGH" ? "NORMAL" : "HIGH" })} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-semibold ${active.state.priority === "HIGH" ? "border-error/30 bg-error/5 text-error" : "border-border bg-white"}`}><span>{active.state.priority === "HIGH" ? "Prioridade alta" : "Prioridade normal"}</span><span aria-hidden="true">{active.state.priority === "HIGH" ? "★" : "☆"}</span></button><div><label htmlFor="conversation-notes" className="text-xs font-semibold">Anotações internas</label><textarea id="conversation-notes" value={notesDraft} onChange={(event) => { setNotesDraft(event.target.value); setStateNotice(null); }} disabled={stateSaving} rows={7} maxLength={5000} placeholder="Contexto, objeções e próximos passos…" className="mt-2 w-full resize-y rounded-lg border border-border bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-accent" /><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[10px] text-muted">{formatNumber(notesDraft.length)} / 5.000</span><button type="button" disabled={!notesDirty || stateSaving} onClick={() => void updateConversation({ notes: notesDraft.trim() || null })} className="rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{stateSaving ? "Salvando…" : "Salvar nota"}</button></div></div>{stateError && <p role="alert" className="rounded-lg border border-error/20 bg-error/5 p-3 text-xs leading-5 text-error">{stateError}</p>}{stateNotice && <p role="status" className="rounded-lg border border-success/20 bg-success/5 p-3 text-xs leading-5 text-success">{stateNotice}</p>}<div className="border-t border-border pt-4 text-xs leading-5 text-muted"><p>Última sincronização</p><p className="mt-1 font-medium text-foreground">{formatDateTime(active.state.lastSyncedAt)}</p></div></div>}</aside>
          </>}
        </div>
      </section>
    </div>
  );
}

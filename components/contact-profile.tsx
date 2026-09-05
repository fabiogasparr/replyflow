"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import StatusBadge from "@/components/status-badge";
import { ContactAvatar, ContactLoading, ContactPagination, ContactTags } from "@/components/contact-ui";
import type { ContactDetail, ContactInteraction } from "@/lib/contacts";
import { formatDateTime, formatNumber } from "@/lib/i18n";

type ContactData = { contact: ContactDetail; canEdit: boolean };
type HistoryData = { interactions: ContactInteraction[]; total: number; page: number; pageSize: number };

function parseTags(value: string) {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const tag = part.trim();
    const normalized = tag.toLocaleLowerCase("pt-BR");
    if (tag && !seen.has(normalized)) {
      tags.push(tag);
      seen.add(normalized);
    }
  }
  return tags;
}

export default function ContactProfile({ contactId }: { contactId: string }) {
  const [data, setData] = useState<ContactData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [request, setRequest] = useState({ revision: 0, keepDraft: false });
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [comparison, setComparison] = useState<ContactDetail | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRequest, setHistoryRequest] = useState({ page: 1, revision: 0 });
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadContact() {
      try {
        const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Não foi possível carregar este contato.");
        }
        if (controller.signal.aborted) return;
        const next: ContactData = payload.data;
        setData(next);
        if (request.keepDraft && next.canEdit) {
          setComparison(next.contact);
          setNotice("Versão atual carregada. Suas alterações locais foram preservadas. Compare os dados antes de salvar.");
        } else {
          setNotes(next.contact.notes ?? "");
          setTagInput(next.contact.tags.join(", "));
          setComparison(null);
        }
        setConflict(false);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setLoadError(failure instanceof Error ? failure.message : "Não foi possível carregar este contato. Tente novamente.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadContact();
    return () => controller.abort();
  }, [contactId, request]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadHistory() {
      try {
        const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/interactions?page=${historyRequest.page}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Não foi possível carregar o histórico de automações.");
        }
        if (!controller.signal.aborted) setHistory(payload.data);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setHistoryError(failure instanceof Error ? failure.message : "Não foi possível carregar o histórico. Tente novamente.");
        }
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [contactId, historyRequest]);

  useEffect(() => () => saveController.current?.abort(), []);

  const tags = parseTags(tagInput);
  const dirty = Boolean(data && (
    notes.trim() !== (data.contact.notes ?? "") ||
    JSON.stringify(tags) !== JSON.stringify(data.contact.tags)
  ));

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  function reloadContact(keepDraft: boolean) {
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setNotice(null);
    setRequest((current) => ({ revision: current.revision + 1, keepDraft }));
  }

  function changeHistoryPage(page: number) {
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryRequest((current) => ({ page, revision: current.revision + 1 }));
  }

  function discardDraft() {
    if (!data || !window.confirm("Descartar suas alterações e usar as notas e etiquetas salvas no contato?")) return;
    setNotes(data.contact.notes ?? "");
    setTagInput(data.contact.tags.join(", "));
    setComparison(null);
    setSaveError(null);
    setNotice("O rascunho foi descartado. Você está vendo os dados salvos.");
  }

  async function saveContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canEdit || saving || loading || conflict) return;
    setSaveError(null);
    setNotice(null);
    if (tags.length > 10 || tags.some((tag) => tag.length > 30)) {
      setSaveError("Use até 10 etiquetas, com no máximo 30 caracteres em cada uma.");
      return;
    }
    if (notes.length > 5000) {
      setSaveError("As anotações podem ter até 5.000 caracteres.");
      return;
    }

    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ tags, notes: notes.trim() || null, version: data.contact.version }),
      });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 409) {
        setConflict(true);
        setSaveError("Outra pessoa atualizou este contato. Seu rascunho está preservado. Carregue a versão atual antes de salvar.");
        return;
      }
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível salvar as alterações.");
      }
      const contact: ContactDetail = payload.data.contact;
      setData((current) => current ? { ...current, contact } : current);
      setNotes(contact.notes ?? "");
      setTagInput(contact.tags.join(", "));
      setComparison(null);
      setNotice("Etiquetas e anotações salvas.");
    } catch (failure) {
      if (!controller.signal.aborted) {
        setSaveError(failure instanceof Error ? failure.message : "Não foi possível salvar. Seu rascunho foi mantido; tente novamente.");
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl space-y-5">
        <Link href="/contacts" className="inline-flex text-sm font-semibold text-success hover:underline">← Voltar aos contatos</Link>
        <section className="rounded-2xl border border-border bg-white">
          {loading ? <ContactLoading label="Carregando perfil do contato…" /> : (
            <div role="alert" className="p-6 sm:p-10">
              <h1 className="font-display text-2xl font-bold">Não foi possível abrir o contato</h1>
              <p className="mt-3 text-sm text-muted">{loadError}</p>
              <button type="button" onClick={() => reloadContact(false)} className="mt-5 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface">Tentar novamente</button>
            </div>
          )}
        </section>
      </div>
    );
  }

  const { contact, canEdit } = data;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/contacts" onClick={(event) => { if (dirty && !window.confirm("Há alterações não salvas. Sair do perfil e descartá-las?")) event.preventDefault(); }} className="inline-flex text-sm font-semibold text-success hover:underline">← Voltar aos contatos</Link>

      <header className="rounded-2xl border border-border bg-white p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ContactAvatar username={contact.username} large />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-success">Perfil do contato</p>
            <h1 className="font-display mt-2 break-words text-3xl font-bold sm:text-4xl">{contact.username ? `@${contact.username}` : "Contato sem nome"}</h1>
            <p className="mt-2 break-words text-sm text-muted">Interage com <span className="font-semibold text-foreground">@{contact.instagramAccount.username}</span></p>
          </div>
          <span className="self-start rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground sm:self-center">{canEdit ? "Edição disponível" : "Somente leitura"}</span>
        </div>
        <dl className="mt-7 grid gap-5 border-t border-border pt-5 sm:grid-cols-3">
          <div><dt className="text-xs text-muted">Primeira interação registrada</dt><dd className="mt-2 text-sm font-medium"><time dateTime={contact.firstSeenAt}>{formatDateTime(contact.firstSeenAt)}</time></dd></div>
          <div><dt className="text-xs text-muted">Última interação registrada</dt><dd className="mt-2 text-sm font-medium"><time dateTime={contact.lastSeenAt}>{formatDateTime(contact.lastSeenAt)}</time></dd></div>
          <div><dt className="text-xs text-muted">Identificador no Instagram</dt><dd className="mt-2 break-all font-mono text-xs text-foreground">{contact.instagramScopedId}</dd></div>
        </dl>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="min-w-0 rounded-2xl border border-border bg-white p-5 sm:p-6" aria-labelledby="contact-organization-title">
          <h2 id="contact-organization-title" className="font-display text-2xl font-bold">Organização da equipe</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Etiquetas e anotações internas para dar continuidade ao relacionamento.</p>
          {canEdit ? (
            <form onSubmit={(event) => void saveContact(event)} className="mt-6 space-y-5">
              <div>
                <label htmlFor="contact-tags" className="text-sm font-semibold">Etiquetas</label>
                <input id="contact-tags" value={tagInput} onChange={(event) => { setTagInput(event.target.value); setNotice(null); }} disabled={saving || loading} aria-describedby="contact-tags-hint" placeholder="Ex.: interessado, cliente, parceria" autoComplete="off" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60" />
                <p id="contact-tags-hint" className="mt-2 text-xs leading-5 text-muted">Até 10 etiquetas separadas por vírgula, com 30 caracteres cada.</p>
                {tags.length > 0 && <div className="mt-3"><ContactTags tags={tags} /></div>}
              </div>
              <div>
                <label htmlFor="contact-notes" className="text-sm font-semibold">Anotações</label>
                <textarea id="contact-notes" value={notes} onChange={(event) => { setNotes(event.target.value); setNotice(null); }} disabled={saving || loading} rows={8} maxLength={5000} aria-describedby="contact-notes-hint" placeholder="Registre o contexto da conversa e os próximos passos da equipe…" className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-3 text-sm leading-6 outline-none focus:border-accent disabled:opacity-60" />
                <p id="contact-notes-hint" className="mt-1 text-right text-xs text-muted">{formatNumber(notes.length)} / 5.000 caracteres</p>
              </div>
              {saveError && <p role="alert" className="rounded-lg border border-error/20 bg-error/5 p-3 text-sm leading-6 text-error">{saveError}</p>}
              {loadError && <p role="alert" className="rounded-lg border border-error/20 bg-error/5 p-3 text-sm leading-6 text-error">{loadError}</p>}
              {notice && <p role="status" className="rounded-lg border border-success/20 bg-success/5 p-3 text-sm leading-6 text-success">{notice}</p>}
              {conflict && <button type="button" onClick={() => reloadContact(true)} disabled={loading} className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-semibold hover:bg-surface disabled:opacity-50">{loading ? "Carregando versão atual…" : "Carregar versão atual e manter meu rascunho"}</button>}
              {comparison && (
                <details className="rounded-lg border border-border bg-surface/50 p-3" open>
                  <summary className="cursor-pointer text-sm font-semibold">Versão salva por outra pessoa</summary>
                  <div className="mt-3"><ContactTags tags={comparison.tags} /></div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{comparison.notes || "Sem anotações salvas."}</p>
                </details>
              )}
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
                <button type="submit" disabled={!dirty || saving || loading || conflict} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Salvando…" : "Salvar alterações"}</button>
                {dirty && !conflict && <button type="button" onClick={discardDraft} disabled={saving || loading} className="text-xs font-semibold text-muted underline underline-offset-4 disabled:opacity-50">Descartar rascunho</button>}
                <span aria-live="polite" className="text-xs text-muted">{dirty ? "Alterações não salvas" : "Tudo salvo"}</span>
              </div>
            </form>
          ) : (
            <div className="mt-6 space-y-6">
              <div><h3 className="mb-3 text-sm font-semibold">Etiquetas</h3><ContactTags tags={contact.tags} /></div>
              <div><h3 className="mb-3 text-sm font-semibold">Anotações</h3><p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted">{contact.notes || "A equipe ainda não adicionou anotações."}</p></div>
              <p className="border-t border-border pt-4 text-xs leading-5 text-muted">Proprietários e administradores podem editar as informações deste contato.</p>
            </div>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-white" aria-labelledby="contact-history-title" aria-busy={historyLoading}>
          <div className="border-b border-border p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 id="contact-history-title" className="font-display text-2xl font-bold">Histórico de automações</h2>
              {history && !historyLoading && !historyError && <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold">{formatNumber(history.total)}</span>}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">Comentários e respostas privadas registrados pelas automações desta conta.</p>
          </div>
          {historyLoading ? <ContactLoading label="Carregando histórico de automações…" /> : historyError ? (
            <div role="alert" className="p-6">
              <p className="text-sm leading-6 text-error">{historyError}</p>
              <button type="button" onClick={() => changeHistoryPage(historyRequest.page)} className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface">Tentar novamente</button>
            </div>
          ) : !history?.interactions.length ? (
            <div className="p-8 text-center"><h3 className="font-semibold">Nenhuma automação registrada ainda</h3><p className="mt-2 text-sm leading-6 text-muted">As próximas interações processadas para este contato aparecerão aqui.</p></div>
          ) : (
            <>
              <ol className="divide-y divide-border">
                {history.interactions.map((interaction) => (
                  <li key={interaction.id} className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3"><time dateTime={interaction.createdAt} className="text-xs text-muted">{formatDateTime(interaction.createdAt)}</time><StatusBadge status={interaction.status} /></div>
                    <blockquote className="mt-4 break-words border-l-2 border-accent/50 pl-3 text-sm leading-7 text-foreground">{interaction.commentText || "Comentário sem texto registrado."}</blockquote>
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                      <Link href={`/campaigns/${encodeURIComponent(interaction.automation.id)}`} className="break-words font-semibold text-success underline underline-offset-4">{interaction.automation.name}</Link>
                      {interaction.matchedKeyword && <span className="rounded-md bg-surface px-2 py-1 text-muted">Palavra-chave: {interaction.matchedKeyword}</span>}
                    </div>
                    {interaction.dmSentAt && <p className="mt-3 text-xs text-muted">Resposta enviada em {formatDateTime(interaction.dmSentAt)}</p>}
                  </li>
                ))}
              </ol>
              <ContactPagination page={history.page} pageSize={history.pageSize} total={history.total} loading={historyLoading} onChange={changeHistoryPage} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

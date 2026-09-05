"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ContactAvatar, ContactLoading, ContactPagination, ContactTags } from "@/components/contact-ui";
import type { ContactSummary } from "@/lib/contacts";
import { formatDateTime, formatNumber } from "@/lib/i18n";

type DirectoryData = {
  contacts: ContactSummary[];
  total: number;
  page: number;
  pageSize: number;
  accounts: Array<{ id: string; username: string }>;
  canEdit: boolean;
};

const emptyFilters = { search: "", account: "", tag: "", page: 1 };

export default function ContactsPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [data, setData] = useState<DirectoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: String(filters.page) });
        if (filters.search.trim()) params.set("search", filters.search.trim());
        if (filters.account) params.set("instagramAccountId", filters.account);
        if (filters.tag.trim()) params.set("tag", filters.tag.trim());

        const response = await fetch(`/api/contacts?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Não foi possível carregar os contatos.");
        }
        if (!controller.signal.aborted) setData(payload.data);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Não foi possível carregar os contatos. Tente novamente.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, retry]);

  function changeFilters(next: Partial<typeof filters>) {
    setLoading(true);
    setError(null);
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }));
  }

  function reload() {
    setLoading(true);
    setError(null);
    setRetry((current) => current + 1);
  }

  const hasFilters = Boolean(filters.search || filters.account || filters.tag);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-success">Relacionamento</p>
          <h1 className="font-display mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Contatos</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">Conheça quem interage com suas automações e organize o próximo passo da conversa.</p>
        </div>
        <div className="border-l-2 border-accent pl-4" aria-live="polite">
          <p className="font-display text-3xl font-bold text-foreground">{loading || error ? "—" : formatNumber(data?.total ?? 0)}</p>
          <p className="mt-1 text-xs text-muted">{hasFilters ? "contatos encontrados" : "contatos registrados"}</p>
        </div>
      </header>

      <section aria-label="Filtros de contatos" className="rounded-2xl border border-border bg-white p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="space-y-2 text-xs font-semibold text-foreground" htmlFor="contact-search">
            <span>Buscar contato</span>
            <input id="contact-search" type="search" autoComplete="off" value={filters.search} onChange={(event) => changeFilters({ search: event.target.value })} placeholder="Usuário ou identificador do Instagram" className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none focus:border-accent" />
          </label>
          <label className="space-y-2 text-xs font-semibold text-foreground" htmlFor="contact-account">
            <span>Conta do Instagram</span>
            <select id="contact-account" value={filters.account} onChange={(event) => changeFilters({ account: event.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none focus:border-accent">
              <option value="">Todas as contas</option>
              {data?.accounts.map((account) => <option key={account.id} value={account.id}>@{account.username}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold text-foreground" htmlFor="contact-tag">
            <span>Etiqueta</span>
            <input id="contact-tag" type="search" autoComplete="off" value={filters.tag} onChange={(event) => changeFilters({ tag: event.target.value })} placeholder="Ex.: interessado" maxLength={30} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-normal outline-none focus:border-accent" />
          </label>
        </div>
        {hasFilters && <button type="button" onClick={() => changeFilters(emptyFilters)} className="mt-4 text-xs font-semibold text-success underline underline-offset-4">Limpar filtros</button>}
      </section>

      <section aria-label="Lista de contatos" aria-busy={loading} className="overflow-hidden rounded-2xl border border-border bg-white">
        {loading ? <ContactLoading label="Buscando contatos…" /> : error ? (
          <div role="alert" className="px-6 py-10">
            <h2 className="font-semibold text-error">Não conseguimos carregar a lista</h2>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <button type="button" onClick={reload} className="mt-5 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface">Tentar novamente</button>
          </div>
        ) : !data?.contacts.length ? (
          <div className="mx-auto max-w-md px-6 py-14 text-center">
            <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success">
              <svg viewBox="0 0 24 24" className="h-7 w-7 fill-none stroke-current stroke-[1.5]"><path d="M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3v6m-3-3h6" /></svg>
            </span>
            <h2 className="font-display mt-5 text-2xl font-bold">{hasFilters ? "Nenhum contato com esses filtros" : "Seu primeiro contato começa com uma interação"}</h2>
            <p className="mt-3 text-sm leading-6 text-muted">{hasFilters ? "Ajuste a busca, a conta ou a etiqueta para encontrar o contato que procura." : "Os contatos aparecem aqui quando alguém interage com suas automações do Instagram. Depois, sua equipe pode adicionar etiquetas e anotações."}</p>
            {hasFilters ? <button type="button" onClick={() => changeFilters(emptyFilters)} className="mt-6 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface">Limpar filtros</button> : <Link href="/campaigns" className="mt-6 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent-hover">Ver automações →</Link>}
          </div>
        ) : (
          <>
            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-5 border-b border-border bg-surface/60 px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-muted lg:grid">
              <span>Contato</span><span>Conta</span><span>Etiquetas</span><span>Última interação</span><span className="w-5" />
            </div>
            <ul className="divide-y divide-border">
              {data.contacts.map((contact) => (
                <li key={contact.id}>
                  <Link href={`/contacts/${encodeURIComponent(contact.id)}`} className="group grid gap-4 px-5 py-5 transition hover:bg-surface/50 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <ContactAvatar username={contact.username} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold group-hover:text-success">{contact.username ? `@${contact.username}` : "Contato sem nome"}</p>
                        <p className="mt-1 truncate text-xs text-muted">{contact.username ? "Ver perfil do contato" : `ID ${contact.instagramScopedId}`}</p>
                      </div>
                    </div>
                    <div className="min-w-0"><span className="mr-2 text-xs text-muted lg:hidden">Conta:</span><span className="break-words text-sm">@{contact.instagramAccount.username}</span></div>
                    <ContactTags tags={contact.tags} />
                    <div className="text-xs text-muted"><span className="mr-2 lg:hidden">Última interação:</span><time dateTime={contact.lastSeenAt}>{formatDateTime(contact.lastSeenAt)}</time></div>
                    <span aria-hidden="true" className="hidden text-lg text-success lg:block">→</span>
                  </Link>
                </li>
              ))}
            </ul>
            <ContactPagination page={data.page} pageSize={data.pageSize} total={data.total} loading={loading} onChange={(page) => changeFilters({ page })} />
          </>
        )}
      </section>
    </div>
  );
}

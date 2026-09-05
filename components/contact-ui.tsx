import { formatNumber } from "@/lib/i18n";

export function ContactAvatar({ username, large = false }: { username: string | null; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-2xl border border-success/15 bg-success/10 font-display font-bold text-success ${large ? "h-20 w-20 text-3xl" : "h-11 w-11 text-xl"}`}
    >
      {username?.replace(/^@/, "").slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

export function ContactTags({ tags }: { tags: string[] }) {
  return tags.length ? (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="max-w-full break-words rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-foreground">
          {tag}
        </span>
      ))}
    </div>
  ) : <span className="text-xs text-muted">Sem etiquetas</span>;
}

export function ContactPagination({ page, pageSize, total, loading, onChange }: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <nav aria-label="Paginação" className="flex flex-col gap-4 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted">
        {total > 0
          ? `${formatNumber((page - 1) * pageSize + 1)}–${formatNumber(Math.min(page * pageSize, total))} de ${formatNumber(total)} registros`
          : "Nenhum registro"}
      </p>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <button type="button" disabled={loading || page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40">
          Anterior
        </button>
        <span className="text-xs text-muted">{formatNumber(page)} de {formatNumber(totalPages)}</span>
        <button type="button" disabled={loading || page >= totalPages} onClick={() => onChange(page + 1)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40">
          Próxima
        </button>
      </div>
    </nav>
  );
}

export function ContactLoading({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-4 p-6">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-4 border-b border-border pb-4 last:border-0" aria-hidden="true">
          <div className="h-11 w-11 shrink-0 rounded-2xl bg-surface" />
          <div className="w-full space-y-2">
            <div className="h-3 w-1/3 rounded bg-surface" />
            <div className="h-3 w-2/3 rounded bg-surface" />
          </div>
        </div>
      ))}
    </div>
  );
}

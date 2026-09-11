"use client";

import { useEffect, useState } from "react";
import type { ContactCustomFieldTypeValue } from "@/lib/contact-custom-fields";

type FieldDefinition = {
  id: string;
  name: string;
  type: ContactCustomFieldTypeValue;
  options: string[];
  position: number;
  isActive: boolean;
  _count: { values: number };
};

type FieldsData = {
  fields: FieldDefinition[];
  canManage: boolean;
  limits: { active: number };
};

const typeLabels: Record<ContactCustomFieldTypeValue, string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  DATE: "Data",
  BOOLEAN: "Sim ou não",
  SELECT: "Lista de opções",
};

function splitOptions(value: string) {
  return value.split(",").map((option) => option.trim()).filter(Boolean);
}

function FieldRow({
  field,
  canManage,
  busy,
  onBusy,
  onSaved,
  onError,
}: {
  field: FieldDefinition;
  canManage: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (field: FieldDefinition) => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState(field.options.join(", "));

  async function update(body: Record<string, unknown>) {
    onBusy(true);
    onError(null);
    try {
      const response = await fetch(`/api/contact-fields/${encodeURIComponent(field.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Não foi possível atualizar o campo.");
      const saved: FieldDefinition = payload.data.field;
      setName(saved.name);
      setOptions(saved.options.join(", "));
      onSaved(saved);
      setEditing(false);
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Não foi possível atualizar o campo.");
    } finally {
      onBusy(false);
    }
  }

  return (
    <li className={`rounded-xl border p-4 ${field.isActive ? "border-border bg-white" : "border-border bg-surface/70 opacity-80"}`}>
      {editing ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          void update({
            name,
            ...(field.type === "SELECT" ? { options: splitOptions(options) } : {}),
          });
        }} className="space-y-3">
          <label className="block text-xs font-semibold">
            Nome do campo
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required disabled={busy} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-accent" />
          </label>
          {field.type === "SELECT" && (
            <label className="block text-xs font-semibold">
              Opções separadas por vírgula
              <input value={options} onChange={(event) => setOptions(event.target.value)} required disabled={busy} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-accent" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-foreground disabled:opacity-50">Salvar campo</button>
            <button type="button" onClick={() => { setEditing(false); setName(field.name); setOptions(field.options.join(", ")); }} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="break-words text-sm font-semibold text-foreground">{field.name}</p>
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{typeLabels[field.type]}</span>
              {!field.isActive && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">Inativo</span>}
            </div>
            <p className="mt-1 text-xs text-muted">
              {field._count.values} {field._count.values === 1 ? "contato preenchido" : "contatos preenchidos"}
              {field.type === "SELECT" ? ` · ${field.options.join(" · ")}` : ""}
            </p>
          </div>
          {canManage && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(true)} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface disabled:opacity-50">Editar</button>
              <button type="button" onClick={() => void update({ isActive: !field.isActive })} disabled={busy} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${field.isActive ? "border-warning/25 text-warning hover:bg-warning/10" : "border-success/25 text-success hover:bg-success/10"}`}>
                {field.isActive ? "Desativar" : "Reativar"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function ContactFieldManager() {
  const [data, setData] = useState<FieldsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<ContactCustomFieldTypeValue>("TEXT");
  const [options, setOptions] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contact-fields")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error ?? "Não foi possível carregar os campos.");
        if (!cancelled) setData(payload.data);
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "Não foi possível carregar os campos.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function createField(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("create");
    setError(null);
    try {
      const response = await fetch("/api/contact-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, ...(type === "SELECT" ? { options: splitOptions(options) } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Não foi possível criar o campo.");
      setData((current) => current ? { ...current, fields: [...current.fields, payload.data.field] } : current);
      setName("");
      setType("TEXT");
      setOptions("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível criar o campo.");
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = data?.fields.filter((field) => field.isActive).length ?? 0;

  return (
    <section id="contact-fields" className="scroll-mt-6 overflow-hidden rounded-2xl border border-border bg-white">
      <div className="border-b border-border bg-[#112620] p-5 text-white sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f4bd4f]">CRM adaptável</p>
        <h2 className="font-display mt-1 text-2xl font-bold">Campos personalizados</h2>
        <p className="mt-2 text-xs leading-5 text-white/65">Modele o dado que importa para sua operação sem alterar o perfil padrão do contato.</p>
        {data && <p className="mt-4 text-xs font-semibold text-white/80">{activeCount} de {data.limits.active} campos ativos</p>}
      </div>

      <div className="p-4 sm:p-6">
        {loading ? <div className="h-20 animate-pulse rounded-xl bg-surface" /> : (
          <>
            {error && <p role="alert" className="mb-4 rounded-lg border border-error/20 bg-error/5 p-3 text-sm text-error">{error}</p>}
            {data?.canManage && (
              <form onSubmit={(event) => void createField(event)} className="grid gap-3 rounded-xl border border-border bg-surface/50 p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                <label className="text-xs font-semibold">
                  Nome do novo campo
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Ex.: Cidade" required disabled={busyId !== null || activeCount >= data.limits.active} className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-accent disabled:opacity-60" />
                </label>
                <label className="text-xs font-semibold">
                  Tipo
                  <select value={type} onChange={(event) => setType(event.target.value as ContactCustomFieldTypeValue)} disabled={busyId !== null || activeCount >= data.limits.active} className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-accent disabled:opacity-60">
                    {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={busyId !== null || activeCount >= data.limits.active} className="self-end rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-foreground hover:bg-accent-hover disabled:opacity-50">{busyId === "create" ? "Criando…" : "Criar campo"}</button>
                {type === "SELECT" && (
                  <label className="text-xs font-semibold sm:col-span-3">
                    Opções separadas por vírgula
                    <input value={options} onChange={(event) => setOptions(event.target.value)} placeholder="Novo lead, Qualificado, Cliente" required disabled={busyId !== null} className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-accent disabled:opacity-60" />
                  </label>
                )}
              </form>
            )}

            {!data?.fields.length ? (
              <div className="py-8 text-center"><p className="font-semibold">Nenhum campo criado</p><p className="mt-2 text-sm text-muted">Comece com cidade, orçamento ou etapa comercial.</p></div>
            ) : (
              <ul className="mt-5 space-y-3">
                {data.fields.map((field) => (
                  <FieldRow key={field.id} field={field} canManage={data.canManage} busy={busyId === field.id} onBusy={(busy) => setBusyId(busy ? field.id : null)} onError={setError} onSaved={(saved) => setData((current) => current ? { ...current, fields: current.fields.map((item) => item.id === saved.id ? saved : item) } : current)} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

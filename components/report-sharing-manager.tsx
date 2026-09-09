"use client";

import { useEffect, useState } from "react";
import type {
  SharedReportPeriodDays,
  WorkspaceReportSharing,
} from "@/lib/reports/sharing";

type SharingCampaign = WorkspaceReportSharing["campaigns"][number];

type ApiPayload<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

const PERIOD_OPTIONS: ReadonlyArray<SharedReportPeriodDays> = [7, 30, 90];

function formatDate(value: Date | string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ReportSharingManager() {
  const [data, setData] = useState<WorkspaceReportSharing | null>(null);
  const [brandName, setBrandName] = useState("");
  const [brandColor, setBrandColor] = useState("#112620");
  const [periods, setPeriods] = useState<Record<string, SharedReportPeriodDays>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/sharing", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as ApiPayload<WorkspaceReportSharing>;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? "Não foi possível carregar os compartilhamentos");
        }
        return payload.data;
      })
      .then((sharing) => {
        if (cancelled) return;
        setData(sharing);
        setBrandName(sharing.branding.customName ?? "");
        setBrandColor(sharing.branding.color);
        setPeriods(
          Object.fromEntries(
            sharing.campaigns.map((campaign) => [campaign.id, campaign.periodDays])
          )
        );
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Não foi possível carregar os compartilhamentos"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function update<T>(body: object) {
    const response = await fetch("/api/reports/sharing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as ApiPayload<T>;
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "Não foi possível salvar a alteração");
    }
    return payload.data;
  }

  function replaceCampaign(updated: SharingCampaign) {
    setData((current) =>
      current
        ? {
            ...current,
            campaigns: current.campaigns.map((campaign) =>
              campaign.id === updated.id ? updated : campaign
            ),
          }
        : current
    );
  }

  async function saveBrand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("brand");
    setError(null);
    setFeedback(null);
    try {
      const branding = await update<WorkspaceReportSharing["branding"]>({
        action: "update_brand",
        name: brandName.trim() || null,
        color: brandColor,
      });
      setData((current) => (current ? { ...current, branding } : current));
      setBrandName(branding.customName ?? "");
      setBrandColor(branding.color);
      setFeedback("Identidade dos relatórios atualizada.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível salvar a marca");
    } finally {
      setBusy(null);
    }
  }

  async function publish(campaign: SharingCampaign) {
    setBusy(campaign.id);
    setError(null);
    setFeedback(null);
    try {
      const updated = await update<SharingCampaign>({
        action: "publish",
        automationId: campaign.id,
        periodDays: periods[campaign.id] ?? campaign.periodDays,
      });
      replaceCampaign(updated);
      setFeedback(
        campaign.enabled
          ? `Período de “${campaign.name}” atualizado.`
          : `Relatório de “${campaign.name}” publicado.`
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível publicar o relatório");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(campaign: SharingCampaign) {
    if (!window.confirm("Revogar este relatório? O endereço compartilhado deixará de funcionar imediatamente.")) return;
    setBusy(campaign.id);
    setError(null);
    setFeedback(null);
    try {
      const updated = await update<SharingCampaign>({
        action: "revoke",
        automationId: campaign.id,
      });
      replaceCampaign(updated);
      setFeedback(`Acesso público de “${campaign.name}” revogado.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível revogar o relatório");
    } finally {
      setBusy(null);
    }
  }

  async function rotate(campaign: SharingCampaign) {
    if (!window.confirm("Gerar um novo endereço? O link anterior deixará de funcionar imediatamente.")) return;
    setBusy(campaign.id);
    setError(null);
    setFeedback(null);
    try {
      const updated = await update<SharingCampaign>({
        action: "rotate",
        automationId: campaign.id,
      });
      replaceCampaign(updated);
      setFeedback(`Novo endereço criado para “${campaign.name}”.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível renovar o endereço");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink(campaign: SharingCampaign) {
    if (!campaign.reportUrl) return;
    try {
      await navigator.clipboard.writeText(campaign.reportUrl);
      setFeedback(`Link de “${campaign.name}” copiado.`);
      setError(null);
    } catch {
      setError("O navegador não permitiu copiar o link automaticamente");
    }
  }

  if (error && !data) {
    return (
      <section id="compartilhamento" className="rounded-3xl border border-[#e3c7bd] bg-[#fff7f2] p-7 text-center">
        <p className="font-semibold text-foreground">Compartilhamentos indisponíveis</p>
        <p className="mt-1 text-sm text-error">{error}</p>
      </section>
    );
  }

  if (!data) {
    return <div id="compartilhamento" className="h-72 animate-pulse rounded-3xl border border-border bg-surface" />;
  }

  const customPreviewName = brandName.trim() || data.branding.name;
  const previewInitials = (customPreviewName.match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "RF";
  const previewRed = Number.parseInt(brandColor.slice(1, 3), 16);
  const previewGreen = Number.parseInt(brandColor.slice(3, 5), 16);
  const previewBlue = Number.parseInt(brandColor.slice(5, 7), 16);
  const previewTextColor =
    (previewRed * 299 + previewGreen * 587 + previewBlue * 114) / 1_000 > 150
      ? "#112620"
      : "#FFFFFF";

  return (
    <section id="compartilhamento" className="scroll-mt-24 overflow-hidden rounded-3xl border border-[#294b40] bg-[#112620] text-white">
      <div className="grid gap-8 border-b border-white/10 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)] lg:px-10 lg:py-9">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#f5c451]">Portal do cliente</p>
          <h2 className="mt-2 font-display text-3xl sm:text-4xl">Compartilhe resultado, não dados pessoais.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#b8cbc3]">
            Publique uma leitura somente para consulta, com a marca deste espaço. Revogar ou renovar invalida o endereço anterior.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9bb3aa]">Prévia da assinatura</p>
          <div className="mt-4 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl text-sm font-black" style={{ backgroundColor: brandColor, color: previewTextColor }} aria-hidden="true">{previewInitials}</span>
            <div className="min-w-0"><p className="truncate font-semibold">{customPreviewName}</p><p className="text-xs text-[#9bb3aa]">Relatório para acompanhamento</p></div>
          </div>
        </div>
      </div>

      <form onSubmit={saveBrand} className="grid gap-4 border-b border-white/10 px-5 py-6 sm:px-8 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end lg:px-10">
        <label>
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-[#9bb3aa]">Nome exibido</span>
          <input value={brandName} onChange={(event) => setBrandName(event.target.value)} disabled={!data.canManage} maxLength={80} placeholder={data.branding.name} className="w-full rounded-xl border border-white/15 bg-white/[0.07] px-3 py-2.5 text-sm text-white placeholder:text-[#769087] disabled:cursor-not-allowed disabled:opacity-70" />
        </label>
        <label>
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-[#9bb3aa]">Cor principal</span>
          <span className="flex h-[42px] items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-2.5">
            <input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} disabled={!data.canManage} className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0" aria-label="Cor principal da marca" />
            <span className="font-mono text-xs uppercase text-[#d6e1dc]">{brandColor}</span>
          </span>
        </label>
        {data.canManage && (
          <button type="submit" disabled={busy === "brand"} className="h-[42px] rounded-xl bg-[#f5c451] px-4 text-sm font-bold text-[#112620] transition hover:bg-[#ffda72] disabled:opacity-60">
            {busy === "brand" ? "Salvando…" : "Salvar marca"}
          </button>
        )}
      </form>

      {(feedback || error) && (
        <div className={`mx-5 mt-5 rounded-xl border px-4 py-3 text-sm sm:mx-8 lg:mx-10 ${error ? "border-[#ff9b84]/35 bg-[#7a2d20]/30 text-[#ffc0b1]" : "border-[#79c8a9]/30 bg-[#1d7a5d]/25 text-[#bdebd9]"}`} role="status">
          {error ?? feedback}
        </div>
      )}

      <div className="divide-y divide-white/10 px-5 pb-3 pt-5 sm:px-8 lg:px-10">
        {data.campaigns.length === 0 && (
          <div className="py-10 text-center text-sm text-[#9bb3aa]">Crie uma automação para publicar o primeiro relatório.</div>
        )}
        {data.campaigns.map((campaign) => {
          const pending = busy === campaign.id;
          return (
            <article key={campaign.id} className="grid gap-4 py-5 xl:grid-cols-[minmax(220px,1fr)_auto_minmax(260px,0.85fr)] xl:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-semibold">{campaign.name}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${campaign.enabled ? "bg-[#d8f0e5] text-[#16634c]" : "bg-white/10 text-[#9bb3aa]"}`}>{campaign.enabled ? "Publicado" : "Privado"}</span>
                </div>
                <p className="mt-1 text-xs text-[#9bb3aa]">@{campaign.instagramUsername}{campaign.publishedAt ? ` · publicado em ${formatDate(campaign.publishedAt)}` : ""}</p>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#b8cbc3]">
                Período
                <select value={periods[campaign.id] ?? campaign.periodDays} disabled={!data.canManage || pending} onChange={(event) => setPeriods((current) => ({ ...current, [campaign.id]: Number(event.target.value) as SharedReportPeriodDays }))} className="rounded-lg border border-white/15 bg-[#183c31] px-2.5 py-2 text-sm text-white">
                  {PERIOD_OPTIONS.map((days) => <option key={days} value={days}>{days} dias</option>)}
                </select>
              </label>

              <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
                {campaign.enabled && campaign.reportUrl && (
                  <>
                    <button type="button" onClick={() => void copyLink(campaign)} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-[#d6e1dc] transition hover:border-[#f5c451]/60 hover:text-[#f5c451]">Copiar link</button>
                    <a href={campaign.reportUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-[#d6e1dc] transition hover:border-[#f5c451]/60 hover:text-[#f5c451]">Abrir ↗</a>
                  </>
                )}
                {data.canManage && (
                  <>
                    <button type="button" disabled={pending} onClick={() => void publish(campaign)} className="rounded-lg bg-[#f5c451] px-3 py-2 text-xs font-bold text-[#112620] transition hover:bg-[#ffda72] disabled:opacity-60">{pending ? "Salvando…" : campaign.enabled ? "Atualizar período" : "Publicar"}</button>
                    {campaign.enabled && (
                      <>
                        <button type="button" disabled={pending} onClick={() => void rotate(campaign)} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-[#d6e1dc] hover:border-white/30 disabled:opacity-60">Novo link</button>
                        <button type="button" disabled={pending} onClick={() => void revoke(campaign)} className="rounded-lg border border-[#ff9b84]/30 px-3 py-2 text-xs font-semibold text-[#ffad9a] hover:bg-[#7a2d20]/30 disabled:opacity-60">Revogar</button>
                      </>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {!data.canManage && <p className="border-t border-white/10 px-5 py-4 text-xs text-[#9bb3aa] sm:px-8 lg:px-10">Seu perfil pode consultar e copiar relatórios publicados. Proprietários e administradores controlam a publicação.</p>}
    </section>
  );
}

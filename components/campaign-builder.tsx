"use client";

/**
 * Campaign Builder
 *
 * Two-pane campaign editor: a control panel on the left and a live phone
 * preview on the right. Used for both creating and editing a campaign.
 *
 * The visual map and detailed form edit one shared state. The map projects the
 * execution contract already supported by the worker; the form owns the full
 * content controls and Instagram preview.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import AutomationFlowMap from "@/components/automation-flow-map";
import PostPicker from "@/components/post-picker";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import {
  buildAutomationFlow,
  type AutomationFlowNodeId,
} from "@/lib/automations/flow-map";
import {
  createDefaultFlowDefinition,
  type FlowDefinitionV1,
} from "@/lib/automations/flow-definition";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

type TriggerScope = "specific" | "any" | "next";
type MatchMode = "specific" | "any";

interface LoadedCampaign {
  id: string;
  name: string;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  dmTriggerEnabled: boolean;
  storyTriggerEnabled?: boolean;
  referralTriggerEnabled?: boolean;
  referralCode?: string | null;
  iceBreakerQuestion?: string | null;
  dmMessage: string;
  dmMessages?: string[];
  humanDelayMinSeconds?: number | null;
  humanDelayMaxSeconds?: number | null;
  aiPublicReplyEnabled?: boolean;
  aiDmEnabled?: boolean;
  aiInstructions?: string | null;
  aiModerationEnabled?: boolean;
  aiModerationSensitivity?: string | null;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  isActive: boolean;
  instagramAccountId: string;
  trackedLinks?: { destinationUrl: string; label?: string | null }[];
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  campaignId?: string;
}

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-border-hover"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? "border-accent" : "border-zinc-500"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex-1 text-foreground">{children}</span>
    </button>
  );
}

function Toggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-zinc-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const [triggerScope, setTriggerScope] = useState<TriggerScope>("specific");
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState("");

  // Post IDs already tied to another automation on this account, so the picker
  // can flag them and the user knows not to double-assign. Maps postId ->
  // the campaign name using it (for the tooltip).
  const [usedPosts, setUsedPosts] = useState<Record<string, string>>({});

  const [matchMode, setMatchMode] = useState<MatchMode>("specific");
  const [keywordText, setKeywordText] = useState("");
  const [dmTriggerEnabled, setDmTriggerEnabled] = useState(false);
  const [storyTriggerEnabled, setStoryTriggerEnabled] = useState(false);
  const [referralTriggerEnabled, setReferralTriggerEnabled] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [iceBreakerQuestion, setIceBreakerQuestion] = useState("");

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");

  const [dmMessage, setDmMessage] = useState("");
  const [dmVariations, setDmVariations] = useState<string[]>([]);
  // New campaigns start with a small random wait so replies do not land the
  // same second as the comment; existing ones keep whatever they had.
  const [humanDelayEnabled, setHumanDelayEnabled] = useState(mode === "new");
  const [humanDelayMin, setHumanDelayMin] = useState(20);
  const [humanDelayMax, setHumanDelayMax] = useState(90);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiPublicReplyEnabled, setAiPublicReplyEnabled] = useState(false);
  const [aiDmEnabled, setAiDmEnabled] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiModerationEnabled, setAiModerationEnabled] = useState(false);
  const [aiModerationSensitivity, setAiModerationSensitivity] = useState<
    "HOSTILE" | "NEGATIVE"
  >("HOSTILE");
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [aiSampleComment, setAiSampleComment] = useState("");
  const [aiPreview, setAiPreview] = useState<{
    heldForHuman: boolean;
    assessment: { sentiment: string; hostile: boolean; needsHuman: boolean; reason: string } | null;
    publicReply: string | null;
    dm: string | null;
  } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("Abrir link");
  const [secondLinkOpen, setSecondLinkOpen] = useState(false);
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("Abrir link");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] =
    useState("Já estou seguindo");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(0);

  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");
  const [builderView, setBuilderView] = useState<"map" | "form">("map");
  const [flowLayout, setFlowLayout] = useState<FlowDefinitionV1>(() =>
    createDefaultFlowDefinition()
  );
  const [flowLayoutRevision, setFlowLayoutRevision] = useState(0);
  const [flowLayoutState, setFlowLayoutState] = useState<
    "idle" | "loading" | "dirty" | "saving" | "saved" | "error" | "conflict"
  >(mode === "edit" ? "loading" : "idle");
  const [flowLayoutMessage, setFlowLayoutMessage] = useState<string | null>(null);
  const [canPersistFlowLayout, setCanPersistFlowLayout] = useState(false);

  // CSV import queue. When present, each save advances to the next row instead
  // of returning to the campaigns list.
  const [importQueue, setImportQueue] = useState<ImportRow[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);

  const keywords = useMemo(
    () =>
      keywordText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    [keywordText]
  );

  // Fetch the connected account's real avatar for the preview (cache-first so
  // it shows instantly on a return visit instead of a blank circle).
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    const cacheKey = `ig-avatar:${selectedAccountId}`;
    const cached = readCache<string | null>(cacheKey, 30 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data !== null) setAvatarUrl(cached.data);

    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/profile?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const url = d.success ? d.data.profilePictureUrl ?? null : null;
        setAvatarUrl(url);
        writeCache(cacheKey, url);
      })
      .catch(() => {
        if (!cancelled && cached.data === null) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // Load accounts (both modes need them for the preview username + selector).
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) => prev || payload.data.selectedInstagramAccountId || next[0]?.id || ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  // Prefill when editing.
  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const c = (payload.data as LoadedCampaign[]).find((x) => x.id === campaignId);
        if (!c) return setNotFound(true);
        setName(c.name);
        setSelectedAccountId(c.instagramAccountId);
        setTriggerScope(
          c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific"
        );
        setPostId(c.postId);
        setPostUrl(c.postUrl);
        setMatchMode(c.matchAnyWord ? "any" : "specific");
        setKeywordText(c.keywords.join(", "));
        setDmTriggerEnabled(c.dmTriggerEnabled ?? false);
        setStoryTriggerEnabled(c.storyTriggerEnabled ?? false);
        setReferralTriggerEnabled(c.referralTriggerEnabled ?? false);
        setReferralCode(c.referralCode ?? null);
        setIceBreakerQuestion(c.iceBreakerQuestion ?? "");
        setPublicReplyEnabled(c.publicReplyEnabled);
        setPublicReplyMessages(
          c.publicReplyMessages?.length
            ? c.publicReplyMessages
            : c.publicReplyMessage
              ? [c.publicReplyMessage]
              : [""]
        );
        setOpeningDmEnabled(c.openingDmEnabled);
        setOpeningDmMessage(c.openingDmMessage ?? "");
        setOpeningDmButtonLabel(c.openingDmButtonLabel ?? "");
        setDmMessage(c.dmMessage);
        setDmVariations(c.dmMessages ?? []);
        setAiPublicReplyEnabled(c.aiPublicReplyEnabled ?? false);
        setAiDmEnabled(c.aiDmEnabled ?? false);
        setAiInstructions(c.aiInstructions ?? "");
        setAiModerationEnabled(c.aiModerationEnabled ?? false);
        setAiModerationSensitivity(
          c.aiModerationSensitivity === "NEGATIVE" ? "NEGATIVE" : "HOSTILE"
        );
        const delayMax = c.humanDelayMaxSeconds ?? 0;
        setHumanDelayEnabled(delayMax > 0);
        if (delayMax > 0) {
          setHumanDelayMin(c.humanDelayMinSeconds ?? 0);
          setHumanDelayMax(delayMax);
        }
        setLinkButtonLabel(c.linkButtonLabel ?? "Abrir link");
        setIsActive(c.isActive);
        const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
        setTrackedDestinationUrl(link);
        setLinkOpen(Boolean(link));
        const secondLink = c.trackedLinks?.[1];
        setSecondaryDestinationUrl(secondLink?.destinationUrl ?? "");
        setSecondaryButtonLabel(secondLink?.label ?? "Abrir link");
        setSecondLinkOpen(Boolean(secondLink?.destinationUrl));
        setRequireFollow(c.requireFollow ?? false);
        setFollowPromptMessage(c.followPromptMessage ?? "");
        setFollowPromptButtonLabel(
          c.followPromptButtonLabel ?? "Já estou seguindo"
        );
        setFollowUpEnabled(c.followUpEnabled ?? false);
        setFollowUpMessage(c.followUpMessage ?? "");
        setFollowUpDelayMinutes(c.followUpDelayMinutes ?? 0);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mode, campaignId]);

  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    let cancelled = false;
    fetch(`/api/automations/${campaignId}/flow`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Não foi possível carregar a organização do mapa");
        }
        if (cancelled) return;
        setFlowLayout(payload.data.definition);
        setFlowLayoutRevision(payload.data.revision);
        setCanPersistFlowLayout(payload.data.canManage === true);
        setFlowLayoutState("idle");
        setFlowLayoutMessage(
          payload.data.source === "recovered"
            ? "Uma organização antiga inválida foi substituída pelo layout seguro padrão."
            : null
        );
      })
      .catch((cause) => {
        if (cancelled) return;
        setFlowLayoutState("error");
        setFlowLayoutMessage(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar a organização do mapa"
        );
      });
    return () => {
      cancelled = true;
    };
  }, [mode, campaignId]);

  // Track which posts on the selected account are already assigned to an
  // automation, so the picker can highlight them. The campaign being edited is
  // excluded — its own post should read as selected, not "taken".
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const map: Record<string, string> = {};
        for (const a of payload.data as LoadedCampaign[]) {
          if (!a.postId) continue;
          if (a.instagramAccountId !== selectedAccountId) continue;
          if (mode === "edit" && a.id === campaignId) continue;
          map[a.postId] = a.name;
        }
        setUsedPosts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, mode, campaignId]);

  // Prefill the editable fields from one queued import row. The reel is left
  // unset so the user picks it per row.
  function prefillFromRow(row: ImportRow) {
    setName(row.name ?? "");
    setTriggerScope("specific");
    setPostId(null);
    setPostUrl(null);
    setPostThumb(null);
    setPostCaption("");
    setMatchMode("specific");
    setKeywordText((row.keywords ?? []).join(", "));
    setDmMessage(row.dmMessage ?? "");
    setPublicReplyEnabled(Boolean(row.publicReply));
    setPublicReplyMessages(row.publicReply ? [row.publicReply] : [""]);
    const hasOpening = Boolean(row.openingDmMessage);
    setOpeningDmEnabled(hasOpening);
    setOpeningDmMessage(row.openingDmMessage ?? "");
    setOpeningDmButtonLabel(
      row.openingDmButtonLabel || (hasOpening ? "Enviar link" : "")
    );
    const link = row.trackedUrl ?? "";
    setTrackedDestinationUrl(link);
    setLinkOpen(Boolean(link));
    setError(null);
  }

  // Pick up a staged CSV import (new mode only) and prefill the first row.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "new") return;
    try {
      const raw = window.localStorage.getItem(IMPORT_QUEUE_KEY);
      const acct = window.localStorage.getItem(IMPORT_ACCOUNT_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as ImportRow[];
      if (!Array.isArray(queue) || queue.length === 0) return;
      setImportQueue(queue);
      setImportTotal(queue.length);
      setBuilderView("form");
      if (acct) setSelectedAccountId(acct);
      prefillFromRow(queue[0]);
    } catch {
      // ignore a malformed queue
    }
  }, [mode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const username =
    accounts.find((a) => a.id === selectedAccountId)?.username ?? "suamarca";

  const flow = useMemo(
    () =>
      buildAutomationFlow({
        triggerScope,
        postSelected: Boolean(postId),
        matchMode,
        keywords,
        dmTriggerEnabled,
        publicReplyEnabled,
        publicReplyMessages,
        openingDmEnabled,
        openingDmMessage,
        openingDmButtonLabel,
        requireFollow,
        followPromptMessage,
        followPromptButtonLabel,
        dmMessage,
        primaryLinkEnabled: linkOpen && Boolean(trackedDestinationUrl.trim()),
        secondaryLinkEnabled:
          secondLinkOpen && Boolean(secondaryDestinationUrl.trim()),
        followUpEnabled,
        followUpMessage,
        followUpDelayMinutes,
      }),
    [
      dmMessage,
      dmTriggerEnabled,
      followPromptButtonLabel,
      followPromptMessage,
      followUpDelayMinutes,
      followUpEnabled,
      followUpMessage,
      keywords,
      linkOpen,
      matchMode,
      openingDmButtonLabel,
      openingDmEnabled,
      openingDmMessage,
      postId,
      publicReplyEnabled,
      publicReplyMessages,
      requireFollow,
      secondLinkOpen,
      secondaryDestinationUrl,
      trackedDestinationUrl,
      triggerScope,
    ]
  );

  function toggleFlowNode(nodeId: AutomationFlowNodeId) {
    if (nodeId === "public-reply") setPublicReplyEnabled((value) => !value);
    if (nodeId === "opening-dm") setOpeningDmEnabled((value) => !value);
    if (nodeId === "follow-gate") setRequireFollow((value) => !value);
    if (nodeId === "follow-up") setFollowUpEnabled((value) => !value);
  }

  function changeFlowLayout(definition: FlowDefinitionV1) {
    setFlowLayout(definition);
    if (mode === "edit") {
      setFlowLayoutState("dirty");
      setFlowLayoutMessage("Organização alterada. Salve o mapa para compartilhar com a equipe.");
    }
  }

  async function saveFlowLayout() {
    if (mode !== "edit" || !campaignId || flowLayoutState === "saving") return;
    setFlowLayoutState("saving");
    setFlowLayoutMessage("Salvando organização…");
    try {
      const response = await fetch(`/api/automations/${campaignId}/flow`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: flowLayoutRevision,
          nodes: flowLayout.nodes,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        if (response.status === 409 && payload.latest) {
          setFlowLayout(payload.latest.definition);
          setFlowLayoutRevision(payload.latest.revision);
          setFlowLayoutState("conflict");
          setFlowLayoutMessage(
            "Outra pessoa salvou primeiro. A versão mais recente foi carregada para evitar sobrescrita."
          );
          return;
        }
        throw new Error(payload.error ?? "Não foi possível salvar a organização do mapa");
      }
      setFlowLayout(payload.data.definition);
      setFlowLayoutRevision(payload.data.revision);
      setFlowLayoutState("saved");
      setFlowLayoutMessage(`Organização salva na revisão ${payload.data.revision}.`);
    } catch (cause) {
      setFlowLayoutState("error");
      setFlowLayoutMessage(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar a organização do mapa"
      );
    }
  }

  function openFlowNode(nodeId: AutomationFlowNodeId) {
    const targetByNode: Record<AutomationFlowNodeId, string> = {
      trigger: "flow-step-trigger",
      "public-reply": "flow-step-public-reply",
      "opening-dm": "flow-step-opening-dm",
      "follow-gate": "flow-step-follow-gate",
      delivery: "flow-step-delivery",
      "follow-up": "flow-step-follow-up",
    };
    setBuilderView("form");
    window.setTimeout(() => {
      document
        .getElementById(targetByNode[nodeId])
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function handlePostSelect(
    id: string,
    url?: string,
    thumb?: string,
    caption?: string
  ) {
    setPostId(id);
    setPostUrl(url ?? null);
    setPostThumb(thumb ?? null);
    setPostCaption(caption ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!cancelled) setAiAvailable(Boolean(payload?.data?.configured));
      })
      .catch(() => {
        if (!cancelled) setAiAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function aiContextPayload() {
    return {
      instagramAccountId: selectedAccountId || null,
      campaignName: name.trim() || null,
      instructions: aiInstructions.trim() || null,
      keywords: matchMode === "any" ? [] : keywords,
    };
  }

  async function generateAiVariations(kind: "publicReply" | "dm") {
    const base =
      kind === "publicReply"
        ? publicReplyMessages.find((m) => m.trim())?.trim()
        : dmMessage.trim();
    if (!base) {
      setAiNotice(
        kind === "publicReply"
          ? "Escreva primeiro uma resposta pública para a IA variar."
          : "Escreva primeiro a DM para a IA variar."
      );
      return;
    }
    const existing = kind === "publicReply" ? publicReplyMessages : dmVariations;
    const room = (kind === "publicReply" ? 10 : 9) - existing.filter((m) => m.trim()).length;
    if (room <= 0) {
      setAiNotice("A lista já está cheia. Remova alguma variação antes de gerar mais.");
      return;
    }
    setAiBusy(kind);
    setAiNotice(null);
    try {
      const res = await fetch("/api/ai/variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          base,
          count: Math.min(4, room),
          ...aiContextPayload(),
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível gerar variações");
      }
      const generated = (payload.data.variations as string[]).filter(
        (v) => !existing.some((m) => m.trim() === v.trim())
      );
      if (generated.length === 0) {
        setAiNotice("A IA não trouxe variações novas. Tente de novo.");
        return;
      }
      if (kind === "publicReply") {
        setPublicReplyMessages((prev) => [...prev.filter((m) => m.trim()), ...generated].slice(0, 10));
      } else {
        setDmVariations((prev) => [...prev.filter((m) => m.trim()), ...generated].slice(0, 9));
      }
      setAiNotice(`${generated.length} variação(ões) adicionada(s). Revise antes de salvar.`);
    } catch (cause) {
      setAiNotice(cause instanceof Error ? cause.message : "Não foi possível gerar variações");
    } finally {
      setAiBusy(null);
    }
  }

  async function runAiPreview() {
    if (!aiSampleComment.trim()) {
      setAiNotice("Digite um comentário de exemplo para testar.");
      return;
    }
    setAiBusy("preview");
    setAiNotice(null);
    setAiPreview(null);
    try {
      const res = await fetch("/api/ai/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentText: aiSampleComment.trim(),
          commenterName: "maria.exemplo",
          publicReplyTemplate: aiPublicReplyEnabled
            ? publicReplyMessages.find((m) => m.trim()) ?? ""
            : undefined,
          dmTemplate: aiDmEnabled ? dmMessage : null,
          hasLink: Boolean(trackedDestinationUrl.trim()),
          moderationSensitivity: aiModerationSensitivity,
          ...aiContextPayload(),
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error ?? "Não foi possível testar a IA");
      }
      setAiPreview(payload.data);
    } catch (cause) {
      setAiNotice(cause instanceof Error ? cause.message : "Não foi possível testar a IA");
    } finally {
      setAiBusy(null);
    }
  }

  function ensureLinkToken() {
    setDmMessage((cur) => (cur.includes("{link}") ? cur : `${cur.trim()} {link}`.trim()));
  }

  async function handleSubmit(activeValue: boolean) {
    setError(null);

    if (!selectedAccountId) return setError("Conecte primeiro uma conta do Instagram.");
    if (triggerScope === "specific" && !postId)
      return setError("Escolha um post ou reel para acionar a campanha.");
    if (matchMode === "specific" && keywords.length === 0)
      return setError("Adicione pelo menos uma palavra-chave ou escolha qualquer palavra.");
    if (!dmMessage.trim()) return setError("Adicione a DM com o link.");
    if (openingDmEnabled && (!openingDmMessage.trim() || !openingDmButtonLabel.trim()))
      return setError("A DM inicial precisa de uma mensagem e do texto do botão.");

    setSaving(true);

    const payload = {
      name: name.trim() || `Campanha para @${username}`,
      instagramAccountId: selectedAccountId,
      postId: triggerScope === "specific" ? postId : null,
      postUrl: triggerScope === "specific" ? postUrl : null,
      matchAnyPost: triggerScope === "any",
      pendingNextReel: triggerScope === "next",
      matchAnyWord: matchMode === "any",
      keywords: matchMode === "any" ? [] : keywords,
      dmTriggerEnabled,
      storyTriggerEnabled,
      referralTriggerEnabled,
      iceBreakerQuestion: iceBreakerQuestion.trim() || null,
      dmMessage,
      dmMessages: dmVariations.map((m) => m.trim()).filter(Boolean),
      humanDelayMinSeconds: humanDelayEnabled ? Math.min(humanDelayMin, humanDelayMax) : 0,
      humanDelayMaxSeconds: humanDelayEnabled ? Math.max(humanDelayMin, humanDelayMax) : 0,
      aiPublicReplyEnabled: aiPublicReplyEnabled && publicReplyEnabled,
      aiDmEnabled,
      aiInstructions: aiInstructions.trim() || null,
      aiModerationEnabled,
      aiModerationSensitivity,
      openingDmEnabled,
      openingDmMessage: openingDmEnabled ? openingDmMessage : null,
      openingDmButtonLabel: openingDmEnabled ? openingDmButtonLabel : null,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled
        ? publicReplyMessages.map((m) => m.trim()).filter(Boolean)
        : [],
      trackedDestinationUrl: trackedDestinationUrl.trim() || "",
      linkButtonLabel: linkButtonLabel.trim() || "Abrir link",
      secondaryDestinationUrl: secondaryDestinationUrl.trim() || "",
      secondaryButtonLabel: secondaryButtonLabel.trim() || "Abrir link",
      requireFollow,
      followPromptMessage: requireFollow ? followPromptMessage.trim() : "",
      followPromptButtonLabel: requireFollow
        ? followPromptButtonLabel.trim() || "Já estou seguindo"
        : "",
      followUpEnabled,
      followUpMessage: followUpEnabled ? followUpMessage.trim() : "",
      followUpDelayMinutes: followUpEnabled ? followUpDelayMinutes : 0,
      isActive: activeValue,
    };

    try {
      const res =
        mode === "new"
          ? await fetch("/api/automations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/automations?id=${campaignId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (data.success) {
        // The post we just assigned is now in use. Reflect it immediately so
        // the picker flags it on the next imported row — the fetch that builds
        // this map doesn't re-run while the builder stays mounted through the
        // import queue.
        if (triggerScope === "specific" && postId) {
          const assignedPostId = postId;
          setUsedPosts((prev) => ({ ...prev, [assignedPostId]: payload.name }));
        }
        // Importing: advance to the next queued row instead of leaving.
        if (importQueue && importQueue.length > 1) {
          const remaining = importQueue.slice(1);
          try {
            window.localStorage.setItem(
              IMPORT_QUEUE_KEY,
              JSON.stringify(remaining)
            );
          } catch {
            // ignore
          }
          setImportQueue(remaining);
          prefillFromRow(remaining[0]);
          setSaving(false);
          if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          return;
        }
        if (importQueue) {
          try {
            window.localStorage.removeItem(IMPORT_QUEUE_KEY);
            window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
          } catch {
            // ignore
          }
        }
        // refresh() busts the router cache so the list reflects the save
        // instead of landing on a stale (empty) campaigns page.
        router.push("/campaigns");
        router.refresh();
      } else {
        // Surface the specific field that failed validation instead of a
        // generic "Invalid input".
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? fieldErrors[firstField][0]
            : data.error ?? "Não foi possível salvar a campanha"
        );
        if (typeof window !== "undefined")
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Não foi possível salvar a campanha");
    } finally {
      setSaving(false);
    }
  }

  // Skip the current imported row without saving a campaign for it, advancing
  // to the next one (or finishing the import if it was the last).
  function skipRow() {
    if (!importQueue) return;
    setError(null);
    if (importQueue.length > 1) {
      const remaining = importQueue.slice(1);
      try {
        window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      setImportQueue(remaining);
      prefillFromRow(remaining[0]);
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      return;
    }
    // Last row skipped — finish the import.
    try {
      window.localStorage.removeItem(IMPORT_QUEUE_KEY);
      window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    router.push("/campaigns");
    router.refresh();
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (notFound) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-muted">Campanha não encontrada.</p>
        <button
          onClick={() => router.push("/campaigns")}
          className="mt-4 rounded border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          Voltar para campanhas
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {importQueue && (
        <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">
            Importando {importTotal - importQueue.length + 1} de {importTotal}.
          </span>{" "}
          <span className="text-muted">
            Os campos vieram preenchidos do CSV. Escolha o reel, edite o que precisar e
            salve para carregar o próximo — ou pule esta campanha.
          </span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {mode === "edit" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground">
                {name || "Campanha sem título"}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  isActive ? "bg-success/15 text-success" : "bg-zinc-500/15 text-muted"
                }`}
              >
                {isActive ? "ATIVA" : "PAUSADA"}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">Nova campanha</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {importQueue && (
            <button
              type="button"
              onClick={skipRow}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              {importQueue.length > 1 ? "Pular" : "Pular e concluir"}
            </button>
          )}
          {mode === "edit" &&
            (isActive ? (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Pausar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Ativar
              </button>
            ))}
          <button
            type="button"
            onClick={() => handleSubmit(mode === "new" ? true : isActive)}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Salvando…" : mode === "new" ? "Ativar" : "Salvar alterações"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/80 p-2">
        <div className="flex rounded-xl bg-background p-1" role="tablist" aria-label="Modo do construtor">
          <button
            type="button"
            role="tab"
            aria-selected={builderView === "map"}
            onClick={() => setBuilderView("map")}
            className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              builderView === "map"
                ? "bg-[#112620] text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Mapa do fluxo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={builderView === "form"}
            onClick={() => setBuilderView("form")}
            className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              builderView === "form"
                ? "bg-[#112620] text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Conteúdo e prévia
          </button>
        </div>
        <p className="px-2 text-[11px] text-muted">
          Visualize a jornada ou refine cada mensagem antes de salvar.
        </p>
      </div>

      {builderView === "map" ? (
        <AutomationFlowMap
          flow={flow}
          layout={flowLayout}
          layoutState={flowLayoutState}
          layoutMessage={flowLayoutMessage}
          isExisting={mode === "edit"}
          canPersist={canPersistFlowLayout}
          onLayoutChange={changeFlowLayout}
          onSaveLayout={() => void saveFlowLayout()}
          onToggleNode={toggleFlowNode}
          onEditNode={openFlowNode}
        />
      ) : (
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-8">
      {/* min-w-0 on the cells: a grid item defaults to min-width:auto, so a
          long string widens the whole page instead of wrapping. */}
      {/* Left: controls */}
      <div className="space-y-8 min-w-0">
        {error && (
          <div className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground">
            Nome da campanha{" "}
            <span className="font-normal text-muted">(opcional)</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: campanha de indicação"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
            maxLength={100}
          />
          {accounts.length > 1 && (
            <div className="pt-2">
              <AccountSelect
                accounts={accounts}
                value={selectedAccountId}
                onChange={(id) => {
                  setSelectedAccountId(id);
                  setPostId(null);
                  setPostUrl(null);
                  setPostThumb(null);
                }}
                includeAll={false}
                label="Conta do Instagram"
              />
            </div>
          )}
        </div>

        <Section id="flow-step-trigger" title="Quando alguém comentar em">
          <Radio
            checked={triggerScope === "specific"}
            onSelect={() => setTriggerScope("specific")}
          >
            um post ou reel específico
          </Radio>
          {triggerScope === "specific" && (
            <div className="rounded-lg border border-border p-2">
              <PostPicker
                selectedPostId={postId}
                instagramAccountId={selectedAccountId}
                usedPostIds={usedPosts}
                onSelect={handlePostSelect}
              />
            </div>
          )}
          <Radio
            checked={triggerScope === "any"}
            onSelect={() => setTriggerScope("any")}
          >
            qualquer post ou reel
          </Radio>
          <Radio
            checked={triggerScope === "next"}
            onSelect={() => setTriggerScope("next")}
          >
            no próximo post ou reel
          </Radio>
        </Section>

        <Section title="E o comentário contiver">
          <Radio
            checked={matchMode === "specific"}
            onSelect={() => setMatchMode("specific")}
          >
            uma ou mais palavras específicas
          </Radio>
          {matchMode === "specific" && (
            <div className="space-y-1">
              <input
                value={keywordText}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder="Digite uma ou mais palavras"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
              />
              <p className="text-xs text-muted">Use vírgulas para separar as palavras</p>
            </div>
          )}
          <Radio
            checked={matchMode === "any"}
            onSelect={() => setMatchMode("any")}
          >
            qualquer palavra
          </Radio>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              responder também quando alguém enviar por DM{" "}
              {matchMode === "any" ? "qualquer mensagem" : "essas palavras"}
            </span>
            <Toggle
              on={dmTriggerEnabled}
              onToggle={() => setDmTriggerEnabled(!dmTriggerEnabled)}
            />
          </div>
          {dmTriggerEnabled && (
            <p className="text-xs text-muted">
              {matchMode === "any"
                ? "Toda DM recebida nesta conta terá a resposta abaixo — use com cuidado."
                : "Uma DM com qualquer uma dessas palavras receberá a mesma resposta, sem precisar de comentário."}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              responder também a respostas e menções nos Stories
            </span>
            <Toggle
              on={storyTriggerEnabled}
              onToggle={() => setStoryTriggerEnabled(!storyTriggerEnabled)}
            />
          </div>
          {storyTriggerEnabled && (
            <p className="text-xs text-muted">
              Quem responder a um story seu{" "}
              {matchMode === "any" ? "com qualquer texto" : "com essas palavras"} ou
              mencionar o perfil em um story recebe a DM desta campanha.
            </p>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              disparar por um link direto para a DM (ig.me)
            </span>
            <Toggle
              on={referralTriggerEnabled}
              onToggle={() => setReferralTriggerEnabled(!referralTriggerEnabled)}
            />
          </div>
          {referralTriggerEnabled && (
            <div className="space-y-1 text-xs text-muted">
              {referralCode ? (
                <p>
                  Link da campanha:{" "}
                  <code className="rounded bg-surface px-1 py-0.5 text-foreground">
                    https://ig.me/m/{username}?ref={referralCode}
                  </code>
                  {" "}— use na bio, em anúncios ou em botões. Quem abrir a conversa
                  por ele recebe a DM desta campanha, sem precisar digitar nada.
                </p>
              ) : (
                <p>O link será gerado ao salvar a campanha.</p>
              )}
            </div>
          )}
          <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
            <label className="text-sm text-foreground">
              pergunta inicial na DM (ice breaker)
            </label>
            <input
              value={iceBreakerQuestion}
              onChange={(e) => setIceBreakerQuestion(e.target.value)}
              placeholder="Ex.: Quero receber o guia gratuito"
              maxLength={80}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
            />
            <p className="text-xs text-muted">
              Aparece como sugestão quando alguém abre uma conversa nova com o perfil;
              ao tocar, a pessoa recebe a DM desta campanha. O Instagram mostra até 4
              perguntas por conta. Deixe em branco para não usar.
            </p>
          </div>
          <div id="flow-step-public-reply" className="scroll-mt-6 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <span className="text-sm text-foreground">
                responder publicamente aos comentários no post
              </span>
              <Toggle
                on={publicReplyEnabled}
                onToggle={() => setPublicReplyEnabled(!publicReplyEnabled)}
              />
            </div>
            {publicReplyEnabled && (
              <div className="space-y-2">
              {publicReplyMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={msg}
                    onChange={(e) =>
                      setPublicReplyMessages((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder="Enviei uma DM para você! 📩"
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  />
                  {publicReplyMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPublicReplyMessages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      className="shrink-0 px-2 text-muted hover:text-error"
                      aria-label="Remover resposta"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                {publicReplyMessages.length < 10 && (
                  <button
                    type="button"
                    onClick={() =>
                      setPublicReplyMessages((prev) => [...prev, ""])
                    }
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    + Adicionar outra resposta
                  </button>
                )}
                {aiAvailable && (
                  <button
                    type="button"
                    disabled={aiBusy !== null}
                    onClick={() => generateAiVariations("publicReply")}
                    className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                  >
                    {aiBusy === "publicReply" ? "Gerando…" : "✨ Gerar variações com IA"}
                  </button>
                )}
              </div>
              {aiNotice && aiBusy === null && (
                <p className="text-xs text-muted">{aiNotice}</p>
              )}
              <p className="text-xs text-muted">
                Uma resposta é escolhida aleatoriamente (nunca a mesma duas
                vezes seguidas) para que os comentários não pareçam idênticos.
                Dentro de qualquer mensagem, {"{oi|olá|e aí}"} sorteia uma das
                opções a cada envio.
              </p>
              </div>
            )}
          </div>
          <div id="flow-step-human-delay" className="scroll-mt-6 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <span className="text-sm text-foreground">
                esperar alguns segundos antes de responder (ritmo humano)
              </span>
              <Toggle
                on={humanDelayEnabled}
                onToggle={() => setHumanDelayEnabled(!humanDelayEnabled)}
              />
            </div>
            {humanDelayEnabled && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="text-xs text-muted">Entre</span>
                  <input
                    type="number"
                    min={0}
                    max={900}
                    value={humanDelayMin}
                    onChange={(e) =>
                      setHumanDelayMin(
                        Math.max(0, Math.min(900, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-muted">e</span>
                  <input
                    type="number"
                    min={0}
                    max={900}
                    value={humanDelayMax}
                    onChange={(e) =>
                      setHumanDelayMax(
                        Math.max(0, Math.min(900, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-muted">segundos</span>
                </div>
                <p className="text-xs text-muted">
                  A resposta pública e a DM saem depois de um tempo sorteado
                  nesse intervalo, como uma pessoa responderia. Máximo de 15
                  minutos.
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section title="A pessoa receberá">
          <div id="flow-step-opening-dm" className="scroll-mt-6 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">uma DM inicial</span>
              <Toggle
                on={openingDmEnabled}
                onToggle={() => setOpeningDmEnabled(!openingDmEnabled)}
              />
            </div>
            {openingDmEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={openingDmMessage}
                  onChange={(e) => setOpeningDmMessage(e.target.value)}
                  placeholder="Olá! Que bom ter você aqui 😊"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={openingDmButtonLabel}
                  onChange={(e) => setOpeningDmButtonLabel(e.target.value)}
                  placeholder="Enviar o link"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={64}
                />
              </div>
            )}
          </div>
          <div id="flow-step-follow-gate" className="scroll-mt-6 mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                uma solicitação para seguir o perfil primeiro
              </span>
              <Toggle
                on={requireFollow}
                onToggle={() => setRequireFollow(!requireFollow)}
              />
            </div>
            {requireFollow && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followPromptMessage}
                  onChange={(e) => setFollowPromptMessage(e.target.value)}
                  placeholder="Antes de enviar o link, siga o perfil e toque no botão abaixo."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={followPromptButtonLabel}
                  onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                  placeholder="Já estou seguindo"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={20}
                />
                <p className="text-xs text-muted">
                  Enviamos o link depois que a pessoa tocar no botão e o Instagram
                  confirmar que ela segue o perfil. Se não for possível verificar,
                  o link será enviado mesmo assim.
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section id="flow-step-delivery" title="Depois, a pessoa receberá">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <span className="text-sm text-foreground">uma DM com um link</span>
            <textarea
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              placeholder="Escreva uma mensagem"
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
              maxLength={1000}
            />
            {linkOpen ? (
              <div className="space-y-2">
                <input
                  value={trackedDestinationUrl}
                  onChange={(e) => setTrackedDestinationUrl(e.target.value)}
                  onBlur={ensureLinkToken}
                  placeholder="https://yourlink.com/offer"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                <input
                  value={linkButtonLabel}
                  onChange={(e) => setLinkButtonLabel(e.target.value)}
                  placeholder="Texto do botão (ex.: Abrir link)"
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                {secondLinkOpen ? (
                  <div className="space-y-2 border-t border-border pt-2">
                    <input
                      value={secondaryDestinationUrl}
                      onChange={(e) => setSecondaryDestinationUrl(e.target.value)}
                      placeholder="https://yourlink.com/second"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    <input
                      value={secondaryButtonLabel}
                      onChange={(e) => setSecondaryButtonLabel(e.target.value)}
                      placeholder="Texto do segundo botão"
                      maxLength={20}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondLinkOpen(true)}
                    className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
                  >
                    + Adicionar um segundo link
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
              >
                + Adicionar um link
              </button>
            )}
            <p className="text-xs text-muted">
              {"{link}"} insere o link rastreado; {"{username}"} personaliza a mensagem;
              {" {oi|olá|e aí}"} sorteia uma opção a cada envio.
            </p>
            <div className="space-y-2 border-t border-border pt-2">
              {dmVariations.map((msg, i) => (
                <div key={i} className="flex items-start gap-2">
                  <textarea
                    value={msg}
                    onChange={(e) =>
                      setDmVariations((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder={`Variação ${i + 2} da DM`}
                    rows={2}
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDmVariations((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="shrink-0 px-2 py-2 text-muted hover:text-error"
                    aria-label="Remover variação"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                {dmVariations.length < 9 && (
                  <button
                    type="button"
                    onClick={() => setDmVariations((prev) => [...prev, ""])}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    + Adicionar uma variação da DM
                  </button>
                )}
                {aiAvailable && (
                  <button
                    type="button"
                    disabled={aiBusy !== null}
                    onClick={() => generateAiVariations("dm")}
                    className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                  >
                    {aiBusy === "dm" ? "Gerando…" : "✨ Gerar variações com IA"}
                  </button>
                )}
              </div>
              {aiNotice && aiBusy === null && (
                <p className="text-xs text-muted">{aiNotice}</p>
              )}
              {dmVariations.length > 0 && (
                <p className="text-xs text-muted">
                  Cada envio usa uma das variações (a mensagem acima é a
                  primeira), sem repetir a última usada.
                </p>
              )}
            </div>
          </div>
          <div id="flow-step-follow-up" className="scroll-mt-6 mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                uma mensagem de agradecimento posterior
              </span>
              <Toggle
                on={followUpEnabled}
                onToggle={() => setFollowUpEnabled(!followUpEnabled)}
              />
            </div>
            {followUpEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder="Obrigado por seguir o perfil! Agradeço o apoio 🙌"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="text-xs text-muted">Enviar</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={followUpDelayMinutes}
                    onChange={(e) =>
                      setFollowUpDelayMinutes(
                        Math.max(0, Math.min(1440, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-muted">
                    minutos após o link
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {followUpDelayMinutes > 0
                    ? `Enviada ${followUpDelayMinutes} min após o clique.`
                    : "Enviada logo após o clique."}
                  {" {username}"} personaliza a mensagem. O máximo é de 24 horas,
                  dentro da janela de mensagens do Instagram.
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section id="flow-step-ai" title="Inteligência artificial">
          {aiAvailable === false && (
            <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted">
              A IA ainda não está configurada nesta instalação (variáveis
              AI_BASE_URL, AI_API_KEY e AI_MODEL). As opções abaixo ficam salvas
              e passam a valer assim que ela for ativada.
            </p>
          )}
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                escrever a resposta pública personalizada para cada comentário
              </span>
              <Toggle
                on={aiPublicReplyEnabled}
                onToggle={() => setAiPublicReplyEnabled(!aiPublicReplyEnabled)}
              />
            </div>
            {aiPublicReplyEnabled && !publicReplyEnabled && (
              <p className="text-xs text-warning">
                Ative &quot;responder publicamente aos comentários&quot; acima para
                a IA ter onde escrever.
              </p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                adaptar a DM ao que a pessoa escreveu
              </span>
              <Toggle on={aiDmEnabled} onToggle={() => setAiDmEnabled(!aiDmEnabled)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                reservar comentários negativos ou ofensivos para uma pessoa responder
              </span>
              <Toggle
                on={aiModerationEnabled}
                onToggle={() => setAiModerationEnabled(!aiModerationEnabled)}
              />
            </div>
            {aiModerationEnabled && (
              <div className="space-y-2">
                <Radio
                  checked={aiModerationSensitivity === "HOSTILE"}
                  onSelect={() => setAiModerationSensitivity("HOSTILE")}
                >
                  só comentários ofensivos, depreciativos ou que pedem atenção humana
                  (reclamação, reembolso, urgência)
                </Radio>
                <Radio
                  checked={aiModerationSensitivity === "NEGATIVE"}
                  onSelect={() => setAiModerationSensitivity("NEGATIVE")}
                >
                  qualquer comentário negativo, mesmo educado
                </Radio>
                <p className="text-xs text-muted">
                  Esses comentários não recebem resposta automática (nem pública, nem
                  DM) e aparecem em Histórico de envios como &quot;Revisão humana&quot;.
                  Quem tiver permissão pode liberar o envio em &quot;Reprocessar&quot;.
                </p>
              </div>
            )}
            {(aiPublicReplyEnabled || aiDmEnabled || aiModerationEnabled) && (
              <div className="space-y-2 border-t border-border pt-3">
                <label className="text-xs text-muted">
                  Instruções para a IA (quem é a marca, tom de voz, o que pode e o
                  que não pode prometer)
                </label>
                <textarea
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  placeholder="Ex.: Somos a KZ3, consultoria de automação com IA para pequenas empresas. Tom próximo e direto, sem gírias. Nunca prometa preço ou prazo; convide a pessoa a ver o material no direct."
                  rows={4}
                  maxLength={2000}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                />
                <p className="text-xs text-muted">
                  A IA nunca inventa preços ou promoções, não usa hashtags, não
                  discute com quem comenta e mantém os marcadores {"{username}"} e
                  {" {link}"}. Se ela falhar, a campanha usa as mensagens escritas acima.
                </p>
                {aiAvailable && (
                  <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                    <label className="text-xs text-muted">
                      Testar com um comentário de exemplo (nada é enviado)
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={aiSampleComment}
                        onChange={(e) => setAiSampleComment(e.target.value)}
                        placeholder={`Ex.: ${keywords[0] ?? "quero"}! Funciona pra loja física?`}
                        maxLength={1000}
                        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={aiBusy !== null}
                        onClick={runAiPreview}
                        className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-border-hover disabled:opacity-50"
                      >
                        {aiBusy === "preview" ? "Testando…" : "Testar"}
                      </button>
                    </div>
                    {aiPreview && (
                      <div className="space-y-1 text-xs text-foreground">
                        {aiPreview.assessment && (
                          <p>
                            <span className="text-muted">Triagem:</span>{" "}
                            {aiPreview.assessment.sentiment === "POSITIVE"
                              ? "positivo"
                              : aiPreview.assessment.sentiment === "NEGATIVE"
                                ? "negativo"
                                : "neutro"}
                            {aiPreview.assessment.hostile ? ", ofensivo" : ""}
                            {aiPreview.assessment.needsHuman ? ", precisa de atenção humana" : ""}
                            {aiPreview.assessment.reason ? ` — ${aiPreview.assessment.reason}` : ""}
                          </p>
                        )}
                        {aiPreview.heldForHuman ? (
                          <p className="text-warning">
                            Este comentário ficaria reservado para revisão humana.
                          </p>
                        ) : (
                          <>
                            {aiPreview.publicReply && (
                              <p>
                                <span className="text-muted">Resposta pública:</span>{" "}
                                {aiPreview.publicReply}
                              </p>
                            )}
                            {aiPreview.dm && (
                              <p>
                                <span className="text-muted">DM:</span> {aiPreview.dm}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {aiNotice && <p className="text-xs text-muted">{aiNotice}</p>}
          </div>
        </Section>
      </div>

      {/* Right: preview */}
      <div>
        <p className="mb-4 text-sm text-muted">Prévia</p>
        <div className="flex min-w-0 justify-center lg:sticky lg:top-6 lg:block">
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            username={username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption={postCaption}
            sampleComment={keywords[0] ?? ""}
            dmTriggerEnabled={dmTriggerEnabled}
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessage={publicReplyMessages.find((m) => m.trim()) ?? ""}
            openingDmEnabled={openingDmEnabled}
            openingDmMessage={openingDmMessage}
            openingDmButtonLabel={openingDmButtonLabel}
            revealMessage={dmMessage}
            hasLink={Boolean(trackedDestinationUrl.trim())}
            linkButtonLabel={linkButtonLabel || "Abrir link"}
            linkUrl={trackedDestinationUrl.trim() || undefined}
            hasSecondLink={
              secondLinkOpen && Boolean(secondaryDestinationUrl.trim())
            }
            secondLinkButtonLabel={secondaryButtonLabel || "Abrir link"}
            requireFollow={requireFollow}
            followPromptMessage={followPromptMessage}
            followPromptButtonLabel={followPromptButtonLabel || "Já estou seguindo"}
            followUpEnabled={followUpEnabled}
            followUpMessage={followUpMessage}
            followUpDelayMinutes={followUpDelayMinutes}
          />
        </div>
      </div>
      </div>
      )}
    </div>
  );
}

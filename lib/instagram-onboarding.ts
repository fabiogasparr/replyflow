export type InstagramConnectionCheck = "expired" | "unknown" | "webhook_pending" | "ready_to_test";

// These are stored configuration checks, not a live token validation or Meta approval.
export function getInstagramConnectionCheck(
  account: { tokenExpiresAt: string | null; webhookSubscribed: boolean },
  now = Date.now(),
): InstagramConnectionCheck {
  if (!account.tokenExpiresAt || !Number.isFinite(Date.parse(account.tokenExpiresAt))) return "unknown";
  if (Date.parse(account.tokenExpiresAt) <= now) return "expired";
  return account.webhookSubscribed ? "ready_to_test" : "webhook_pending";
}

export interface InstagramOnboardingData {
  workspace: { id: string; name: string };
  canManage: boolean;
  oauthConfigured: boolean;
  accountLimit: number | null;
  accounts: Array<{
    id: string;
    username: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
    check: InstagramConnectionCheck;
  }>;
}

export const INSTAGRAM_CHECK_LABELS: Record<InstagramConnectionCheck, string> = {
  expired: "Autorização expirada",
  unknown: "Validade não confirmada",
  webhook_pending: "Notificações pendentes",
  ready_to_test: "Configuração salva · falta testar",
};

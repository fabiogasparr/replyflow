import type {
  BillingEventStatus,
  BillingProvider,
} from "@/app/generated/prisma/client";

export const BILLING_EVENT_STATUS_LABELS: Record<BillingEventStatus, string> = {
  PENDING: "Pendente",
  PROCESSED: "Processado",
  FAILED: "Falhou",
  IGNORED: "Ignorado",
};

export const BILLING_PROVIDER_LABELS: Record<BillingProvider, string> = {
  MANUAL: "Manual",
  MERCADO_PAGO: "Mercado Pago",
  STRIPE: "Stripe",
};

const SENSITIVE_VALUE =
  /\b(token|secret|password|authorization|cookie|card|cvv|cvc|pan)\b\s*[:=]\s*\S+/gi;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export function safeBillingFailureReason(reason: string | null) {
  if (!reason) return null;
  return reason
    .slice(0, 500)
    .replace(BEARER_VALUE, "Bearer [credencial removida]")
    .replace(SENSITIVE_VALUE, "$1=[credencial removida]")
    .slice(0, 500);
}

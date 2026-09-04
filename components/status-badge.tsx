/**
 * Status label for DM status. Plain text; color carries the state.
 */
import { translate, type MessageKey } from "@/lib/i18n";

const statusConfig: Record<string, { text: string; label: MessageKey }> = {
  SENT: { text: "text-success", label: "status.sent" },
  FAILED: { text: "text-error", label: "status.failed" },
  PENDING: { text: "text-warning", label: "status.pending" },
  SKIPPED_DEDUP: { text: "text-muted", label: "status.deduplicated" },
  SKIPPED_RATE_LIMIT: { text: "text-warning", label: "status.rateLimited" },
  SKIPPED_PLAN_LIMIT: { text: "text-warning", label: "status.planLimited" },
  SKIPPED_NO_MATCH: { text: "text-muted", label: "status.noMatch" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.PENDING;

  return (
    <span className={`shrink-0 whitespace-nowrap text-sm ${config.text}`}>
      {translate(config.label)}
    </span>
  );
}

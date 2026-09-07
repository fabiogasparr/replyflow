import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
  sendDirectMessage,
  sendDirectMessageWithLinkButton,
} from "@/lib/meta/client";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";

export type WorkerTrackedLink = {
  slug: string;
  label: string | null;
  destinationUrl: string;
};

export type RevealAutomation = {
  dmMessage: string;
  linkButtonLabel: string | null;
  trackedLinks: WorkerTrackedLink[];
  instagramAccount: { instagramId: string };
};

export function formatWorkerError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `Meta API Error ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

// A plain-text retry cannot fix a refusal tied to the recipient or comment.
// Retrying these failures would consume another delivery attempt and hide the
// provider's original diagnostic behind a less useful second error.
const NON_TEMPLATE_REJECTIONS = [
  /outside of allowed window/i,
  /invalid for a private reply/i,
  /requested user cannot be found/i,
];

export function isTemplateRejection(error: unknown): boolean {
  if (error instanceof TokenExpiredError || error instanceof RateLimitError) {
    return false;
  }
  const message = error instanceof Error ? error.message : "";
  return !NON_TEMPLATE_REJECTIONS.some((pattern) => pattern.test(message));
}

/**
 * Build tappable link buttons. The first link uses the campaign label and each
 * additional link uses its own label. Meta accepts at most three buttons.
 */
export function buildWorkerLinkButtons(
  trackedLinks: WorkerTrackedLink[],
  primaryLabel: string | null
): { title: string; url: string }[] {
  return trackedLinks.slice(0, 3).map((link, index) => ({
    url: buildTrackedUrl(link.slug),
    title: (index === 0 ? primaryLabel : link.label) || link.label || "Abrir link",
  }));
}

/**
 * Preserve every tracked destination when a button template is rejected.
 */
export function buildInlineLinkFallback(
  message: string,
  commenterName: string | null | undefined,
  trackedLinks: WorkerTrackedLink[],
  bodyText: string
): string {
  const base =
    renderMessageWithTracking({ message, commenterName, trackedLinks }) ||
    bodyText;
  const extraUrls = trackedLinks.slice(1).map((link) => buildTrackedUrl(link.slug));
  return extraUrls.length > 0 ? `${base}\n${extraUrls.join("\n")}` : base;
}

/**
 * Deliver the reveal after a button tap or an inbound DM. Both paths already
 * have an open conversation and therefore use direct messages, not a private
 * reply to a comment.
 */
export async function sendRevealDirectMessage(
  accessToken: string,
  automation: RevealAutomation,
  userId: string,
  commenterName: string | null,
  context: string
): Promise<void> {
  if (automation.trackedLinks.length === 0) {
    await sendDirectMessage(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      renderMessageWithTracking({
        message: automation.dmMessage,
        commenterName,
        trackedLinks: automation.trackedLinks,
      })
    );
    return;
  }

  const bodyText =
    renderMessageWithoutLink({
      message: automation.dmMessage,
      commenterName,
    }) || "Aqui está o seu link:";
  const buttons = buildWorkerLinkButtons(
    automation.trackedLinks,
    automation.linkButtonLabel
  );

  try {
    await sendDirectMessageWithLinkButton(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      bodyText,
      buttons
    );
  } catch (buttonError) {
    if (!isTemplateRejection(buttonError)) throw buttonError;

    console.log(
      `[DM Worker] Button template rejected in ${context}, falling back to inline link:`,
      formatWorkerError(buttonError)
    );
    try {
      await sendDirectMessage(
        accessToken,
        automation.instagramAccount.instagramId,
        userId,
        buildInlineLinkFallback(
          automation.dmMessage,
          commenterName,
          automation.trackedLinks,
          bodyText
        )
      );
    } catch {
      throw buttonError;
    }
  }
}

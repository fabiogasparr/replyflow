import type { Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import {
  getUserFollowStatus,
  sendDirectMessageWithButton,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import {
  recordAutomationFailure,
  recordAutomationSuccess,
} from "@/lib/automations/operational-state";
import { renderMessageWithoutLink } from "@/lib/tracking/message";
import {
  FOLLOWUP_JOB_NAME,
  getDMQueue,
  type ProcessPostbackJob,
} from "../client";
import {
  formatWorkerError as formatError,
  sendRevealDirectMessage,
} from "../delivery";
import {
  BUTTON_TAP_LOG_TEXT,
  DEFAULT_FOLLOW_PROMPT_BUTTON_LABEL,
  DEFAULT_FOLLOW_PROMPT_MESSAGE,
  INVALID_INSTAGRAM_TOKEN_ERROR,
  MISSING_INSTAGRAM_TOKEN_ERROR,
  monthlyDmLimitError,
} from "../user-facing-copy";

/**
 * Deliver the reveal message after a user taps an opening DM's button.
 * The postback payload is `reveal:<automationId>`; the sender is the user's
 * IGSID (same id as their comment author id), which we DM directly.
 */
export async function processPostback(
  job: Job<ProcessPostbackJob>
): Promise<void> {
  const { instagramAccountId, userId, payload, fallback } = job.data;

  const isFollowCheck = payload.startsWith("followcheck:");
  if (!isFollowCheck && !payload.startsWith("reveal:")) return;
  const automationId = payload.slice(
    isFollowCheck ? "followcheck:".length : "reveal:".length
  );

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId
  ) {
    return;
  }
  if (!automation.instagramAccount.accessToken) {
    await recordAutomationFailure(
      automation.id,
      new Error(MISSING_INSTAGRAM_TOKEN_ERROR)
    );
    return;
  }

  // Duplicate sends are enabled: every button tap re-sends the reveal
  // instead of only firing once per person.
  const dedupeId = `reveal:${userId}`;
  const postbackReplayData = {
    triggerType: "POSTBACK" as const,
    sourceEventId: userId,
    source: "WEBHOOK",
  };

  if (fallback) {
    const existingReveal = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
    });
    if (existingReveal?.status === "SENT") return;
  }

  // Personalize {username} from the opening DM log for this user, if present.
  const openingLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: userId },
    select: { commenterName: true },
  });
  const commenterName = openingLog?.commenterName ?? null;

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    await recordAutomationFailure(
      automation.id,
      new Error(INVALID_INSTAGRAM_TOKEN_ERROR)
    );
    return;
  }

  // Follow-gate: before revealing the link, verify the user follows. On a
  // `followcheck:` tap a non-follower gets the prompt again (no quota spent);
  // on a read fallback a non-follower is silently skipped — the gate must not
  // be bypassable by just reading the DM and waiting. Following, or
  // unverifiable (null), falls through and delivers the link — fail-open so a
  // real follower is never trapped.
  if ((isFollowCheck || fallback) && automation.requireFollow) {
    const follows = await getUserFollowStatus(accessToken, userId);
    if (follows === false) {
      if (fallback) return;
      const promptText = renderMessageWithoutLink({
        message:
          automation.followPromptMessage || DEFAULT_FOLLOW_PROMPT_MESSAGE,
        commenterName,
      });
      try {
        await sendDirectMessageWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          userId,
          promptText,
          automation.followPromptButtonLabel ||
            DEFAULT_FOLLOW_PROMPT_BUTTON_LABEL,
          `followcheck:${automation.id}`
        );
      } catch (error) {
        console.log(
          "[DM Worker] Failed to re-send follow prompt:",
          formatError(error)
        );
      }
      return;
    }
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
      create: {
        ...postbackReplayData,
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: BUTTON_TAP_LOG_TEXT,
        commentId: dedupeId,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: monthlyDmLimitError(usage.limit),
      },
      update: { ...postbackReplayData, status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  try {
    await sendRevealDirectMessage(
      accessToken,
      automation,
      userId,
      commenterName,
      "postback"
    );
    // Optional appreciation follow-up: once the link has been delivered, send a
    // short thank-you. It is scheduled as its own delayed job so it can go out
    // some minutes later (followUpDelayMinutes) rather than immediately. The
    // deterministic job id dedupes repeat button taps to one follow-up per user.
    if (automation.followUpEnabled && automation.followUpMessage?.trim()) {
      const delayMs =
        Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000;
      await getDMQueue().add(
        FOLLOWUP_JOB_NAME,
        {
          instagramAccountId: automation.instagramAccount.instagramId,
          userId,
          automationId: automation.id,
          commenterName,
        },
        {
          delay: delayMs,
          jobId: `followup_${automation.id}_${userId}`,
        }
      );
    }
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
      create: {
        ...postbackReplayData,
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: BUTTON_TAP_LOG_TEXT,
        commentId: dedupeId,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: {
        ...postbackReplayData,
        status: "SENT",
        dmSentAt: new Date(),
        errorMessage: null,
      },
    });
    await recordAutomationSuccess(automation.id);
  } catch (error) {
    await releaseWorkspaceDMReservation(
      automation.workspaceId,
      usage.periodStart
    );

    // The read fallback is speculative: it only runs when the user read the
    // opening DM and never tapped the button, which means they never messaged
    // us, which means the 24-hour window is closed and Meta rejects the send
    // ("outside of allowed window"). That is the expected outcome here, not a
    // failure the user can act on — so don't log it as FAILED and don't retry
    // it against a window that cannot reopen on its own. It still delivers in
    // the case that does work: the user replied by typing instead of tapping.
    if (fallback) {
      console.log(
        "[DM Worker] Read fallback not delivered (messaging window closed):",
        formatError(error)
      );
      return;
    }

    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
      create: {
        ...postbackReplayData,
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: BUTTON_TAP_LOG_TEXT,
        commentId: dedupeId,
        status: "FAILED",
        errorMessage: formatError(error),
      },
      update: {
        ...postbackReplayData,
        status: "FAILED",
        errorMessage: formatError(error),
      },
    });
    await recordAutomationFailure(automation.id, error);
    throw error;
  }
}

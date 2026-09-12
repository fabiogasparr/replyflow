import type { Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import {
  getUserFollowStatus,
  sendDirectMessageWithButton,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import {
  recordAutomationFailure,
  recordAutomationSuccess,
} from "@/lib/automations/operational-state";
import { renderMessageWithoutLink } from "@/lib/tracking/message";
import { reserveDMSlot } from "@/lib/utils/rate-limiter";
import {
  pickHumanDelayMs,
  resolveMessageText,
  waitForSendSlot,
} from "@/lib/messaging/pacing";
import {
  FOLLOWUP_JOB_NAME,
  MESSAGE_JOB_NAME,
  getDMQueue,
  type ProcessMessageJob,
} from "../client";
import {
  formatWorkerError as formatError,
  sendRevealDirectMessage,
} from "../delivery";
import {
  DEFAULT_FOLLOW_PROMPT_BUTTON_LABEL,
  DEFAULT_FOLLOW_PROMPT_MESSAGE,
  INVALID_INSTAGRAM_TOKEN_ERROR,
  MISSING_INSTAGRAM_TOKEN_ERROR,
  hourlyDmLimitError,
  hourlyDmRetryMessage,
  inactiveAutomationError,
  monthlyDmLimitError,
} from "../user-facing-copy";

/**
 * Reply to an inbound DM whose text matches a campaign's keywords.
 *
 * The user has messaged us, so the conversation is already open: this path
 * skips the opening DM (which exists to work around private-reply limits from
 * comments) and delivers the reveal directly, honouring the follow gate.
 * Dedup is per inbound message id, so each message triggers at most one reply.
 */
export async function processMessage(
  job: Job<ProcessMessageJob>
): Promise<void> {
  const { instagramAccountId, messageId, messageText, senderId } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  const automations = await prisma.automation.findMany({
    where: {
      ...(job.data.automationId ? { id: job.data.automationId } : {}),
      dmTriggerEnabled: true,
      isActive: true,
      instagramAccount: { instagramId: instagramAccountId },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const dedupeId = `dm:${messageId}`;

  if (job.data.automationId && automations.length === 0) {
    await prisma.dmLog.updateMany({
      where: {
        automationId: job.data.automationId,
        commentId: dedupeId,
        status: "PENDING",
        deliveryAttemptedAt: null,
      },
      data: {
        status: "FAILED",
        errorMessage: inactiveAutomationError,
      },
    });
    return;
  }

  for (const automation of automations) {
    const matchResult = job.data.automationId
      ? { matched: true, matchedKeyword: job.data.matchedKeyword ?? null }
      : automation.matchAnyWord
        ? { matched: true, matchedKeyword: null }
        : matchKeywords(
            messageText,
            automation.keywords,
            automation.wholeWordMatch
          );

    if (!matchResult.matched) continue;

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
    });

    // Already replied to this message (or deliberately skipped it) — a retry
    // of the job must not send a second DM.
    if (
      existingLog?.status === "SENT" ||
      existingLog?.status === "SKIPPED_PLAN_LIMIT"
    ) {
      continue;
    }
    if (existingLog?.status === "FAILED" && existingLog.deliveryAttemptedAt) {
      continue;
    }

    // Human delay: answer a DM a few seconds later than instantly, like a
    // person would. Served by a delayed job scoped to this campaign.
    const humanDelayMs =
      job.data.automationId || job.data.humanDelayApplied
        ? 0
        : pickHumanDelayMs(automation);
    if (humanDelayMs > 0) {
      await getDMQueue().add(
        MESSAGE_JOB_NAME,
        {
          ...job.data,
          automationId: automation.id,
          matchedKeyword: matchResult.matchedKeyword,
          humanDelayApplied: true,
        },
        {
          delay: humanDelayMs,
          jobId: `message_${instagramAccountId}_${Buffer.from(messageId).toString("base64url")}_${automation.id}_delayed`,
        }
      );
      continue;
    }

    const logBase = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      commenterId: senderId,
      commentText: messageText,
      commentId: dedupeId,
      matchedKeyword: matchResult.matchedKeyword,
      triggerType: "MESSAGE" as const,
      sourceEventId: messageId,
      source: "WEBHOOK",
    };

    if (!automation.instagramAccount.accessToken) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: "FAILED",
          errorMessage: MISSING_INSTAGRAM_TOKEN_ERROR,
        },
        update: {
          ...logBase,
          status: "FAILED",
          errorMessage: MISSING_INSTAGRAM_TOKEN_ERROR,
        },
      });
      await recordAutomationFailure(
        automation.id,
        new Error(MISSING_INSTAGRAM_TOKEN_ERROR)
      );
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: "FAILED",
          errorMessage: INVALID_INSTAGRAM_TOKEN_ERROR,
        },
        update: {
          ...logBase,
          status: "FAILED",
          errorMessage: INVALID_INSTAGRAM_TOKEN_ERROR,
        },
      });
      await recordAutomationFailure(
        automation.id,
        new Error(INVALID_INSTAGRAM_TOKEN_ERROR)
      );
      continue;
    }

    // Reuse a name captured on an earlier interaction so {username} still
    // renders — the messages webhook carries only the sender's IGSID.
    const priorLog = await prisma.dmLog.findFirst({
      where: { automationId: automation.id, commenterId: senderId },
      select: { commenterName: true },
    });
    const commenterName = priorLog?.commenterName ?? null;

    // Follow gate: anyone not confirmed as a follower gets the prompt instead of
    // the link, with the same `followcheck:` button that re-verifies on tap.
    // `null` (unverifiable) prompts too — this is first contact, exactly like a
    // comment, so it follows processComment's fail-closed rule rather than the
    // postback path's fail-open one. Fail-open is only safe after a tap, where
    // the user has already claimed to follow; here it would hand the link to
    // anyone whose status the API happens not to resolve.
    let sendFollowPrompt = false;
    if (automation.requireFollow) {
      const follows = await getUserFollowStatus(accessToken, senderId);
      sendFollowPrompt = follows !== true;
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
          ...logBase,
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: monthlyDmLimitError(usage.limit),
        },
        update: {
          ...logBase,
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: monthlyDmLimitError(usage.limit),
        },
      });
      continue;
    }

    // Same per-account hourly ceiling as comment replies: a DM burst from the
    // keyword trigger must not push the account past Meta's cap.
    const rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      const skipped = rateLimit.shouldSkip;
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          status: skipped ? "SKIPPED_RATE_LIMIT" : "PENDING",
          errorMessage: skipped ? hourlyDmLimitError : hourlyDmRetryMessage,
        },
        update: {
          ...logBase,
          status: skipped ? "SKIPPED_RATE_LIMIT" : "PENDING",
          errorMessage: skipped ? hourlyDmLimitError : hourlyDmRetryMessage,
        },
      });
      if (rateLimit.shouldRequeue) {
        await getDMQueue().add(
          MESSAGE_JOB_NAME,
          {
            ...job.data,
            automationId: automation.id,
            matchedKeyword: matchResult.matchedKeyword,
            humanDelayApplied: true,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `message_${instagramAccountId}_${Buffer.from(messageId).toString("base64url")}_${automation.id}_retry_${requeueAttempt + 1}`,
          }
        );
      }
      continue;
    }

    const followPromptText = sendFollowPrompt
      ? ((await resolveMessageText(
          automation.id,
          "followPrompt",
          automation.followPromptMessage || DEFAULT_FOLLOW_PROMPT_MESSAGE
        )) ?? DEFAULT_FOLLOW_PROMPT_MESSAGE)
      : null;
    const dmText =
      (await resolveMessageText(
        automation.id,
        "dm",
        automation.dmMessage,
        automation.dmMessages
      )) ?? automation.dmMessage;

    const deliveryAttemptedAt = new Date();
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
      create: {
        ...logBase,
        commenterName,
        status: "PENDING",
        attempts: job.attemptsMade + 1,
        deliveryAttemptedAt,
      },
      update: {
        ...logBase,
        commenterName,
        status: "PENDING",
        attempts: job.attemptsMade + 1,
        errorMessage: null,
        deliveryAttemptedAt,
      },
    });

    try {
      await waitForSendSlot(instagramAccountId);
      if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message: followPromptText as string,
          commenterName,
        });
        await sendDirectMessageWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          senderId,
          promptText,
          automation.followPromptButtonLabel ||
            DEFAULT_FOLLOW_PROMPT_BUTTON_LABEL,
          `followcheck:${automation.id}`
        );
      } else {
        await sendRevealDirectMessage(
          accessToken,
          { ...automation, dmMessage: dmText },
          senderId,
          commenterName,
          "message trigger"
        );

        // The link has been delivered, so the appreciation follow-up applies
        // here exactly as it does after a button tap. Not scheduled behind the
        // follow prompt — no link went out yet in that branch.
        if (automation.followUpEnabled && automation.followUpMessage?.trim()) {
          await getDMQueue().add(
            FOLLOWUP_JOB_NAME,
            {
              instagramAccountId: automation.instagramAccount.instagramId,
              userId: senderId,
              automationId: automation.id,
              commenterName,
            },
            {
              delay:
                Math.max(0, automation.followUpDelayMinutes ?? 0) * 60_000,
              jobId: `followup_${automation.id}_${senderId}`,
            }
          );
        }
      }

      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          commenterName,
          status: "SENT",
          dmSentAt: new Date(),
        },
        update: {
          ...logBase,
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
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          ...logBase,
          commenterName,
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
        update: {
          ...logBase,
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      await recordAutomationFailure(automation.id, error);
      throw error;
    }
  }
}

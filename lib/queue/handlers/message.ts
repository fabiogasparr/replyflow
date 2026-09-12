import type { Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import { sendDirectMessageWithButton } from "@/lib/meta/client";
import {
  checkAndRecordFollowStatus,
  pickAudienceDmTemplate,
} from "@/lib/audience/follow-status";
import { scheduleFollowRechecks } from "@/lib/audience/follow-recheck";
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
  assessComment,
  generatePersonalizedDm,
  humanReviewMessage,
  shouldHoldForHuman,
} from "@/lib/ai/comment-intelligence";
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

function interactionLabel(kind: string): string {
  switch (kind) {
    case "story_reply":
      return "Resposta a um story";
    case "story_mention":
      return "Menção em um story";
    case "referral":
      return "Abriu a conversa por um link ig.me";
    case "ice_breaker":
      return "Tocou em uma pergunta inicial";
    default:
      return "";
  }
}

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
  const kind = job.data.kind ?? "dm";
  // Story mentions, referrals and ice breakers carry no keyword to match: the
  // interaction itself is the intent, so every eligible campaign fires.
  const matchesWithoutKeywords =
    kind === "story_mention" || kind === "referral" || kind === "ice_breaker";
  const triggerType =
    kind === "story_reply" || kind === "story_mention"
      ? ("STORY" as const)
      : kind === "referral"
        ? ("REFERRAL" as const)
        : kind === "ice_breaker"
          ? ("ICE_BREAKER" as const)
          : ("MESSAGE" as const);

  const eligibility = job.data.automationId
    ? { id: job.data.automationId }
    : kind === "dm"
      ? { dmTriggerEnabled: true }
      : kind === "story_reply"
        ? { OR: [{ storyTriggerEnabled: true }, { dmTriggerEnabled: true }] }
        : kind === "story_mention"
          ? { storyTriggerEnabled: true }
          : kind === "referral"
            ? {
                referralTriggerEnabled: true,
                referralCode: job.data.referralCode ?? "__none__",
              }
            : // ice_breaker without automationId cannot be resolved
              { id: "__none__" };

  const automations = await prisma.automation.findMany({
    where: {
      ...eligibility,
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
      : matchesWithoutKeywords || automation.matchAnyWord
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
      existingLog?.status === "SKIPPED_PLAN_LIMIT" ||
      (existingLog?.status === "SKIPPED_HUMAN_REVIEW" &&
        !job.data.approvedByOperator)
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
      commentText: messageText || interactionLabel(kind),
      commentId: dedupeId,
      matchedKeyword: matchResult.matchedKeyword,
      triggerType,
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

    const aiContext = {
      brandUsername: automation.instagramAccount.username,
      campaignName: automation.name,
      campaignGoal: automation.goal,
      instructions: automation.aiInstructions,
      keywords: automation.keywords,
    };
    // AI triage: a hostile inbound DM is parked for a person instead of
    // getting an automatic reply (an operator reprocess releases it).
    if (automation.aiModerationEnabled && !job.data.approvedByOperator) {
      const assessment = await assessComment(messageText, aiContext);
      if (shouldHoldForHuman(assessment, automation.aiModerationSensitivity)) {
        const reason = humanReviewMessage(assessment!);
        const held = {
          ...logBase,
          commenterName,
          status: "SKIPPED_HUMAN_REVIEW" as const,
          aiSentiment: assessment!.sentiment,
          aiReviewReason: reason,
          errorMessage: reason,
        };
        await prisma.dmLog.upsert({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId: dedupeId,
            },
          },
          create: held,
          update: held,
        });
        await prisma.operationalEvent
          .create({
            data: {
              workspaceId: automation.workspaceId,
              source: "SYSTEM",
              level: "WARNING",
              message: `DM de @${commenterName ?? senderId} reservada para revisão humana na campanha "${automation.name}"`,
              payload: {
                automationId: automation.id,
                messageId,
                messageText: messageText.slice(0, 500),
                sentiment: assessment!.sentiment,
                reason,
              },
            },
          })
          .catch(() => {});
        continue;
      }
    }

    // Follow gate: anyone not confirmed as a follower gets the prompt instead of
    // the link, with the same `followcheck:` button that re-verifies on tap.
    // `null` (unverifiable) prompts too — this is first contact, exactly like a
    // comment, so it follows processComment's fail-closed rule rather than the
    // postback path's fail-open one. Fail-open is only safe after a tap, where
    // the user has already claimed to follow; here it would hand the link to
    // anyone whose status the API happens not to resolve.
    let sendFollowPrompt = false;
    let follows: boolean | null = null;
    if (automation.requireFollow || automation.audienceDmEnabled) {
      follows = (
        await checkAndRecordFollowStatus({
          accessToken,
          workspaceId: automation.workspaceId,
          instagramAccountId: automation.instagramAccountId,
          userId: senderId,
        })
      ).follows;
    }
    if (automation.requireFollow) {
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
    const audienceTemplate = pickAudienceDmTemplate(automation, follows);
    const templateDmText =
      (await resolveMessageText(
        automation.id,
        "dm",
        audienceTemplate ?? automation.dmMessage,
        audienceTemplate ? [] : automation.dmMessages
      )) ?? automation.dmMessage;
    const dmText =
      automation.aiDmEnabled && !sendFollowPrompt
        ? ((await generatePersonalizedDm({
            commentText: messageText,
            commenterName,
            template: templateDmText,
            hasLink: automation.trackedLinks.length > 0,
            context: aiContext,
          })) ?? templateDmText)
        : templateDmText;

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
        await scheduleFollowRechecks({
          instagramAccountId: automation.instagramAccount.instagramId,
          userId: senderId,
          automationId: automation.id,
        }).catch(() => {});
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

import type { Job } from "bullmq";
import type { ProcessFollowUpJob } from "../client";
import { prisma } from "@/lib/db/client";
import { sendDirectMessage } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  recordAutomationFailure,
  recordAutomationSuccess,
} from "@/lib/automations/operational-state";
import { renderMessageWithoutLink } from "@/lib/tracking/message";
import { formatWorkerError } from "../delivery";

/**
 * Send a scheduled appreciation follow-up. This handler is deliberately
 * best-effort: a closed messaging window is recorded but never retried forever.
 */
export async function processFollowUp(
  job: Job<ProcessFollowUpJob>
): Promise<void> {
  const { instagramAccountId, userId, automationId, commenterName } = job.data;

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: { instagramAccount: true },
  });

  if (
    !automation ||
    !automation.followUpEnabled ||
    !automation.followUpMessage?.trim() ||
    automation.instagramAccount.instagramId !== instagramAccountId
  ) {
    return;
  }
  if (!automation.instagramAccount.accessToken) {
    await recordAutomationFailure(
      automation.id,
      new Error("No Instagram access token available")
    );
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    await recordAutomationFailure(
      automation.id,
      new Error("Failed to decrypt Instagram access token")
    );
    return;
  }

  try {
    await sendDirectMessage(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      renderMessageWithoutLink({
        message: automation.followUpMessage,
        commenterName: commenterName ?? null,
      })
    );
    await recordAutomationSuccess(automation.id);
  } catch (error) {
    await recordAutomationFailure(automation.id, error);
    console.log(
      "[DM Worker] Failed to send follow-up message:",
      formatWorkerError(error)
    );
  }
}

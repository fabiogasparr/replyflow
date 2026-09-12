/**
 * Automatic follow re-check.
 *
 * After a "follow the profile first" prompt, nothing tells us when the person
 * actually follows — Meta has no follow webhook — so historically the link
 * only went out when they tapped the button again. These delayed jobs verify
 * the status on their own and deliver the link as soon as it is true, so a
 * person who followed and moved on still gets what they asked for.
 */

import { POSTBACK_JOB_NAME, getDMQueue } from "@/lib/queue/client";

const DEFAULT_RECHECK_MINUTES = [10, 60];

export function followRecheckDelaysMinutes(
  env: Record<string, string | undefined> = process.env
): number[] {
  const raw = env.FOLLOW_RECHECK_MINUTES;
  if (!raw) return DEFAULT_RECHECK_MINUTES;
  const parsed = raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0 && v <= 24 * 60);
  return parsed.length > 0 ? [...new Set(parsed)].sort((a, b) => a - b) : DEFAULT_RECHECK_MINUTES;
}

export async function scheduleFollowRechecks(input: {
  instagramAccountId: string; // IG business id
  userId: string;
  automationId: string;
}): Promise<void> {
  const queue = getDMQueue();
  for (const minutes of followRecheckDelaysMinutes()) {
    await queue.add(
      POSTBACK_JOB_NAME,
      {
        instagramAccountId: input.instagramAccountId,
        userId: input.userId,
        payload: `followcheck:${input.automationId}`,
        autoRecheck: true,
      },
      {
        delay: minutes * 60_000,
        jobId: `followrecheck_${input.automationId}_${input.userId}_${minutes}`,
      }
    );
  }
}

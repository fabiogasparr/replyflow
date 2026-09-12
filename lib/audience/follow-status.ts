/**
 * Follower status: verify it with Meta and remember it on the Contact so the
 * directory can segment followers from non-followers and the worker can pick
 * audience-specific wording without a second API call in the same run.
 */

import { prisma } from "@/lib/db/client";
import { getUserFollowProfile } from "@/lib/meta/client";

export interface FollowCheckInput {
  accessToken: string;
  workspaceId: string;
  /** Row id of InstagramAccount (not the IG business id). */
  instagramAccountId: string;
  /** IGSID of the person (comment author id / DM sender id). */
  userId: string;
}

export interface FollowCheckResult {
  follows: boolean | null;
  followedBy: boolean | null;
}

/**
 * Ask Meta whether `userId` follows the account and persist the answer on the
 * contact (creating a minimal contact row when ingestion has not made one yet).
 * Persistence is best-effort and never blocks the send.
 */
export async function checkAndRecordFollowStatus(
  input: FollowCheckInput
): Promise<FollowCheckResult> {
  const profile = await getUserFollowProfile(input.accessToken, input.userId);
  const result = { follows: profile.follows, followedBy: profile.followedBy };

  if (result.follows === null && result.followedBy === null) return result;

  const now = new Date();
  try {
    await prisma.contact.upsert({
      where: {
        workspaceId_instagramAccountId_instagramScopedId: {
          workspaceId: input.workspaceId,
          instagramAccountId: input.instagramAccountId,
          instagramScopedId: input.userId,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        instagramAccountId: input.instagramAccountId,
        instagramScopedId: input.userId,
        username: profile.username ?? null,
        usernameObservedAt: profile.username ? now : null,
        followsAccount: result.follows,
        followedByAccount: result.followedBy,
        followStatusCheckedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        followsAccount: result.follows,
        followedByAccount: result.followedBy,
        followStatusCheckedAt: now,
      },
    });
  } catch {
    // best-effort: the send never waits on the directory
  }

  return result;
}

/**
 * Wording for the link DM given the audience configuration of a campaign.
 * Empty audience texts and unverifiable status fall back to the default.
 */
export function pickAudienceDmTemplate(
  automation: {
    dmMessage: string;
    audienceDmEnabled?: boolean | null;
    followerDmMessage?: string | null;
    nonFollowerDmMessage?: string | null;
  },
  follows: boolean | null
): string | null {
  if (!automation.audienceDmEnabled) return null;
  if (follows === true && automation.followerDmMessage?.trim()) {
    return automation.followerDmMessage.trim();
  }
  if (follows === false && automation.nonFollowerDmMessage?.trim()) {
    return automation.nonFollowerDmMessage.trim();
  }
  return null;
}

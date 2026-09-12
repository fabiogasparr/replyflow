/**
 * BullMQ Queue Client
 *
 * Provides the DM processing queue and Redis connection for BullMQ.
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return connection;
}

// ─── DM Queue ───────────────────────────────────────────────────────────────────

export type CommentSource = "WEBHOOK" | "POLLING" | "MANUAL";

export interface ProcessCommentJob {
  // Set by an operator retry to target exactly one campaign. Webhook/polling
  // jobs intentionally leave it empty so normal matching still considers all
  // active campaigns.
  automationId?: string;
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  matchedKeyword?: string | null;
  mediaId: string;
  // Set when the comment came from an ad: the organic post the ad was made
  // from. Campaigns are bound to that post, so both ids have to be matched.
  originalMediaId?: string;
  requeueAttempt?: number;
  // Set once the campaign's random "human delay" has been served: the job was
  // re-enqueued with that delay and must now send without waiting again.
  humanDelayApplied?: boolean;
  // Set by an operator reprocess. Skips the AI sentiment triage so a comment
  // held for human review can be released deliberately.
  approvedByOperator?: boolean;
  // Which path enqueued this comment. Recorded in the shared ProcessedComment
  // dedup store so the reconciler can tell webhook- from polling-caught comments.
  source?: CommentSource;
}

// Delivered when a user taps an opening DM's button — carries the reveal target.
export interface ProcessPostbackJob {
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  fallback?: boolean;
}

// Scheduled after the link is delivered, to send the appreciation follow-up.
// Enqueued with a delay (followUpDelayMinutes) so it can fire later, not just
// immediately.
export interface ProcessFollowUpJob {
  instagramAccountId: string;
  userId: string;
  automationId: string;
  commenterName?: string | null;
}

// How a conversation-side trigger reached us. "dm" is a plain inbound DM
// (keyword campaigns), the rest are richer interactions parsed by
// parseInteractionEvents plus the ice-breaker tap routed from a postback.
export type MessageTriggerKind =
  | "dm"
  | "story_reply"
  | "story_mention"
  | "referral"
  | "ice_breaker";

// An inbound DM (or story reply / mention / ig.me referral / ice breaker) from
// a user. Which campaigns are eligible depends on `kind`; keyword matching
// applies to kinds that carry text.
export interface ProcessMessageJob {
  automationId?: string;
  instagramAccountId: string;
  messageId: string;
  messageText: string;
  senderId: string;
  kind?: MessageTriggerKind;
  referralCode?: string;
  matchedKeyword?: string | null;
  humanDelayApplied?: boolean;
  approvedByOperator?: boolean;
  requeueAttempt?: number;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessFollowUpJob
  | ProcessMessageJob;

export const POSTBACK_JOB_NAME = "process-postback";
export const FOLLOWUP_JOB_NAME = "process-followup";
export const MESSAGE_JOB_NAME = "process-message";

let dmQueue: Queue<DmQueueJob> | null = null;

export function getDMQueue(): Queue<DmQueueJob> {
  if (!dmQueue) {
    dmQueue = new Queue<DmQueueJob>("dm-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 }, // Keep last 1000 completed jobs
        // Clear failed jobs shortly after they exhaust retries. Job ids are
        // deterministic (comment_<acct>_<id>), so a retained failed job would
        // block the polling reconciler from ever retrying that comment. Clearing
        // them lets a later sweep re-enqueue and try again once a transient
        // failure (e.g. an Instagram rate-limit window) has passed. Failure
        // detail is still preserved in DmLog.
        removeOnFail: { age: 300, count: 2000 },
        attempts: 3,
        backoff: {
          type: "custom",
        },
      },
    });
  }
  return dmQueue;
}

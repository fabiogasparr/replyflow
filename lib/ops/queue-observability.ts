import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";

export type QueueHealthStatus =
  | "IDLE"
  | "HEALTHY"
  | "DEGRADED"
  | "CRITICAL"
  | "UNAVAILABLE";

export type ObservableQueueJob = {
  data?: { instagramAccountId?: unknown };
  timestamp?: number;
  delay?: number;
  processedOn?: number;
};

export type WorkspaceQueueSnapshot = {
  status: QueueHealthStatus;
  counts: { waiting: number; active: number; delayed: number; failed: number };
  oldestWaitingAt: string | null;
  oldestWaitingAgeMs: number | null;
  nextDelayedAt: string | null;
  truncated: boolean;
  scanLimit: number;
  checkedAt: string;
};

type JobsByState = {
  waiting: ObservableQueueJob[];
  active: ObservableQueueJob[];
  delayed: ObservableQueueJob[];
  failed: ObservableQueueJob[];
};

type QueueSnapshotOptions = {
  scanLimit?: number;
  warningAgeMs?: number;
  criticalAgeMs?: number;
};

const DEFAULT_SCAN_LIMIT = 1_000;
const DEFAULT_WARNING_AGE_MS = 60_000;
const DEFAULT_CRITICAL_AGE_MS = 5 * 60_000;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function belongsToWorkspace(job: ObservableQueueJob, accountIds: Set<string>) {
  return (
    typeof job.data?.instagramAccountId === "string" &&
    accountIds.has(job.data.instagramAccountId)
  );
}

export function summarizeWorkspaceQueueJobs(
  jobs: JobsByState,
  instagramAccountIds: Iterable<string>,
  now = new Date(),
  options?: QueueSnapshotOptions
): WorkspaceQueueSnapshot {
  const accountIds = new Set(instagramAccountIds);
  return summarizeQueueJobs(
    jobs,
    (job) => belongsToWorkspace(job, accountIds),
    now,
    options
  );
}

export function summarizePlatformQueueJobs(
  jobs: JobsByState,
  now = new Date(),
  options?: QueueSnapshotOptions
): WorkspaceQueueSnapshot {
  return summarizeQueueJobs(jobs, () => true, now, options);
}

function summarizeQueueJobs(
  jobs: JobsByState,
  includeJob: (job: ObservableQueueJob) => boolean,
  now: Date,
  options?: QueueSnapshotOptions
): WorkspaceQueueSnapshot {
  const scanLimit = options?.scanLimit ?? DEFAULT_SCAN_LIMIT;
  const scoped = {
    waiting: jobs.waiting.filter(includeJob),
    active: jobs.active.filter(includeJob),
    delayed: jobs.delayed.filter(includeJob),
    failed: jobs.failed.filter(includeJob),
  };
  const oldestWaitingTimestamp = [...scoped.waiting, ...scoped.active]
    .map((job) => job.processedOn ?? job.timestamp)
    .filter((value): value is number => Number.isFinite(value))
    .reduce<number | null>(
      (oldest, value) => (oldest == null || value < oldest ? value : oldest),
      null
    );
  const oldestWaitingAgeMs =
    oldestWaitingTimestamp == null
      ? null
      : Math.max(0, now.getTime() - oldestWaitingTimestamp);
  const nextDelayedTimestamp = scoped.delayed
    .map((job) =>
      Number.isFinite(job.timestamp)
        ? (job.timestamp as number) + Math.max(0, job.delay ?? 0)
        : null
    )
    .filter((value): value is number => value != null)
    .reduce<number | null>(
      (next, value) => (next == null || value < next ? value : next),
      null
    );
  const warningAgeMs = options?.warningAgeMs ?? DEFAULT_WARNING_AGE_MS;
  const criticalAgeMs = options?.criticalAgeMs ?? DEFAULT_CRITICAL_AGE_MS;
  const hasJobs = Object.values(scoped).some((items) => items.length > 0);
  const status: QueueHealthStatus = !hasJobs
    ? "IDLE"
    : oldestWaitingAgeMs != null && oldestWaitingAgeMs >= criticalAgeMs
      ? "CRITICAL"
      : oldestWaitingAgeMs != null && oldestWaitingAgeMs >= warningAgeMs
        ? "DEGRADED"
        : scoped.failed.length > 0
          ? "DEGRADED"
        : "HEALTHY";

  return {
    status,
    counts: {
      waiting: scoped.waiting.length,
      active: scoped.active.length,
      delayed: scoped.delayed.length,
      failed: scoped.failed.length,
    },
    oldestWaitingAt:
      oldestWaitingTimestamp == null
        ? null
        : new Date(oldestWaitingTimestamp).toISOString(),
    oldestWaitingAgeMs,
    nextDelayedAt:
      nextDelayedTimestamp == null
        ? null
        : new Date(nextDelayedTimestamp).toISOString(),
    truncated: Object.values(jobs).some((items) => items.length >= scanLimit),
    scanLimit,
    checkedAt: now.toISOString(),
  };
}

function getSnapshotOptions() {
  const scanLimit = Math.min(
    10_000,
    positiveNumber(process.env.QUEUE_OBSERVABILITY_SCAN_LIMIT, DEFAULT_SCAN_LIMIT)
  );
  return {
    scanLimit,
    warningAgeMs: positiveNumber(
      process.env.QUEUE_WARNING_AGE_MS,
      DEFAULT_WARNING_AGE_MS
    ),
    criticalAgeMs: positiveNumber(
      process.env.QUEUE_CRITICAL_AGE_MS,
      DEFAULT_CRITICAL_AGE_MS
    ),
  };
}

async function getQueueJobs(scanLimit: number): Promise<JobsByState> {
  const queue = getDMQueue();
  const [waiting, active, delayed, failed] = await Promise.all([
    queue.getJobs("wait", 0, scanLimit - 1, true),
    queue.getJobs("active", 0, scanLimit - 1, true),
    queue.getJobs("delayed", 0, scanLimit - 1, true),
    queue.getJobs("failed", 0, scanLimit - 1, true),
  ]);
  return { waiting, active, delayed, failed };
}

export async function getWorkspaceQueueSnapshot(
  workspaceId: string
): Promise<WorkspaceQueueSnapshot> {
  const options = getSnapshotOptions();
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    select: { instagramId: true },
  });
  const jobs = await getQueueJobs(options.scanLimit);

  return summarizeWorkspaceQueueJobs(
    jobs,
    accounts.map((account) => account.instagramId),
    new Date(),
    options
  );
}

export async function getPlatformQueueSnapshot(): Promise<WorkspaceQueueSnapshot> {
  const options = getSnapshotOptions();
  return summarizePlatformQueueJobs(
    await getQueueJobs(options.scanLimit),
    new Date(),
    options
  );
}

export function unavailableQueueSnapshot(
  now = new Date()
): WorkspaceQueueSnapshot {
  return {
    status: "UNAVAILABLE",
    counts: { waiting: 0, active: 0, delayed: 0, failed: 0 },
    oldestWaitingAt: null,
    oldestWaitingAgeMs: null,
    nextDelayedAt: null,
    truncated: false,
    scanLimit: 0,
    checkedAt: now.toISOString(),
  };
}

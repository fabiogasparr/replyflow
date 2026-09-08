import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    billingEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    plan: { findUnique: vi.fn() },
    subscription: { update: vi.fn() },
    workspace: { update: vi.fn() },
  };

  return {
    mockTx: tx,
    mockPrisma: {
      $transaction: vi.fn((callback: (txArg: typeof tx) => unknown) =>
        callback(tx)
      ),
      billingEvent: { findUnique: vi.fn() },
    },
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  entitledPlanForStatus,
  processSubscriptionEvent,
  sanitizeBillingMetadata,
  type SubscriptionEventInput,
} from "@/lib/billing/events";

const occurredAt = new Date("2026-09-08T10:00:00.000Z");

function eventInput(
  overrides: Partial<SubscriptionEventInput> = {}
): SubscriptionEventInput {
  return {
    workspaceId: "workspace_1",
    provider: "STRIPE",
    providerEventId: "evt_1",
    type: "subscription.updated",
    occurredAt,
    planCode: "PRO",
    status: "ACTIVE",
    providerCustomerId: "cus_1",
    providerSubscriptionId: "sub_1",
    currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
    metadata: { source: "webhook" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T10:01:00.000Z"));

  mockTx.billingEvent.findUnique.mockResolvedValue(null);
  mockTx.$queryRaw.mockResolvedValue([
    { id: "subscription_1", provider: "MANUAL", lastProviderEventAt: null },
  ]);
  mockTx.billingEvent.create.mockResolvedValue({ id: "billing_event_1" });
  mockTx.billingEvent.update.mockResolvedValue({});
  mockTx.plan.findUnique.mockResolvedValue({ isActive: true });
  mockTx.subscription.update.mockResolvedValue({});
  mockTx.workspace.update.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sanitizeBillingMetadata", () => {
  it("keeps operational context and strips secrets and payment data", () => {
    expect(
      sanitizeBillingMetadata({
        source: "webhook",
        attempt: 2,
        accessToken: "secret-token",
        cardNumber: "4111111111111111",
        password: "not-for-storage",
      })
    ).toEqual({ source: "webhook", attempt: 2 });
  });
});

describe("entitledPlanForStatus", () => {
  it.each(["TRIALING", "ACTIVE", "PAST_DUE"] as const)(
    "keeps the requested plan while status is %s",
    (status) => {
      expect(entitledPlanForStatus(status, "AGENCY")).toBe("AGENCY");
    }
  );

  it.each(["CANCELED", "INCOMPLETE"] as const)(
    "returns to FREE when status is %s",
    (status) => {
      expect(entitledPlanForStatus(status, "AGENCY")).toBe("FREE");
    }
  );
});

describe("processSubscriptionEvent", () => {
  it("returns an existing event without applying the state again", async () => {
    mockTx.billingEvent.findUnique.mockResolvedValue({ id: "existing_event" });

    await expect(processSubscriptionEvent(eventInput())).resolves.toEqual({
      result: "DUPLICATE",
      eventId: "existing_event",
    });
    expect(mockTx.$queryRaw).not.toHaveBeenCalled();
    expect(mockTx.subscription.update).not.toHaveBeenCalled();
  });

  it("treats a concurrent unique-key race as a duplicate", async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.10.0",
      })
    );
    mockPrisma.billingEvent.findUnique.mockResolvedValue({
      id: "concurrent_event",
    });

    await expect(processSubscriptionEvent(eventInput())).resolves.toEqual({
      result: "DUPLICATE",
      eventId: "concurrent_event",
    });
  });

  it("ignores a stale event after locking the subscription", async () => {
    mockTx.$queryRaw.mockResolvedValue([
      {
        id: "subscription_1",
        provider: "STRIPE",
        lastProviderEventAt: new Date("2026-09-08T10:05:00.000Z"),
      },
    ]);

    await expect(processSubscriptionEvent(eventInput())).resolves.toEqual({
      result: "IGNORED_STALE",
      eventId: "billing_event_1",
    });
    expect(mockTx.billingEvent.update).toHaveBeenCalledWith({
      where: { id: "billing_event_1" },
      data: {
        status: "IGNORED",
        processedAt: new Date("2026-09-08T10:01:00.000Z"),
      },
    });
    expect(mockTx.subscription.update).not.toHaveBeenCalled();
    expect(mockTx.workspace.update).not.toHaveBeenCalled();
  });

  it("rejects an event from a provider different from the subscription", async () => {
    mockTx.$queryRaw.mockResolvedValue([
      {
        id: "subscription_1",
        provider: "MERCADO_PAGO",
        lastProviderEventAt: null,
      },
    ]);

    const result = await processSubscriptionEvent(eventInput());

    expect(result).toMatchObject({ result: "FAILED" });
    expect(mockTx.subscription.update).not.toHaveBeenCalled();
    expect(mockTx.workspace.update).not.toHaveBeenCalled();
  });

  it("updates subscription, entitlement and audit event atomically", async () => {
    await expect(processSubscriptionEvent(eventInput())).resolves.toEqual({
      result: "PROCESSED",
      eventId: "billing_event_1",
    });

    expect(mockTx.plan.findUnique).toHaveBeenCalledWith({
      where: { code: "PRO" },
      select: { isActive: true },
    });
    expect(mockTx.subscription.update).toHaveBeenCalledWith({
      where: { id: "subscription_1" },
      data: expect.objectContaining({
        planCode: "PRO",
        provider: "STRIPE",
        status: "ACTIVE",
        lastProviderEventAt: occurredAt,
        lastProviderEventId: "evt_1",
      }),
    });
    expect(mockTx.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace_1" },
      data: { plan: "PRO" },
    });
    expect(mockTx.billingEvent.update).toHaveBeenLastCalledWith({
      where: { id: "billing_event_1" },
      data: {
        status: "PROCESSED",
        processedAt: new Date("2026-09-08T10:01:00.000Z"),
        subscriptionId: "subscription_1",
        failureReason: null,
      },
    });
  });

  it("downgrades canceled subscriptions to FREE even if the old plan is inactive", async () => {
    await processSubscriptionEvent(
      eventInput({ status: "CANCELED", planCode: "AGENCY" })
    );

    expect(mockTx.plan.findUnique).toHaveBeenCalledWith({
      where: { code: "FREE" },
      select: { isActive: true },
    });
    expect(mockTx.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ planCode: "FREE" }),
      })
    );
    expect(mockTx.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace_1" },
      data: { plan: "FREE" },
    });
  });

  it("records an invalid billing period as failed without changing access", async () => {
    const result = await processSubscriptionEvent(
      eventInput({
        currentPeriodStart: new Date("2026-10-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      })
    );

    expect(result).toMatchObject({
      result: "FAILED",
      reason: "O fim do período precisa ser posterior ao início",
    });
    expect(mockTx.subscription.update).not.toHaveBeenCalled();
    expect(mockTx.workspace.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid identity before opening a transaction", async () => {
    await expect(
      processSubscriptionEvent(eventInput({ providerEventId: "  " }))
    ).rejects.toThrow("precisa de um identificador");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

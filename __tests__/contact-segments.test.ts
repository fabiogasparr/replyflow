import { describe, expect, it } from "vitest";
import {
  buildContactSegmentQueries,
  contactSegmentFiltersSchema,
} from "@/lib/contact-segments";

function parse(input: Record<string, unknown> = {}) {
  return contactSegmentFiltersSchema.parse(input);
}

function queryText(query: ReturnType<typeof buildContactSegmentQueries>["ids"]) {
  return query.strings.join("?");
}

describe("contact segment contract", () => {
  it("defaults to the whole directory with bounded pagination", () => {
    expect(parse()).toEqual({
      page: 1,
      pageSize: 25,
      search: "",
      instagramAccountId: "",
      tag: "",
      automationId: "",
      origin: "",
      engagement: "",
      follow: "",
      activeWithinDays: 0,
    });
  });

  it("segments followers, non-followers and unverified contacts", () => {
    const sqlFor = (follow: string) =>
      queryText(
        buildContactSegmentQueries({
          workspaceId: "workspace_1",
          filters: parse({ follow }),
        }).ids
      );
    expect(sqlFor("FOLLOWERS")).toContain('contact."followsAccount" = TRUE');
    expect(sqlFor("NON_FOLLOWERS")).toContain('contact."followsAccount" = FALSE');
    expect(sqlFor("UNKNOWN")).toContain('contact."followsAccount" IS NULL');
    expect(sqlFor("")).not.toContain("followsAccount");
    expect(contactSegmentFiltersSchema.safeParse({ follow: "FRIENDS" }).success).toBe(false);
  });

  it.each([
    { origin: "POSTBACK" },
    { engagement: "UNKNOWN" },
    { activeWithinDays: 14 },
    { activeWithinDays: -7 },
    { activeWithinDays: "tomorrow" },
  ])("rejects an unsupported segment %#", (input) => {
    expect(contactSegmentFiltersSchema.safeParse(input).success).toBe(false);
  });

  it("keeps user-controlled values parameterized and repeats workspace scope", () => {
    const malicious = "automation_1' OR TRUE --";
    const queries = buildContactSegmentQueries({
      workspaceId: "workspace_1",
      filters: parse({
        automationId: malicious,
        origin: "COMMENT",
        engagement: "FAILED",
      }),
    });
    const sql = queryText(queries.ids);

    expect(sql).toContain("EXISTS");
    expect(sql).toContain('automation."workspaceId"');
    expect(sql).not.toContain(malicious);
    expect(queries.ids.values).toContain(malicious);
    expect(
      queries.ids.values.filter((value) => value === "workspace_1").length
    ).toBeGreaterThanOrEqual(4);
  });

  it("combines filters against the same interaction and computes an exact cutoff", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const queries = buildContactSegmentQueries({
      workspaceId: "workspace_1",
      now,
      filters: parse({
        page: 3,
        pageSize: 10,
        search: "@Maria",
        instagramAccountId: "account_1",
        tag: "VIP",
        automationId: "automation_1",
        origin: "MESSAGE",
        engagement: "SENT",
        activeWithinDays: 30,
      }),
    });
    const sql = queryText(queries.ids);

    expect(sql).toContain('contact."lastSeenAt" >=');
    expect(sql).toContain('log."automationId"');
    expect(sql).toContain('log."triggerType"::text');
    expect(sql).toContain('log."status"::text');
    expect(queries.ids.values).toContainEqual(
      new Date("2026-08-11T12:00:00.000Z")
    );
    expect(queries.ids.values).toEqual(expect.arrayContaining([10, 20]));
  });

  it("matches every skipped outcome as one operational group", () => {
    const queries = buildContactSegmentQueries({
      workspaceId: "workspace_1",
      filters: parse({ engagement: "SKIPPED" }),
    });

    expect(queryText(queries.ids)).toContain("LIKE 'SKIPPED_%'");
    expect(queries.ids.values).not.toContain("SKIPPED");
  });
});

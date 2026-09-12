import { Prisma } from "@/app/generated/prisma/client";
import { z } from "zod";
import { contactFiltersSchema } from "@/lib/contacts";

export const CONTACT_SEGMENT_PERIODS = [0, 7, 30, 90, 365] as const;

export const contactSegmentFiltersSchema = contactFiltersSchema.extend({
  automationId: z.string().trim().max(100).default(""),
  origin: z.enum(["", "COMMENT", "MESSAGE"]).default(""),
  engagement: z
    .enum(["", "SENT", "FAILED", "PENDING", "SKIPPED"])
    .default(""),
  // Follower relationship as last verified by the worker (Contact.followsAccount).
  follow: z.enum(["", "FOLLOWERS", "NON_FOLLOWERS", "UNKNOWN"]).default(""),
  activeWithinDays: z.coerce
    .number()
    .int()
    .refine(
      (value) =>
        CONTACT_SEGMENT_PERIODS.includes(
          value as (typeof CONTACT_SEGMENT_PERIODS)[number]
        ),
      "Período de atividade inválido"
    )
    .default(0),
});

export type ContactSegmentFilters = z.infer<typeof contactSegmentFiltersSchema>;

export type ContactSegmentQueries = {
  ids: Prisma.Sql;
  total: Prisma.Sql;
};

function activityPredicate(
  workspaceId: string,
  filters: ContactSegmentFilters
) {
  const activityClauses: Prisma.Sql[] = [
    Prisma.sql`log."workspaceId" = ${workspaceId}`,
    Prisma.sql`log."instagramAccountId" = contact."instagramAccountId"`,
    Prisma.sql`log."commenterId" = contact."instagramScopedId"`,
    Prisma.sql`automation."workspaceId" = ${workspaceId}`,
    Prisma.sql`automation."instagramAccountId" = contact."instagramAccountId"`,
  ];

  if (filters.automationId) {
    activityClauses.push(
      Prisma.sql`log."automationId" = ${filters.automationId}`
    );
  }
  if (filters.origin) {
    activityClauses.push(
      Prisma.sql`log."triggerType"::text = ${filters.origin}`
    );
  }
  if (filters.engagement === "SKIPPED") {
    activityClauses.push(Prisma.sql`log."status"::text LIKE 'SKIPPED_%'`);
  } else if (filters.engagement) {
    activityClauses.push(
      Prisma.sql`log."status"::text = ${filters.engagement}`
    );
  }

  return Prisma.sql`EXISTS (
    SELECT 1
    FROM "DmLog" AS log
    INNER JOIN "Automation" AS automation
      ON automation."id" = log."automationId"
    WHERE ${Prisma.join(activityClauses, " AND ")}
  )`;
}

export function buildContactSegmentQueries(input: {
  workspaceId: string;
  filters: ContactSegmentFilters;
  now?: Date;
}): ContactSegmentQueries {
  const { workspaceId, filters } = input;
  const clauses: Prisma.Sql[] = [
    Prisma.sql`contact."workspaceId" = ${workspaceId}`,
    Prisma.sql`account."workspaceId" = ${workspaceId}`,
  ];

  if (filters.instagramAccountId && filters.instagramAccountId !== "all") {
    clauses.push(
      Prisma.sql`contact."instagramAccountId" = ${filters.instagramAccountId}`
    );
  }
  if (filters.tag) {
    clauses.push(Prisma.sql`${filters.tag} = ANY(contact."tags")`);
  }
  if (filters.search) {
    const usernameSearch = filters.search.replace(/^@/, "");
    clauses.push(Prisma.sql`(
      STRPOS(LOWER(COALESCE(contact."username", '')), LOWER(${usernameSearch})) > 0
      OR STRPOS(contact."instagramScopedId", ${filters.search}) > 0
    )`);
  }
  if (filters.follow === "FOLLOWERS") {
    clauses.push(Prisma.sql`contact."followsAccount" = TRUE`);
  } else if (filters.follow === "NON_FOLLOWERS") {
    clauses.push(Prisma.sql`contact."followsAccount" = FALSE`);
  } else if (filters.follow === "UNKNOWN") {
    clauses.push(Prisma.sql`contact."followsAccount" IS NULL`);
  }
  if (filters.activeWithinDays > 0) {
    const cutoff = new Date(
      (input.now ?? new Date()).getTime() -
        filters.activeWithinDays * 24 * 60 * 60 * 1_000
    );
    clauses.push(Prisma.sql`contact."lastSeenAt" >= ${cutoff}`);
  }
  if (filters.automationId || filters.origin || filters.engagement) {
    clauses.push(activityPredicate(workspaceId, filters));
  }

  const fromAndWhere = Prisma.sql`
    FROM "Contact" AS contact
    INNER JOIN "InstagramAccount" AS account
      ON account."id" = contact."instagramAccountId"
      AND account."workspaceId" = contact."workspaceId"
    WHERE ${Prisma.join(clauses, " AND ")}
  `;
  const offset = (filters.page - 1) * filters.pageSize;

  return {
    ids: Prisma.sql`
      SELECT contact."id"
      ${fromAndWhere}
      ORDER BY contact."lastSeenAt" DESC, contact."id" DESC
      LIMIT ${filters.pageSize}
      OFFSET ${offset}
    `,
    total: Prisma.sql`
      SELECT COUNT(*)::integer AS total
      ${fromAndWhere}
    `,
  };
}

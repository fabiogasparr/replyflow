import { z } from "zod";
import { contactFieldValuesSchema, type ContactCustomField } from "@/lib/contact-custom-fields";

export const CONTACT_PAGE_SIZE = 25;
export const CONTACT_MAX_PAGE_SIZE = 100;
export const CONTACT_MAX_TAGS = 10;
export const CONTACT_MAX_TAG_LENGTH = 30;
export const CONTACT_MAX_NOTES_LENGTH = 5000;

export type ContactAccount = { id: string; username: string };

export type ContactSummary = {
  id: string;
  instagramAccountId: string;
  instagramScopedId: string;
  username: string | null;
  tags: string[];
  version: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  instagramAccount: ContactAccount;
};

export type ContactDetail = ContactSummary & { notes: string | null };

export type ContactInteraction = {
  id: string;
  commentText: string;
  matchedKeyword: string | null;
  status: string;
  createdAt: string;
  dmSentAt: string | null;
  automation: { id: string; name: string };
};

export type ContactsListData = {
  contacts: ContactSummary[];
  total: number;
  page: number;
  pageSize: number;
  accounts: ContactAccount[];
  automations: Array<{ id: string; name: string; instagramAccountId: string }>;
  canEdit: boolean;
};

export type ContactDetailData = {
  contact: ContactDetail;
  customFields: ContactCustomField[];
  canEdit: boolean;
  canExport: boolean;
  canErase: boolean;
};

export type ContactInteractionsData = {
  interactions: ContactInteraction[];
  total: number;
  page: number;
  pageSize: number;
};

export const contactPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(CONTACT_MAX_PAGE_SIZE).default(CONTACT_PAGE_SIZE),
});

export const contactFiltersSchema = contactPaginationSchema.extend({
  search: z.string().trim().max(100).default(""),
  instagramAccountId: z.string().trim().max(100).default(""),
  tag: z.string().trim().max(CONTACT_MAX_TAG_LENGTH).default(""),
});

export const updateContactSchema = z.strictObject({
  version: z.number().int().min(0).max(2_147_483_646),
  tags: z.array(z.string().trim().min(1).max(CONTACT_MAX_TAG_LENGTH))
    .max(CONTACT_MAX_TAGS)
    .transform((tags) => {
      const seen = new Set<string>();
      return tags.filter((tag) => {
        const normalized = tag.toLocaleLowerCase("pt-BR");
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
    }).optional(),
  notes: z.string().max(CONTACT_MAX_NOTES_LENGTH).trim().nullable()
    .transform((notes) => notes || null).optional(),
  customFields: contactFieldValuesSchema.optional(),
}).refine((input) => input.tags !== undefined || input.notes !== undefined || input.customFields !== undefined, {
  message: "Informe etiquetas, anotações ou campos personalizados para atualizar o contato.",
});

// Explicit selections keep notes out of lists and account credentials out of all responses.
export const contactSummarySelect = {
  id: true,
  instagramAccountId: true,
  instagramScopedId: true,
  username: true,
  tags: true,
  version: true,
  firstSeenAt: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
  instagramAccount: { select: { id: true, username: true } },
} as const;

export const contactDetailSelect = { ...contactSummarySelect, notes: true } as const;

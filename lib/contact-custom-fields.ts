import { z } from "zod";

export const CONTACT_FIELD_MAX_ACTIVE = 20;
export const CONTACT_FIELD_MAX_TOTAL = 100;
export const CONTACT_FIELD_MAX_NAME = 60;
export const CONTACT_FIELD_MAX_OPTIONS = 20;
export const CONTACT_FIELD_MAX_OPTION_LENGTH = 50;
export const CONTACT_FIELD_MAX_VALUE = 1000;

export const contactCustomFieldTypes = [
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
] as const;

export type ContactCustomFieldTypeValue = (typeof contactCustomFieldTypes)[number];

export type ContactCustomField = {
  id: string;
  name: string;
  type: ContactCustomFieldTypeValue;
  options: string[];
  position: number;
  isActive: boolean;
  value: string | null;
};

export function normalizeContactFieldName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

const fieldNameSchema = z.string().trim().min(1).max(CONTACT_FIELD_MAX_NAME).refine(
  (name) => normalizeContactFieldName(name).length <= CONTACT_FIELD_MAX_NAME,
  "O nome normalizado excede o limite.",
);

const fieldOptionSchema = z.string().trim().min(1).max(CONTACT_FIELD_MAX_OPTION_LENGTH).transform(
  (option) => option.normalize("NFKC"),
).refine(
  (option) => option.length <= CONTACT_FIELD_MAX_OPTION_LENGTH,
  "A opção normalizada excede o limite.",
);

const optionsSchema = z.array(fieldOptionSchema).max(CONTACT_FIELD_MAX_OPTIONS).transform((options) => {
  const seen = new Set<string>();
  return options.filter((option) => {
    const normalized = option.toLocaleLowerCase("pt-BR");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
});

export const createContactFieldSchema = z.strictObject({
  name: fieldNameSchema,
  type: z.enum(contactCustomFieldTypes),
  options: optionsSchema.optional(),
}).superRefine((input, context) => {
  if (input.type === "SELECT" && !input.options?.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "Informe ao menos uma opção." });
  }
  if (input.type !== "SELECT" && input.options?.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "Este tipo não aceita opções." });
  }
});

export const updateContactFieldSchema = z.strictObject({
  name: fieldNameSchema.optional(),
  options: optionsSchema.optional(),
  isActive: z.boolean().optional(),
}).refine((input) => Object.keys(input).length > 0, {
  message: "Informe uma alteração.",
});

export const contactFieldValuesSchema = z.array(z.strictObject({
  fieldDefinitionId: z.string().min(1).max(100),
  value: z.string().max(CONTACT_FIELD_MAX_VALUE).nullable(),
})).min(1).max(CONTACT_FIELD_MAX_ACTIVE).superRefine((values, context) => {
  const seen = new Set<string>();
  values.forEach((item, index) => {
    if (seen.has(item.fieldDefinitionId)) {
      context.addIssue({
        code: "custom",
        path: [index, "fieldDefinitionId"],
        message: "Cada campo pode ser enviado apenas uma vez.",
      });
    }
    seen.add(item.fieldDefinitionId);
  });
});

export class ContactFieldValueError extends Error {
  constructor(public readonly fieldDefinitionId: string, message: string) {
    super(message);
    this.name = "ContactFieldValueError";
  }
}

function normalizeNumber(value: string) {
  const compact = value.trim().replace(",", ".");
  if (!/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(compact)) return null;
  const negative = compact.startsWith("-");
  const unsigned = negative ? compact.slice(1) : compact;
  const [integer, decimals = ""] = unsigned.split(".");
  const normalizedDecimals = decimals.replace(/0+$/, "");
  const normalized = normalizedDecimals ? `${integer}.${normalizedDecimals}` : integer;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function normalizeContactFieldValue(
  definition: { id: string; type: ContactCustomFieldTypeValue; options: string[] },
  rawValue: string | null,
) {
  const value = rawValue?.normalize("NFKC").trim() ?? "";
  if (!value) return null;

  if (definition.type === "TEXT") return value;
  if (definition.type === "NUMBER") {
    const number = normalizeNumber(value);
    if (number === null) {
      throw new ContactFieldValueError(definition.id, "Informe um número com até 12 inteiros e 4 casas decimais.");
    }
    return number;
  }
  if (definition.type === "DATE") {
    if (!validDate(value)) {
      throw new ContactFieldValueError(definition.id, "Informe uma data válida.");
    }
    return value;
  }
  if (definition.type === "BOOLEAN") {
    if (value !== "true" && value !== "false") {
      throw new ContactFieldValueError(definition.id, "Escolha sim ou não.");
    }
    return value;
  }
  if (!definition.options.includes(value)) {
    throw new ContactFieldValueError(definition.id, "Escolha uma das opções configuradas.");
  }
  return value;
}

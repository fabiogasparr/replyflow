import { describe, expect, it } from "vitest";
import {
  contactFieldValuesSchema,
  createContactFieldSchema,
  normalizeContactFieldName,
  normalizeContactFieldValue,
} from "@/lib/contact-custom-fields";

describe("contact custom field validation", () => {
  it("normalizes names for case-insensitive workspace uniqueness", () => {
    expect(normalizeContactFieldName("  Etapa   COMERCIAL  ")).toBe("etapa comercial");
    expect(normalizeContactFieldName("Orçamento")).toBe("orçamento");
  });

  it.each([
    ["TEXT", "  São Paulo  ", "São Paulo"],
    ["NUMBER", "1500,5000", "1500.5"],
    ["NUMBER", "-0,00", "0"],
    ["DATE", "2026-09-11", "2026-09-11"],
    ["BOOLEAN", "true", "true"],
    ["SELECT", "Cliente", "Cliente"],
  ] as const)("normalizes %s values", (type, value, expected) => {
    expect(normalizeContactFieldValue({
      id: "field_1",
      type,
      options: type === "SELECT" ? ["Novo", "Cliente"] : [],
    }, value)).toBe(expected);
  });

  it.each([
    ["NUMBER", "1.000,00"],
    ["NUMBER", "1234567890123"],
    ["DATE", "2026-02-30"],
    ["BOOLEAN", "sim"],
    ["SELECT", "Inexistente"],
  ] as const)("rejects invalid %s values", (type, value) => {
    expect(() => normalizeContactFieldValue({
      id: "field_1",
      type,
      options: type === "SELECT" ? ["Novo", "Cliente"] : [],
    }, value)).toThrow();
  });

  it("treats blank values as removal for every type", () => {
    expect(normalizeContactFieldValue({ id: "field_1", type: "DATE", options: [] }, "  ")).toBeNull();
    expect(normalizeContactFieldValue({ id: "field_1", type: "TEXT", options: [] }, null)).toBeNull();
  });

  it("requires options only for selection fields and deduplicates them", () => {
    const parsed = createContactFieldSchema.parse({
      name: "Etapa",
      type: "SELECT",
      options: [" Novo ", "novo", "Cliente"],
    });
    expect(parsed.options).toEqual(["Novo", "Cliente"]);
    expect(createContactFieldSchema.safeParse({ name: "Etapa", type: "SELECT", options: [] }).success).toBe(false);
    expect(createContactFieldSchema.safeParse({ name: "Cidade", type: "TEXT", options: ["SP"] }).success).toBe(false);
  });

  it("rejects duplicate definitions in one contact update", () => {
    expect(contactFieldValuesSchema.safeParse([
      { fieldDefinitionId: "field_1", value: "A" },
      { fieldDefinitionId: "field_1", value: "B" },
    ]).success).toBe(false);
  });
});

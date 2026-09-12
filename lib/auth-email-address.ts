import { z } from "zod";

const addressSchema = z.email().max(254);

/** Accept one plain address, not a display name, group, comment or recipient list. */
export function normalizeAuthEmail(value: string): string {
  if (typeof value !== "string" || value.length > 320 || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error("Informe um único endereço de e-mail válido.");
  }
  const result = addressSchema.safeParse(value.trim());
  if (!result.success || result.data.split("@")[0].length > 64) throw new Error("Informe um único endereço de e-mail válido.");
  return result.data.toLowerCase();
}

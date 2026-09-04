import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  formatDateTime,
  formatNumber,
  translate,
} from "@/lib/i18n";

describe("pt-BR localization", () => {
  it("uses Brazilian Portuguese as the product default", () => {
    expect(DEFAULT_LOCALE).toBe("pt-BR");
    expect(translate("dashboard.greeting", { name: "Maria" })).toBe(
      "Olá, Maria!"
    );
  });

  it("formats dates and numbers with Brazilian conventions", () => {
    expect(
      formatDateTime("2026-09-04T15:30:00.000Z", {
        timeZone: "UTC",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    ).toBe("04/09/2026");
    expect(formatNumber(1234.5)).toBe("1.234,5");
  });
});

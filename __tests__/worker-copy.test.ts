import { describe, expect, it } from "vitest";
import {
  BUTTON_TAP_LOG_TEXT,
  DEFAULT_CONTACT_NAME,
  DEFAULT_FOLLOW_PROMPT_BUTTON_LABEL,
  DEFAULT_FOLLOW_PROMPT_MESSAGE,
  DEFAULT_LINK_MESSAGE,
  hourlyDmLimitError,
  hourlyDmRetryMessage,
  monthlyDmLimitError,
  privateReplyAlreadyUsedError,
} from "@/lib/queue/user-facing-copy";

describe("worker user-facing copy", () => {
  it("keeps default messages and synthetic history labels in pt-BR", () => {
    expect(DEFAULT_CONTACT_NAME).toBe("você");
    expect(DEFAULT_FOLLOW_PROMPT_MESSAGE).toContain("siga o perfil");
    expect(DEFAULT_FOLLOW_PROMPT_BUTTON_LABEL).toBe("Já estou seguindo");
    expect(DEFAULT_LINK_MESSAGE).toBe("Aqui está o seu link:");
    expect(BUTTON_TAP_LOG_TEXT).toBe("Clique no botão");
  });

  it("formats operator-visible limits and deduplication reasons in pt-BR", () => {
    expect(monthlyDmLimitError(2_000)).toBe(
      "Limite mensal de DMs atingido (2000)"
    );
    expect(hourlyDmLimitError).toContain("Limite horário");
    expect(hourlyDmRetryMessage).toContain("nova tentativa agendada");
    expect(privateReplyAlreadyUsedError("Campanha A")).toContain(
      "Outra campanha (Campanha A)"
    );
    expect(privateReplyAlreadyUsedError(null)).toContain("desconhecida");
  });
});

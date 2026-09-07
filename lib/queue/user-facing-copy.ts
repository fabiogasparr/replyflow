export const DEFAULT_CONTACT_NAME = "você";

export const DEFAULT_FOLLOW_PROMPT_MESSAGE =
  "Antes de enviar o link, siga o perfil e toque no botão abaixo. 💛";

export const DEFAULT_FOLLOW_PROMPT_BUTTON_LABEL = "Já estou seguindo";

export const DEFAULT_LINK_MESSAGE = "Aqui está o seu link:";

export const BUTTON_TAP_LOG_TEXT = "Clique no botão";

export const MISSING_INSTAGRAM_TOKEN_ERROR =
  "A conta do Instagram não possui uma credencial de acesso";

export const INVALID_INSTAGRAM_TOKEN_ERROR =
  "Não foi possível abrir a credencial da conta do Instagram";

export const inactiveAutomationError =
  "A automação não está mais ativa para esta conta do Instagram";

export function monthlyDmLimitError(limit: number) {
  return `Limite mensal de DMs atingido (${limit})`;
}

export const hourlyDmLimitError =
  "Limite horário de DMs do Instagram atingido";

export const hourlyDmRetryMessage =
  "Limite horário atingido; nova tentativa agendada";

export function privateReplyAlreadyUsedError(
  automationName: string | null | undefined
) {
  return `Outra campanha (${automationName ?? "desconhecida"}) já enviou a única resposta privada permitida pelo Instagram para este comentário`;
}

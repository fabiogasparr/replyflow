export const DEFAULT_LOCALE = "pt-BR" as const;
export const SUPPORTED_LOCALES = [DEFAULT_LOCALE] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

const ptBR = {
  "common.all": "Todos",
  "common.previous": "Anterior",
  "common.next": "Próxima",
  "common.loading": "Carregando…",
  "common.unknown": "Desconhecido",
  "accounts.all": "Todas as contas",
  "status.sent": "Enviada",
  "status.failed": "Falhou",
  "status.pending": "Pendente",
  "status.deduplicated": "Duplicada",
  "status.rateLimited": "Limite da Meta",
  "status.planLimited": "Limite do plano",
  "status.noMatch": "Sem correspondência",
  "dashboard.greeting": "Olá, {{name}}!",
  "dashboard.genericName": "tudo bem",
  "dashboard.activity": "Ver atividade",
} as const;

const catalogs = { [DEFAULT_LOCALE]: ptBR } as const;

export type MessageKey = keyof typeof ptBR;
export type MessageVariables = Record<string, string | number>;

export function translate(
  key: MessageKey,
  variables: MessageVariables = {},
  locale: AppLocale = DEFAULT_LOCALE
) {
  return Object.entries(variables).reduce(
    (message, [name, value]) =>
      message.replaceAll(`{{${name}}}`, String(value)),
    catalogs[locale][key] as string
  );
}

export function formatDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
    timeStyle: "short",
  },
  locale: AppLocale = DEFAULT_LOCALE
) {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: AppLocale = DEFAULT_LOCALE
) {
  return new Intl.NumberFormat(locale, options).format(value);
}

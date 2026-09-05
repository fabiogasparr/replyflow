export const PRODUCT = {
  name: "ReplyFlow",
  shortName: "ReplyFlow",
  description:
    "Transforme comentários do Instagram em conversas, oportunidades e vendas com automações seguras pela API oficial da Meta.",
  githubUrl: "https://github.com/fabiogasparr/replyflow",
} as const;

export type DashboardNavKey =
  | "dashboard"
  | "overview"
  | "inbox"
  | "contacts"
  | "campaigns"
  | "logs"
  | "settings"
  | "diagnostics";

export const DASHBOARD_NAV_ITEMS: ReadonlyArray<{
  key: DashboardNavKey;
  label: string;
  href: string;
}> = [
  { key: "dashboard", label: "Início", href: "/dashboard" },
  { key: "overview", label: "Desempenho", href: "/overview" },
  { key: "inbox", label: "Conversas", href: "/inbox" },
  { key: "contacts", label: "Contatos", href: "/contacts" },
  { key: "campaigns", label: "Automações", href: "/campaigns" },
  { key: "logs", label: "Histórico de envios", href: "/logs" },
  { key: "settings", label: "Configurações", href: "/settings" },
  { key: "diagnostics", label: "Diagnóstico", href: "/diagnostics" },
] as const;

const dashboardPageTitles: ReadonlyArray<[prefix: string, title: string]> = [
  ["/campaigns/new", "Nova automação"],
  ["/automations/new", "Nova automação"],
  ["/campaigns", "Automações"],
  ["/automations", "Automações"],
  ["/overview", "Desempenho"],
  ["/inbox", "Conversas"],
  ["/contacts", "Contatos"],
  ["/logs", "Histórico de envios"],
  ["/settings", "Configurações"],
  ["/diagnostics", "Diagnóstico"],
  ["/dashboard", "Visão geral"],
];

export function getDashboardPageTitle(pathname: string): string {
  return (
    dashboardPageTitles.find(
      ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )?.[1] ?? "Visão geral"
  );
}

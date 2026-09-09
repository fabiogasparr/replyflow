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
  | "reports"
  | "inbox"
  | "contacts"
  | "campaigns"
  | "logs"
  | "settings"
  | "diagnostics"
  | "platform";

export const DASHBOARD_NAV_ITEMS: ReadonlyArray<{
  key: DashboardNavKey;
  label: string;
  href: string;
}> = [
  { key: "dashboard", label: "Início", href: "/dashboard" },
  { key: "overview", label: "Desempenho", href: "/overview" },
  { key: "reports", label: "Relatórios", href: "/reports" },
  { key: "inbox", label: "Conversas", href: "/inbox" },
  { key: "contacts", label: "Contatos", href: "/contacts" },
  { key: "campaigns", label: "Automações", href: "/campaigns" },
  { key: "logs", label: "Histórico de envios", href: "/logs" },
  { key: "settings", label: "Configurações", href: "/settings" },
  { key: "diagnostics", label: "Diagnóstico", href: "/diagnostics" },
] as const;

export const PLATFORM_ADMIN_NAV_ITEM = {
  key: "platform",
  label: "Administração",
  href: "/admin",
} as const satisfies {
  key: DashboardNavKey;
  label: string;
  href: string;
};

const dashboardPageTitles: ReadonlyArray<[prefix: string, title: string]> = [
  ["/admin", "Administração da plataforma"],
  ["/campaigns/new", "Nova automação"],
  ["/automations/new", "Nova automação"],
  ["/campaigns", "Automações"],
  ["/automations", "Automações"],
  ["/overview", "Desempenho"],
  ["/reports", "Relatórios de resultado"],
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

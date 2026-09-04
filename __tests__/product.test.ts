import { describe, expect, it } from "vitest";
import {
  DASHBOARD_NAV_ITEMS,
  getDashboardPageTitle,
  PRODUCT,
} from "@/lib/product";

describe("ReplyFlow product configuration", () => {
  it("keeps the public brand and repository centralized", () => {
    expect(PRODUCT.name).toBe("ReplyFlow");
    expect(PRODUCT.githubUrl).toBe("https://github.com/fabiogasparr/replyflow");
  });

  it("uses unique dashboard routes and pt-BR labels", () => {
    const routes = DASHBOARD_NAV_ITEMS.map((item) => item.href);

    expect(new Set(routes).size).toBe(routes.length);
    expect(DASHBOARD_NAV_ITEMS.map((item) => item.label)).toContain("Automações");
    expect(DASHBOARD_NAV_ITEMS.map((item) => item.label)).toContain("Conversas");
  });

  it("resolves titles for nested routes", () => {
    expect(getDashboardPageTitle("/campaigns/new")).toBe("Nova automação");
    expect(getDashboardPageTitle("/campaigns/123/edit")).toBe("Automações");
    expect(getDashboardPageTitle("/inbox/thread-1")).toBe("Conversas");
    expect(getDashboardPageTitle("/unknown")).toBe("Visão geral");
  });
});

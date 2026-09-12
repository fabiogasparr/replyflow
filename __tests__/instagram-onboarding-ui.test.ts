import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }));
import { InstagramOnboarding } from "@/components/instagram-onboarding";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";

beforeEach(() => { mocks.params = new URLSearchParams(); });
describe("Instagram onboarding initial rendering", () => {
  it("exposes four navigable steps and separates client tasks from Meta review", () => {
    const html = renderToStaticMarkup(createElement(InstagramOnboarding));
    expect(html).toContain('aria-label="Etapas da conexão"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Etapa 1 de 4");
    expect(html).toContain("Autorizar acesso");
    expect(html).toContain("Conferir conexão");
    expect(html).toContain("Primeira automação");
    expect(html).toContain("A Meta decide a aprovação");
  });
  it("does not treat a forged success query as confirmation of a saved connection", () => {
    mocks.params = new URLSearchParams("connected=true&accountId=someone_else");
    const html = renderToStaticMarkup(createElement(InstagramOnboarding));
    expect(html).toContain("Etapa 3 de 4");
    expect(html).toContain("Consultando a configuração");
    expect(html).not.toContain("Autorização registrada");
  });
  it("keeps authorization disabled until the workspace configuration loads", () => {
    mocks.params = new URLSearchParams("instagram=misconfigured");
    const html = renderToStaticMarkup(createElement(InstagramOnboarding));
    expect(html).toContain("Autorização indisponível");
    expect(html).not.toContain('href="/api/instagram/connect');
  });
  it("does not render arbitrary OAuth reason text or configuration names", () => {
    mocks.params = new URLSearchParams("instagram=failed&reason=private-token");
    const html = renderToStaticMarkup(createElement(InstagramConnectNotice));
    expect(html).not.toContain("private-token");
    expect(html).not.toContain("Instagram aceitou");
    mocks.params = new URLSearchParams("instagram=misconfigured&missing=INSTAGRAM_APP_SECRET");
    expect(renderToStaticMarkup(createElement(InstagramConnectNotice))).not.toContain("INSTAGRAM_APP_SECRET");
  });
});

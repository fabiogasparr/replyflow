import { NextRequest, NextResponse } from "next/server";
import { canManageInstagram, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl, getMissingInstagramOAuthEnv } from "@/lib/env";
import { createOAuthState, getAuthorizationUrl, INSTAGRAM_STATE_COOKIE } from "@/lib/meta/oauth";

export async function GET(request: NextRequest) {
  const wizard = request.nextUrl.searchParams.get("flow") === "wizard";
  const returnPath = wizard ? "/settings/instagram" : "/settings";
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageInstagram(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}${returnPath}?instagram=forbidden`);
  }

  const expectedWorkspace = request.nextUrl.searchParams.get("workspaceId");
  if (expectedWorkspace && expectedWorkspace !== context.workspaceId) {
    return NextResponse.redirect(`${getBaseUrl()}${returnPath}?instagram=workspace_changed`);
  }

  // getAuthorizationUrl and createOAuthState call requireEnv, which throws.
  // Without this check an incomplete .env surfaces as a 500 on a plain <a>
  // navigation, which reads to the user as the button doing nothing at all.
  const missingEnv = getMissingInstagramOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}${returnPath}?instagram=misconfigured`
    );
  }

  const redirectUri = `${getBaseUrl()}/api/instagram/callback`;
  const state = createOAuthState(context.workspaceId, context.userId, wizard ? "wizard" : undefined);

  const response = NextResponse.redirect(getAuthorizationUrl(redirectUri, state));
  response.cookies.set(INSTAGRAM_STATE_COOKIE, state, {
    httpOnly: true, secure: getBaseUrl().startsWith("https://"),
    sameSite: "lax", path: "/api/instagram/callback", maxAge: 600,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

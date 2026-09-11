import { NextResponse } from "next/server";
import { canManageInstagram, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl, getMissingInstagramOAuthEnv } from "@/lib/env";
import { createOAuthState, getAuthorizationUrl, INSTAGRAM_STATE_COOKIE } from "@/lib/meta/oauth";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageInstagram(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=forbidden`);
  }

  // getAuthorizationUrl and createOAuthState call requireEnv, which throws.
  // Without this check an incomplete .env surfaces as a 500 on a plain <a>
  // navigation, which reads to the user as the button doing nothing at all.
  const missingEnv = getMissingInstagramOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?instagram=misconfigured&missing=${encodeURIComponent(
        missingEnv.join(",")
      )}`
    );
  }

  const redirectUri = `${getBaseUrl()}/api/instagram/callback`;
  const state = createOAuthState(context.workspaceId, context.userId);

  const response = NextResponse.redirect(getAuthorizationUrl(redirectUri, state));
  response.cookies.set(INSTAGRAM_STATE_COOKIE, state, {
    httpOnly: true, secure: getBaseUrl().startsWith("https://"),
    sameSite: "lax", path: "/api/instagram/callback", maxAge: 600,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

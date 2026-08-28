/**
 * Sends a visitor with no session cookie to `/login`.
 *
 * ## This is a redirect, not a guard
 *
 * It checks that a cookie **exists**. It does not check that the token names a
 * live session, because middleware runs on the Edge runtime and the session
 * table is in Neon behind the Node-only driver — reaching it from here would
 * mean a database round trip on every asset request even if it were possible.
 *
 * So a forged cookie gets past this file and hits an API route, where
 * `userFor` looks the token up for real and returns a 401. **Every route that
 * guards something does its own check**; this exists so that a signed-out
 * visitor sees a sign-in form instead of a dashboard of empty states.
 *
 * ## The matcher excludes more than assets
 *
 * `/api` is excluded because those handlers answer 401 in JSON, and a 307 to an
 * HTML page is a worse answer to `fetch` than the status it asked for.
 */

import { NextResponse, type NextRequest } from "next/server";

// `cookie.ts`, not `session.ts`: that module needs `node:crypto`, which the
// Edge runtime this file runs on does not have.
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";

/** Reachable signed out. Everything else redirects. */
const PUBLIC_PATHS = new Set(["/login"]);

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (hasSession && isPublic) {
    // Already signed in and asking for the sign-in form. Sending them home is
    // better than rendering a form that would sign them in as themselves.
    return NextResponse.redirect(new URL("/home", request.url));
  }

  if (hasSession || isPublic) return NextResponse.next();

  const login = new URL("/login", request.url);
  // Where they were going, so signing in lands them there rather than on the
  // dashboard. The login page only honours it if it is a path — see the
  // open-redirect note there.
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api          — answers 401 in JSON; a redirect would break `fetch`
     *   _next/static — the build output
     *   _next/image  — the image optimiser
     *   favicon.ico, and anything else with a file extension (assets in public/)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};

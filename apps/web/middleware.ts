import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Host-based split between the public vitrine and the admin console.
//
// The admin console (the `app/admin/*` route group) is deployed in the SAME
// Next.js container as the public site but is only reachable on its own host
// (ADMIN_HOST, e.g. tenant.nigerconnect.app — see docker-compose.prod.yml).
//
//   - On the admin host: the root path transparently serves the /admin tree,
//     so https://tenant.nigerconnect.app/ → the admin app, /login → /admin/login.
//   - On the public host: /admin is hidden (404) so the console never surfaces
//     on the showcase domain.
//
// Detection is by sub-domain label rather than a hard-coded FQDN so it keeps
// working across environments (tenant.<anything>, and localhost stays public).
function isAdminHost(host: string): boolean {
  return host.split(":")[0].toLowerCase().startsWith("tenant.");
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  if (isAdminHost(host)) {
    // Already inside the admin tree (direct hit or a prior rewrite) → serve as-is.
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      return NextResponse.next();
    }
    const url = req.nextUrl.clone();
    url.pathname = pathname === "/" ? "/admin" : `/admin${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Public vitrine: the admin console must not be reachable here.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals, static assets and well-known files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|\\.well-known/).*)",
  ],
};

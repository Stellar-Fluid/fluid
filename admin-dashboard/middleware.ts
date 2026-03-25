import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Protect all /admin/* routes
  if (pathname.startsWith("/admin")) {
    if (!session) {
      const loginUrl = new URL("/login", req.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Redirect authenticated users away from login page
  if (pathname === "/login" && session) {
    const adminUrl = new URL("/admin/dashboard", req.url);
    return NextResponse.redirect(adminUrl);
  }

  return NextResponse.next();
});

// Matcher excludes static assets and Next.js internals automatically
export const config = {
  matcher: ["/admin/:path*", "/login"]
};

import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import { NextRequest, type NextResponse } from "next/server";

import { routing } from "./i18n/routing";
import { geoCountry } from "./lib/geo";

const intl = createMiddleware(routing);

// Clerk first (session handshake), then next-intl (locale prefix). Pages are not protected here:
// the API enforces every authorization rule, and the app pages ask the API who the caller is.
// Without the Clerk keys (CI and local builds only) the site runs with sign-in off.
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

/**
 * `/verify/<id>` (the QR on a certificate) is served by the static `/verify` page: the request
 * is rewritten to `/verify?id=<id>` and the address bar keeps the short link.
 */
function verifyRewrite(request: NextRequest): NextRequest {
  const match = /^(\/pt-BR)?\/verify\/([A-Za-z0-9-]{1,40})\/?$/.exec(request.nextUrl.pathname);
  if (!match) return request;
  const url = request.nextUrl.clone();
  url.pathname = `${match[1] ?? ""}/verify`;
  url.searchParams.set("id", match[2] as string);
  return new NextRequest(url, request);
}

/**
 * The country-switch default: a new visitor's country from Vercel's IP country header, kept for
 * 30 days in `sc_geo` (US, EU or BR only). The page reads it once, for English visitors without a
 * choice of their own (`lib/country.ts`). No other location data is kept.
 */
function withGeo(request: NextRequest, response: NextResponse): NextResponse {
  const country = request.headers.get("x-vercel-ip-country");
  if (country && !request.cookies.has("sc_geo")) {
    response.cookies.set("sc_geo", geoCountry(country), { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax", secure: true });
  }
  return response;
}

const localized = (request: NextRequest) => withGeo(request, intl(verifyRewrite(request)));

export default clerkConfigured ? clerkMiddleware((_auth, request) => localized(request)) : localized;

export const config = {
  // Every pathname except Next.js internals, Vercel internals and files with an extension.
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};

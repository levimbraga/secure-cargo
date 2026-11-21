import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

// Clerk first (session handshake), then next-intl (locale prefix). Pages are not protected here:
// the API enforces every authorization rule, and the app pages ask the API who the caller is.
// Without the Clerk keys (CI and local builds only) the site runs with sign-in off.
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

export default clerkConfigured ? clerkMiddleware((_auth, request) => intl(request)) : intl;

export const config = {
  // Every pathname except Next.js internals, Vercel internals and files with an extension.
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};

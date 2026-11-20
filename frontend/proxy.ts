import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

// Clerk first (session handshake), then next-intl (locale prefix). Pages are not protected here:
// the API enforces every authorization rule, and the app pages ask the API who the caller is.
export default clerkMiddleware((_auth, request) => intl(request));

export const config = {
  // Every pathname except Next.js internals, Vercel internals and files with an extension.
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};

"use client";

import { cn } from "cn";

import { Link, usePathname } from "@/i18n/navigation";

/** The site header's section links; the page you are on is marked. */
export function SiteLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <>
      {links.map((link) => {
        const current = !link.href.includes("#") && pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={cn("hover:text-gray", current && "underline decoration-hairline underline-offset-[6px]")}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

/** "Sign in": a link, or, on the sign-in page itself, the current page (not a link to itself). */
export function SignInLink({ label, className }: { label: string; className?: string }) {
  const pathname = usePathname();
  if (pathname === "/app/sign-in") {
    return (
      <span aria-current="page" className={cn(className, "underline decoration-hairline underline-offset-[6px]")} data-testid="sign-in-current">
        {label}
      </span>
    );
  }
  return (
    <Link href="/app/sign-in" className={cn(className, "hover:text-gray")}>
      {label}
    </Link>
  );
}

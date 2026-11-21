"use client";

import { useTranslations } from "next-intl";

import { useMe } from "@/components/app/me-provider";

/** Demo accounts only: what they create is deleted after a day (the Worker's demo reset). */
export function DemoResetNote({ className = "" }: { className?: string }) {
  const t = useTranslations("AppNav");
  const { me } = useMe();
  if (!me?.user.is_demo) return null;
  return (
    <p data-testid="demo-reset-note" className={`type-small text-gray ${className}`}>
      {t("demoResets")}
    </p>
  );
}

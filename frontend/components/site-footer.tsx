import { useTranslations } from "next-intl";

const REPOSITORY_URL = "https://github.com/levimbraga/secure-cargo";

export function SiteFooter() {
  const t = useTranslations("Footer");

  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t("disclaimer")}</p>
        <a
          href={REPOSITORY_URL}
          className="underline underline-offset-4 hover:text-foreground"
        >
          {t("source")}
        </a>
      </div>
    </footer>
  );
}

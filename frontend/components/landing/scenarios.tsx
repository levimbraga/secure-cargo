import Image from "next/image";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

const SCENARIOS = [
  { id: "braking", image: "/media/scenario-braking.webp" },
  { id: "weighStation", image: "/media/scenario-weigh-station.webp" },
  { id: "rope", image: "/media/scenario-rope.webp" },
  { id: "curve", image: "/media/scenario-curve.webp" },
] as const;

/** Four demo scenarios. Until they exist in the app, every card opens `/app`. */
export function Scenarios() {
  const t = useTranslations("Landing.demo");

  return (
    <ul className="mt-12 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
      {SCENARIOS.map((scenario) => (
        <li key={scenario.id}>
          <Link href="/app" className="group flex flex-col gap-4">
            <div className="duotone relative aspect-[4/3] overflow-hidden rounded-lg border border-hairline">
              <Image
                src={scenario.image}
                alt=""
                fill
                sizes="(min-width: 1024px) 20rem, (min-width: 640px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="type-h3">{t(`scenarios.${scenario.id}.title`)}</h3>
              <p className="text-muted-foreground">{t(`scenarios.${scenario.id}.body`)}</p>
              <p className="mt-1 text-[0.9375rem] font-medium underline decoration-1 underline-offset-4 group-hover:decoration-2">
                {t("run")}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

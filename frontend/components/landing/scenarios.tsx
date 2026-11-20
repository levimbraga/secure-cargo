import Image, { type StaticImageData } from "next/image";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import braking from "@/public/media/scenario-braking.jpg";
import curve from "@/public/media/scenario-curve.jpg";
import rope from "@/public/media/scenario-rope.jpg";
import weighStation from "@/public/media/scenario-weigh-station.jpg";

const SCENARIOS: { id: "braking" | "weighStation" | "rope" | "curve"; image: StaticImageData }[] = [
  { id: "braking", image: braking },
  { id: "weighStation", image: weighStation },
  { id: "rope", image: rope },
  { id: "curve", image: curve },
];

/** Four demo scenarios as duotone photo cards. Until they exist in the app, each opens `/app`. */
export function Scenarios() {
  const t = useTranslations("Landing.scenarios");

  return (
    <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-8 md:gap-x-4 lg:grid-cols-4">
      {SCENARIOS.map((scenario) => (
        <li key={scenario.id}>
          <Link href="/app" className="group block">
            <Image
              src={scenario.image}
              alt=""
              placeholder="blur"
              sizes="(min-width: 1024px) 275px, 50vw"
              className="aspect-[4/5] w-full rounded object-cover"
            />
            <h3 className="type-card-title mt-4 text-balance group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
              {t(`items.${scenario.id}.title`)}
            </h3>
            <p className="type-small mt-1.5 text-gray">{t(`items.${scenario.id}.body`)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

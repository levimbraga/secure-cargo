import Image from "next/image";
import { useTranslations } from "next-intl";

import { VerdictBadge } from "@/components/ui/verdict-badge";
import { Link } from "@/i18n/navigation";

/**
 * The three verdict states, each shown on a real sample photo with its recorded result. Each row
 * opens that sample's inspection (no account needed). The numbers come from the recorded batteries
 * in `public/demo/samples/index.json`.
 */
const STATES = [
  { id: "approved", sample: "concrete-pipes", badge: "pass" },
  { id: "holds", sample: "steel-racks", badge: "warn" },
  { id: "fails", sample: "crates-ropes", badge: "fail" },
] as const;

export function ResultPreview() {
  const t = useTranslations("Landing.result");
  return (
    <ul className="mt-10 grid gap-6">
      {STATES.map((state) => (
        <li key={state.id}>
          <Link href={`/app/new?sample=${state.sample}`} className="group grid grid-cols-[96px_1fr] items-start gap-4 md:grid-cols-[160px_1fr] md:gap-6">
            <Image
              src={`/demo/samples/${state.sample}.jpg`}
              alt=""
              width={320}
              height={240}
              sizes="(min-width: 768px) 160px, 96px"
              className="aspect-[4/3] w-full rounded bg-surface object-cover"
            />
            <div>
              <VerdictBadge verdict={state.badge}>{t(`states.${state.id}.badge`)}</VerdictBadge>
              <p className="mt-2 font-medium text-ink group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                {t(`states.${state.id}.load`)}
              </p>
              <p className="type-small mt-1 text-gray">{t(`states.${state.id}.sentence`)}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

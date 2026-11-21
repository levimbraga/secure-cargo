"use client";

/**
 * "My trucks": save a truck once (size, body, bed length, headboard height, lashing points, an
 * optional nickname; no plate), then pick it before the photo of an inspection.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";

import { useMe } from "@/components/app/me-provider";
import { ChoiceCard } from "@/components/inspection/steps";
import { TruckArt } from "@/components/inspection/truck-art";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { useAppApi } from "@/lib/app-api";
import { BODY_STYLES, SIZE_INFO, type SavedTruck, TRUCK_SIZES, type TruckChoice } from "@/lib/inspection/trucks";

function optionalNumber(text: string): number | undefined {
  const value = Number(text.replace(",", "."));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function MyTrucks() {
  const t = useTranslations("Driver.trucks");
  const names = useTranslations("Driver");
  const flow = useTranslations("Flow");
  const format = useFormatter();
  const { signedIn, ready } = useMe();
  const request = useAppApi();
  const [trucks, setTrucks] = useState<SavedTruck[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    request<{ trucks: SavedTruck[] }>("/trucks")
      .then(({ trucks: list }) => setTrucks(list))
      .catch(() => setTrucks([]));
  }, [request]);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  if (ready && !signedIn) {
    return (
      <section>
        <h1 className="type-hero">{t("title")}</h1>
        <p className="type-body mt-3">{t("signIn")}</p>
        <Link href="/app/sign-in" className={pill({ className: "mt-4 h-11 px-4" })}>
          {flow("photos.signInButton")}
        </Link>
      </section>
    );
  }
  const metres = (m: number) => format.number(m, { maximumFractionDigits: 2 });
  return (
    <section aria-labelledby="trucks-title" data-testid="my-trucks">
      <p className="type-label">{t("label")}</p>
      <h1 id="trucks-title" className="type-hero mt-4">
        {t("title")}
      </h1>
      <p className="type-body mt-3 max-w-[43rem] text-pretty">{t("sentence")}</p>

      <ul className="mt-8 border-b border-hairline">
        {trucks === null && <li className="type-small border-t border-hairline py-4 text-gray">…</li>}
        {trucks?.length === 0 && <li className="type-small border-t border-hairline py-4 text-gray">{t("empty")}</li>}
        {trucks?.map((truck) => (
          <li key={truck.id} className="flex items-center gap-4 border-t border-hairline py-4" data-testid="truck-row">
            <TruckArt size={truck.size} style={truck.style} className="h-10 w-auto shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block font-[450] text-ink">
                {truck.nickname || names("truck.name", { size: names(`sizes.${truck.size}.name`), body: names(`styles.${truck.style}.short`) })}
              </span>
              <span className="type-small block text-gray">
                {names("truck.name", { size: names(`sizes.${truck.size}.name`), body: names(`styles.${truck.style}.short`) })} ·{" "}
                {names("sizes.axles", { count: SIZE_INFO[truck.size].axles })}
                {truck.bed_length_m ? ` · ${t("bedLength")}: ${metres(truck.bed_length_m)}` : ""}
                {truck.headboard_height_m ? ` · ${t("headboard")}: ${metres(truck.headboard_height_m)}` : ""}
              </span>
            </span>
            <button
              type="button"
              onClick={() => request(`/trucks/${truck.id}`, { method: "DELETE" }).then(load)}
              className="type-small min-h-11 text-gray underline decoration-1 underline-offset-4"
            >
              {t("delete")}
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <TruckForm
          onSaved={() => {
            setAdding(false);
            load();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={pill({ className: "mt-8 h-12 px-5" })} data-testid="add-truck">
          {t("add")}
        </button>
      )}
    </section>
  );
}

function TruckForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const t = useTranslations("Driver.trucks");
  const names = useTranslations("Driver");
  const request = useAppApi();
  const id = useId();
  const [choice, setChoice] = useState<Partial<TruckChoice>>({});
  const [nickname, setNickname] = useState("");
  const [bed, setBed] = useState("");
  const [headboard, setHeadboard] = useState("");
  const [anchors, setAnchors] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = Boolean(choice.size && choice.style);
  const field = "mt-1 h-12 w-full max-w-xs rounded border border-control bg-paper px-3 font-mono";
  return (
    <form
      className="mt-10"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready) return;
        setBusy(true);
        try {
          await request("/trucks", {
            method: "POST",
            body: JSON.stringify({
              nickname: nickname.trim(),
              size: choice.size,
              style: choice.style,
              bed_length_m: optionalNumber(bed),
              headboard_height_m: optionalNumber(headboard),
              anchors_per_side: optionalNumber(anchors) ? Math.round(optionalNumber(anchors) as number) : undefined,
            }),
          });
          onSaved();
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset>
        <legend className="type-label">{t("size")}</legend>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {TRUCK_SIZES.map((size) => (
            <ChoiceCard key={size} selected={choice.size === size} onClick={() => setChoice({ ...choice, size })} testId={`form-size-${size}`}>
              <TruckArt size={size} style={choice.style ?? "open_low_sides"} className="max-h-10 w-auto self-start" />
              <span className="mt-2 block text-[0.9375rem] font-[450] text-ink">{names(`sizes.${size}.name`)}</span>
            </ChoiceCard>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-6">
        <legend className="type-label">{t("body")}</legend>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {BODY_STYLES.map((style) => (
            <ChoiceCard key={style} selected={choice.style === style} onClick={() => setChoice({ ...choice, style })} testId={`form-style-${style}`}>
              <TruckArt size={choice.size ?? "toco"} style={style} className="max-h-10 w-auto self-start" />
              <span className="mt-2 block text-[0.9375rem] font-[450] text-ink">{names(`styles.${style}.name`)}</span>
            </ChoiceCard>
          ))}
        </div>
      </fieldset>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="type-small block text-gray" htmlFor={`${id}-nick`}>
          {t("nickname")}
          <input id={`${id}-nick`} value={nickname} maxLength={40} onChange={(e) => setNickname(e.target.value)} className={`${field} font-sans`} />
        </label>
        <label className="type-small block text-gray" htmlFor={`${id}-bed`}>
          {t("bedLength")}
          <input id={`${id}-bed`} inputMode="decimal" value={bed} onChange={(e) => setBed(e.target.value)} className={field} />
        </label>
        <label className="type-small block text-gray" htmlFor={`${id}-head`}>
          {t("headboard")}
          <input id={`${id}-head`} inputMode="decimal" value={headboard} onChange={(e) => setHeadboard(e.target.value)} className={field} data-testid="form-headboard" />
        </label>
        <label className="type-small block text-gray" htmlFor={`${id}-anchors`}>
          {t("anchors")}
          <input id={`${id}-anchors`} inputMode="numeric" value={anchors} onChange={(e) => setAnchors(e.target.value)} className={field} />
        </label>
      </div>
      <p className="type-small mt-2 text-gray">{t("optional")}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="submit" disabled={!ready || busy} className={pill({ className: "h-12 px-5" })} data-testid="save-truck">
          {busy ? t("saving") : t("save")}
        </button>
        <button type="button" onClick={onCancel} className={pill({ variant: "secondary", className: "h-12 px-5" })}>
          {names("sim.close")}
        </button>
      </div>
    </form>
  );
}

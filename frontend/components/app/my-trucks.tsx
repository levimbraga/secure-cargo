"use client";

/**
 * "My trucks": save a truck once (size, body, bed length, headboard height, lashing points, an
 * optional nickname; no plate), then pick it before the photo of an inspection.
 */

import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";

import { useMe } from "@/components/app/me-provider";
import { CountrySwitch } from "@/components/inspection/country-switch";
import { ChoiceCard, useTruckCaption } from "@/components/inspection/steps";
import { TruckArt } from "@/components/inspection/truck-art";
import { pill } from "@/components/ui/pill";
import { Link } from "@/i18n/navigation";
import { useAppApi } from "@/lib/app-api";
import { useCountry } from "@/lib/country";
import { TRUCK_CATALOG } from "@/lib/inspection/truck-catalog";
import { type SavedTruck, sizesOf, stylesOf, type TruckChoice } from "@/lib/inspection/trucks";
import { useUnits } from "@/lib/units";

function optionalNumber(text: string): number | undefined {
  const value = Number(text.replace(",", "."));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function MyTrucks() {
  const t = useTranslations("Driver.trucks");
  const flow = useTranslations("Flow");
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
          <TruckRow key={truck.id} truck={truck}>
            <button
              type="button"
              onClick={() => request(`/trucks/${truck.id}`, { method: "DELETE" }).then(load)}
              className="type-small min-h-11 text-gray underline decoration-1 underline-offset-4"
            >
              {t("delete")}
            </button>
          </TruckRow>
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

/** A saved truck: its drawing, name and measurements in the units of its size's country. */
function TruckRow({ truck, children }: { truck: SavedTruck; children: ReactNode }) {
  const t = useTranslations("Driver.trucks");
  const names = useTranslations("Driver");
  const units = useUnits(TRUCK_CATALOG[truck.size].country);
  const kind = names("truck.name", { size: names(`sizes.${truck.size}.name`), body: names(`styles.${truck.style}.short`) });
  return (
    <li className="flex items-center gap-4 border-t border-hairline py-4" data-testid="truck-row">
      <TruckArt size={truck.size} style={truck.style} className="h-10 w-auto shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block font-[450] text-ink">{truck.nickname || kind}</span>
        <span className="type-small block text-gray">
          {kind} · {names("sizes.axles", { count: TRUCK_CATALOG[truck.size].axle_count })}
          {truck.bed_length_m ? ` · ${t("bedLengthValue", { length: units.length(truck.bed_length_m) })}` : ""}
          {truck.headboard_height_m ? ` · ${t("headboardValue", { height: units.length(truck.headboard_height_m) })}` : ""}
        </span>
      </span>
      {children}
    </li>
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
  const [country, setCountry] = useCountry();
  const units = useUnits(country);
  const caption = useTruckCaption();
  const ready = Boolean(choice.size && choice.style);
  // A length typed in the country's unit (m, or ft in the US), stored in metres.
  const metres = (text: string) => {
    const value = optionalNumber(text);
    return value === undefined ? undefined : Math.round(units.lengthIn(value) * 1000) / 1000;
  };
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
              bed_length_m: metres(bed),
              headboard_height_m: metres(headboard),
              anchors_per_side: optionalNumber(anchors) ? Math.round(optionalNumber(anchors) as number) : undefined,
            }),
          });
          onSaved();
        } finally {
          setBusy(false);
        }
      }}
    >
      <CountrySwitch
        country={country}
        onChange={(value) => {
          setCountry(value);
          setChoice({});
        }}
        hint={false}
      />
      <fieldset>
        <legend className="type-label">{t("size")}</legend>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sizesOf(country).map((size) => (
            <ChoiceCard
              key={size}
              selected={choice.size === size}
              onClick={() => setChoice({ size, style: choice.style && stylesOf(size).includes(choice.style) ? choice.style : undefined })}
              testId={`form-size-${size}`}
            >
              <TruckArt size={size} style={null} scaled />
              <span className="mt-2 block text-[0.9375rem] font-[450] text-ink">{names(`sizes.${size}.name`)}</span>
              <span className="type-label mt-1 block">{caption(size)}</span>
            </ChoiceCard>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-6">
        <legend className="type-label">{t("body")}</legend>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stylesOf(choice.size ?? sizesOf(country)[2] ?? "toco").map((style) => (
            <ChoiceCard key={style} selected={choice.style === style} onClick={() => setChoice({ ...choice, style })} testId={`form-style-${style}`}>
              <TruckArt size={choice.size ?? sizesOf(country)[2] ?? "toco"} style={style} scaled />
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
          {t("bedLength", { unit: units.lengthUnit })}
          <input id={`${id}-bed`} inputMode="decimal" value={bed} onChange={(e) => setBed(e.target.value)} className={field} />
        </label>
        <label className="type-small block text-gray" htmlFor={`${id}-head`}>
          {t("headboard", { unit: units.lengthUnit })}
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

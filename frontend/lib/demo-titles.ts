/**
 * Titles of the seeded demo inspections, written in English by the demo seed: the gallery examples
 * (translated by `Scenario.titles.<id>`) and the sample photos (`title_pt` in their index). Any other
 * title is the driver's own and is shown as typed. `demo-titles.test.ts` keeps these in step with the
 * index files.
 */
export const GALLERY_TITLE_IDS: Record<string, string> = {
  "Emergency braking": "emergency-braking",
  "Sharp curve": "sharp-curve",
  "Rope lashing": "rope-lashing",
  "Steel coil": "steel-coil",
  "Weigh station": "weigh-station",
  "Box truck": "box-truck",
  "Dirt road": "dirt-road",
  "Anti-slip mat": "anti-slip-mat",
  "Full trip": "full-trip",
  "Curtain-sider": "curtain-sider",
  "Potholed road": "potholed-road",
  "Overloaded strap": "overloaded-strap",
  "Steel coils on a 48 ft flatbed (US rules)": "us-steel-coils",
  "Pallets in a code L curtain-sider (EU rules)": "eu-curtain-pallets",
};

export const SAMPLE_TITLES_PT: Record<string, string> = {
  "Crates tied with ropes": "Caixas amarradas com corda",
  "Steel pipes with straps": "Tubos de aço com cintas",
  "A backhoe on a low-bed": "Retroescavadeira em prancha",
  "Lumber, strapped": "Madeira serrada, com cintas",
  "Concrete pipes, chained": "Tubos de concreto acorrentados",
  "Steel racks on a semi-trailer": "Racks de aço numa carreta",
};
/** The title in the page's language: a demo title is translated, anything else is kept. */
export function localTitle(title: string, locale: string, galleryTitle: (id: string) => string): string {
  const id = GALLERY_TITLE_IDS[title];
  if (id) return galleryTitle(id);
  if (locale === "pt-BR" && SAMPLE_TITLES_PT[title]) return SAMPLE_TITLES_PT[title];
  return title;
}

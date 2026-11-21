import { describe, expect, it } from "vitest";

import gallery from "@/public/demo/index.json";
import samples from "@/public/demo/samples/index.json";
import en from "@/messages/en.json";
import pt from "@/messages/pt-BR.json";

import { GALLERY_TITLE_IDS, localTitle, SAMPLE_TITLES_PT } from "./demo-titles";

describe("demo titles", () => {
  it("cover every gallery example and every sample", () => {
    for (const example of gallery.scenarios) expect(GALLERY_TITLE_IDS[example.title]).toBe(example.id);
    for (const sample of samples.samples) expect(SAMPLE_TITLES_PT[sample.title]).toBe(sample.title_pt);
  });

  it("translate demo titles and keep a driver's own", () => {
    const titles = pt.Scenario.titles as Record<string, string>;
    const ptTitle = (id: string) => titles[id] ?? id;
    expect(localTitle("Emergency braking", "pt-BR", ptTitle)).toBe(titles["emergency-braking"]);
    expect(localTitle("Crates tied with ropes", "pt-BR", ptTitle)).toBe("Caixas amarradas com corda");
    expect(localTitle("Crates tied with ropes", "en", (id) => (en.Scenario.titles as Record<string, string>)[id] ?? id)).toBe("Crates tied with ropes");
    expect(localTitle("Pallets for the port", "pt-BR", ptTitle)).toBe("Pallets for the port");
  });
});

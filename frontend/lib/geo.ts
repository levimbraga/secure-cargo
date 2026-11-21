/**
 * The rules a new visitor starts with, from Vercel's IP country header (`proxy.ts`): US mode in
 * the United States, EU mode in the 27 EU member states, Brazil everywhere else.
 */

/** The 27 EU member states (ISO 3166-1 alpha-2): their visitors start in EU mode. */
const EU_MEMBERS = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/** The rules a visitor from an IP country starts with: US, EU or (everyone else) Brazil. */
export function geoCountry(country: string): "US" | "EU" | "BR" {
  if (country === "US") return "US";
  return EU_MEMBERS.has(country) ? "EU" : "BR";
}


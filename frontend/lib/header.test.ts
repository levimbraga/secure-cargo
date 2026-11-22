import { describe, expect, it } from "vitest";

import { HIDE_AFTER_PX, nextHidden } from "@/components/site/hide-on-scroll";
import type { Me } from "@/lib/app-api";
import { appItems, homeFor, isActive } from "@/lib/header";

const t = (key: string) => key;

function me(role: "member" | "org_admin" | null, platformAdmin = false, alerts = 0): Me {
  return {
    user: { id: "u", email: null, name: null, is_demo: false },
    org: role ? { id: "o", name: "QA Carrier", type: "carrier", role, is_demo: false, alerts } : null,
    is_platform_admin: platformAdmin,
    blocked: false,
    analysis: {} as Me["analysis"],
  };
}

const hrefs = (value: Me) => appItems(value, t).map((item) => item.href);

describe("app header sections by role", () => {
  it("gives a driver inspections, trucks and the explorer, and no examples", () => {
    expect(hrefs(me("member"))).toEqual(["/app", "/app/trucks", "/app/explorer"]);
    expect(homeFor(me("member"))).toBe("/app");
  });

  it("gives a manager the organization's sections with the alerts badge", () => {
    const items = appItems(me("org_admin", false, 3), t);
    expect(items.map((item) => item.href)).toEqual([
      "/app/org",
      "/app/org/inspections",
      "/app/org/alerts",
      "/app/org/team",
      "/app/explorer",
    ]);
    expect(items.find((item) => item.href === "/app/org/alerts")?.badge).toBe(3);
    expect(homeFor(me("org_admin"))).toBe("/app/org");
  });

  it("adds Admin for the platform admin, who manages their organization", () => {
    expect(hrefs(me("member", true)).at(-1)).toBe("/app/admin");
    expect(hrefs(me("member", true))[0]).toBe("/app/org");
    expect(hrefs(me(null, true))).toEqual(["/app", "/app/trucks", "/app/explorer", "/app/admin"]);
  });
});

describe("active section", () => {
  it("matches a home only on its own pages", () => {
    expect(isActive("/app", "/app")).toBe(true);
    expect(isActive("/app/inspection", "/app")).toBe(true);
    expect(isActive("/app/trucks", "/app")).toBe(false);
    expect(isActive("/app/org", "/app/org")).toBe(true);
    expect(isActive("/app/org/alerts", "/app/org")).toBe(false);
    expect(isActive("/app/org/alerts", "/app/org/alerts")).toBe(true);
  });
});

describe("hide on scroll", () => {
  it("always shows near the top", () => {
    expect(nextHidden(0, HIDE_AFTER_PX, false, false)).toBe(false);
    expect(nextHidden(300, 40, true, false)).toBe(false);
  });

  it("hides scrolling down past 80 px and shows as soon as it scrolls up", () => {
    expect(nextHidden(60, 120, false, false)).toBe(true);
    expect(nextHidden(400, 390, true, false)).toBe(false);
  });

  it("ignores jitter and stays while focused or with its menu open", () => {
    expect(nextHidden(400, 402, true, false)).toBe(true);
    expect(nextHidden(400, 402, false, false)).toBe(false);
    expect(nextHidden(100, 500, false, true)).toBe(false);
  });
});

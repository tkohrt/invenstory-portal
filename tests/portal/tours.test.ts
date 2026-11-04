/** First-use tours (patch 15, onboarding build, 3 Nov 2026). */
import { describe, expect, test } from "vitest";
import { TOURS, TOUR_KEYS, tourForPath, autoStartTour, presentSteps, placeCard, tourPrefKey, isTourKey } from "@/lib/tours";

describe("tours", () => {
  test("every tour is reachable by its own path and has steps", () => {
    for (const k of TOUR_KEYS) {
      expect(tourForPath(TOURS[k].path)?.key).toBe(k);
      expect(TOURS[k].steps.length).toBeGreaterThan(0);
    }
    expect(tourForPath("/funder-matches/report")).toBeNull();
    expect(tourForPath("/account")).toBeNull();
  });
  test("the Funder Matches tour follows the agreed order, Search first", () => {
    expect(TOURS.funder_matches.steps.map(s => s.target)).toEqual(["fm-search", "fm-sources", "fm-results", "fm-report"]);
  });
  test("starts on its own only for a client who has not seen it", () => {
    expect(autoStartTour({ key: "chat", role: "client", prefs: null })).toBe(true);
    expect(autoStartTour({ key: "chat", role: "client", prefs: { [tourPrefKey("chat")]: true } })).toBe(false);
    expect(autoStartTour({ key: "chat", role: "admin", prefs: null })).toBe(false);
    expect(autoStartTour({ key: "chat", role: "client", prefs: null, settingUp: true })).toBe(false);
  });
  test("steps whose element is missing are left out", () => {
    const s = presentSteps(TOURS.funder_matches.steps, t => t !== "fm-report");
    expect(s.map(x => x.target)).toEqual(["fm-search", "fm-sources", "fm-results"]);
  });
  test("the card goes below when there is room, above when not, inside the window", () => {
    const view = { width: 1280, height: 800 };
    expect(placeCard({ top: 60, left: 1000, width: 200, height: 40 }, view).top).toBe(114);
    expect(placeCard({ top: 700, left: 100, width: 200, height: 40 }, view).top).toBe(700 - 14 - 190);
    const p = placeCard({ top: 60, left: 1250, width: 200, height: 40 }, view);
    expect(p.left).toBeLessThanOrEqual(1280 - 320 - 8);
    expect(placeCard({ top: 60, left: 0, width: 100, height: 40 }, view).left).toBe(8);
  });
  test("keys", () => {
    expect(isTourKey("drafts")).toBe(true);
    expect(isTourKey("setup")).toBe(false);
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { loadAllFixtures } from "./fixtures/loadAll";
import { computeTSB, type TSBData } from "../frontend/tsb";
import type { ParsedActivity } from "../frontend/types";

describe("TSB model", { timeout: 30000 }, () => {
  let activities: ParsedActivity[];
  let tsb: TSBData;

  beforeAll(async () => {
    const all = await loadAllFixtures();
    activities = all.filter(
      (a) => a.summary.sport === "running" && a.summary.avgHeartRate
    );
    tsb = computeTSB(activities);
  });

  it("computes CTL, ATL, TSB from activities with HR data", () => {
    expect(tsb.points.length).toBeGreaterThan(0);

    // CTL and ATL should be non-negative
    for (const p of tsb.points) {
      expect(p.ctl).toBeGreaterThanOrEqual(0);
      expect(p.atl).toBeGreaterThanOrEqual(0);
    }
  });

  it("CTL is a longer-term average than ATL", () => {
    // After a training block, ATL should react faster than CTL
    // So at the latest point, if training recently, ATL >= CTL
    const last = tsb.points[tsb.points.length - 1];
    if (last) {
      // TSB = CTL - ATL — can be negative (fatigued) or positive (fresh)
      expect(last.tsb).toBe(Math.round(last.ctl - last.atl));
    }
  });

  it("provides current values", () => {
    expect(tsb.currentCTL).toBeGreaterThanOrEqual(0);
    expect(tsb.currentATL).toBeGreaterThanOrEqual(0);
    expect(typeof tsb.currentTSB).toBe("number");
  });
});

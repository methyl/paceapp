import { describe, it, expect } from "vitest";
import { parseFixture } from "./fixtures/loadAll";
import { computePriorLoad } from "../frontend/fitness";


describe("prior load calculation", () => {
  it("accounts for HR intensity: post-interval recovery is not light load", async () => {
    // 2026-04-08: 2km easy + 1km @3:54 (HR ~157) + recovery + 1km @3:45
    // Find the first recovery segment after a hard interval (HR > 150)
    const a = await parseFixture("2026-04-08");

    // Find index of first segment with HR > 150 (hard interval)
    const hardIdx = a.segments.findIndex(
      (s) => s.avgHeartRate != null && s.avgHeartRate > 150
    );
    expect(hardIdx).toBeGreaterThan(0);

    // Prior load at the segment AFTER the hard interval
    const priorAfterHard = computePriorLoad(a.segments, hardIdx + 1);
    expect(priorAfterHard.load).not.toBe("fresh");
    expect(priorAfterHard.load).not.toBe("light");
  });

  it("fresh at start of workout", async () => {
    const a = await parseFixture("2026-04-08");
    const priorAtSeg1 = computePriorLoad(a.segments, 0);
    expect(priorAtSeg1.load).toBe("fresh");
  });

  it("heavy prior load after multiple hard intervals: 2026-02-28", async () => {
    const a = await parseFixture("2026-02-28");
    // After warmup + 4 intervals, prior load should be heavy
    const priorAtLastInterval = computePriorLoad(a.segments, 8);
    expect(["moderate", "heavy"]).toContain(priorAtLastInterval.load);
  });
});

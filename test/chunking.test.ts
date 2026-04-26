import { describe, it, expect } from "vitest";
import { parseFixture } from "./fixtures/loadAll";

describe("long segment chunking", () => {
  it("splits segments longer than 2km into ~1km chunks: 2026-04-05", async () => {
    // This workout has a 12.3km opening segment — useless for comparison
    const a = await parseFixture("2026-04-05");
    // No segment should be longer than 2km
    for (const seg of a.segments) {
      expect(
        seg.totalDistance,
        `Seg ${seg.lapIndex}: ${(seg.totalDistance / 1000).toFixed(1)}km is too long`
      ).toBeLessThan(2200);
    }
  });

  it("splits segments longer than 2km into ~1km chunks: 2025-09-16", async () => {
    // Has an 8.2km segment and a 5.6km segment
    const a = await parseFixture("2025-09-16");
    for (const seg of a.segments) {
      expect(
        seg.totalDistance,
        `Seg ${seg.lapIndex}: ${(seg.totalDistance / 1000).toFixed(1)}km is too long`
      ).toBeLessThan(2200);
    }
  });

  it("preserves short segments (intervals, recovery) as-is: 2026-02-28", async () => {
    const a = await parseFixture("2026-02-28");
    // Interval segments (~400m) should NOT be split further
    const shortSegs = a.segments.filter((s) => s.totalDistance < 500 && s.totalDistance > 200);
    expect(shortSegs.length).toBeGreaterThan(0);
    // They should still be present
    for (const seg of shortSegs) {
      expect(seg.totalDistance).toBeGreaterThan(200);
    }
  });

  it("total distance is preserved after chunking", async () => {
    const a = await parseFixture("2026-04-05");
    const segTotal = a.segments.reduce((s, seg) => s + seg.totalDistance, 0);
    const lapTotal = a.laps.reduce((s, lap) => s + lap.totalDistance, 0);
    // Should be within 1% of original
    expect(Math.abs(segTotal - lapTotal) / lapTotal).toBeLessThan(0.01);
  });

  it("segment pace agrees with totalDistance/totalElapsedTime", async () => {
    // Regression: avgSpeed used to be the mean of instantaneous record
    // speeds, which drifts from distance/time and made the Pace column
    // disagree with the Time column on ~1km chunks (e.g. 4:17 / 4:09).
    for (const fx of ["2026-04-05", "2025-09-16", "2026-04-04"]) {
      const a = await parseFixture(fx);
      for (const seg of a.segments) {
        if (seg.totalDistance < 100 || seg.totalElapsedTime < 10) continue;
        const expectedSpeed = seg.totalDistance / seg.totalElapsedTime;
        expect(
          seg.avgSpeed,
          `${fx} seg ${seg.lapIndex}: avgSpeed should be distance/time`
        ).toBeCloseTo(expectedSpeed, 4);
      }
    }
  });
});

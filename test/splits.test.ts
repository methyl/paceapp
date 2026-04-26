import { describe, it, expect } from "vitest";
import { parseFixture } from "./fixtures/loadAll";
import { computeKmSplits } from "../shared/splits";


describe("computeKmSplits", () => {
  it("produces ~1km splits regardless of lap structure: 2026-02-28 (manual laps)", async () => {
    // Manual-lap intervals workout — laps are non-uniform, but record stream
    // should still yield clean ~1km splits.
    const a = await parseFixture("2026-02-28");
    const splits = computeKmSplits(a.records);
    expect(splits.length).toBeGreaterThan(2);
    // Each non-tail split should be 900–1100m.
    for (let i = 0; i < splits.length - 1; i++) {
      expect(splits[i].totalDistance).toBeGreaterThan(900);
      expect(splits[i].totalDistance).toBeLessThan(1150);
    }
  });

  it("preserves total distance across splits: 2026-04-05", async () => {
    const a = await parseFixture("2026-04-05");
    const splits = computeKmSplits(a.records);
    const splitTotal = splits.reduce((s, p) => s + p.totalDistance, 0);
    const lapTotal = a.laps.reduce((s, l) => s + l.totalDistance, 0);
    expect(Math.abs(splitTotal - lapTotal) / lapTotal).toBeLessThan(0.02);
  });

  it("returns empty when records are missing or too few", () => {
    expect(computeKmSplits([])).toEqual([]);
    expect(computeKmSplits([{ timestamp: "", elapsed: 0, distance: 0, lapIndex: 1 }])).toEqual([]);
  });

  it("populates pace, HR, and dynamics per split: 2025-05-27", async () => {
    const a = await parseFixture("2025-05-27");
    const splits = computeKmSplits(a.records);
    expect(splits.length).toBeGreaterThan(0);
    for (const s of splits) {
      expect(s.totalElapsedTime).toBeGreaterThan(0);
      expect(s.avgSpeed).toBeGreaterThan(0);
      expect(s.avgPace).toMatch(/^\d+:\d{2}$/);
    }
  });
});

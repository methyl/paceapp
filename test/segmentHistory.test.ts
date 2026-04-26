import { describe, it, expect } from "vitest";
import { parseFixture } from "./fixtures/loadAll";
import { groupCurrentSegments, findHistoricalPoints } from "../frontend/segmentHistory";


describe("segment history: distance bucket isolation", () => {
  it("does not match ~200m strides to 1km reps at same pace", async () => {
    // Load a strides workout and a 1km intervals workout
    const strides = await parseFixture("2026-03-29");
    const intervals = await parseFixture("2025-06-24");
    const all = [strides, intervals];

    const groups = groupCurrentSegments(strides);
    // Find a stride group (~200m fast segments)
    const strideGroup = groups.find(
      (g) => g.avgSpeed > 3.0 && g.segments.some((s) => s.seg.totalDistance < 300)
    );
    if (!strideGroup) return;

    const points = findHistoricalPoints(strideGroup, all, strides.id);
    // Should NOT find matches from the 800m/1km interval workout
    const fromIntervals = points.filter((p) => !p.isCurrent);
    // The 800m reps from 2025-06-24 should not match ~200m strides
    expect(fromIntervals.length).toBe(0);
  });
});

describe("segment history: running dynamics", () => {
  it("groups include running dynamics averages", async () => {
    const a = await parseFixture("2026-04-08");
    const groups = groupCurrentSegments(a);
    expect(groups.length).toBeGreaterThan(0);

    // At least one group should have dynamics data
    const withDynamics = groups.filter(
      (g) => g.avgVerticalOscillation != null || g.avgGroundContactTime != null
    );
    expect(withDynamics.length).toBeGreaterThan(0);
  });

  it("historical points include running dynamics", async () => {
    const files = ["2026-04-08", "2026-04-04", "2026-04-05"];
    const activities = await Promise.all(
      files.map(async (f) => parseFixture(f))
    );

    const groups = groupCurrentSegments(activities[0]);
    if (groups.length === 0) return;

    const points = findHistoricalPoints(groups[0], activities, activities[0].id);
    if (points.length === 0) return;

    // Points should have dynamics fields
    const withDynamics = points.filter(
      (p) => p.avgVerticalOscillation != null || p.avgGroundContactTime != null
    );
    expect(withDynamics.length).toBeGreaterThan(0);
  });
});

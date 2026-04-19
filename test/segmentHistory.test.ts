import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../frontend/parseFit";
import { groupCurrentSegments, findHistoricalPoints } from "../frontend/segmentHistory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("segment history: distance bucket isolation", () => {
  it("does not match ~200m strides to 1km reps at same pace", async () => {
    // Load a strides workout and a 1km intervals workout
    const strides = await parseFitFile(loadFixture("2026-03-29"), "strides");
    const intervals = await parseFitFile(loadFixture("2025-06-24"), "intervals");
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
    const a = await parseFitFile(loadFixture("2026-04-08"), "test");
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
      files.map(async (f) => parseFitFile(loadFixture(f), f))
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

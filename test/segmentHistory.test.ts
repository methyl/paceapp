import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../src/parseFit";
import { groupCurrentSegments, findHistoricalPoints } from "../src/segmentHistory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

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

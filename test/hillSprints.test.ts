import { describe, it, expect } from "vitest";
import { parseFixture } from "./fixtures/loadAll";
import { detectHillSprints } from "../frontend/hillSprints";


describe("hill sprint detection", () => {
  it("detects hill sprints on Sept 9 workout", async () => {
    const a = await parseFixture("2025-09-09");
    const sprints = detectHillSprints(a.records);

    // Should find the ~10 real hill sprints (150m, 7-9% grade)
    const significant = sprints.filter((s) => s.grade > 5 && s.distance > 80);
    expect(significant.length).toBeGreaterThanOrEqual(8);
  });

  it("each sprint has grade, distance, pace, and elevation gain", async () => {
    const a = await parseFixture("2025-09-09");
    const sprints = detectHillSprints(a.records);
    expect(sprints.length).toBeGreaterThan(0);

    for (const s of sprints) {
      expect(s.grade).toBeGreaterThan(3);
      expect(s.distance).toBeGreaterThanOrEqual(50);
      expect(s.elevationGain).toBeGreaterThan(0);
      expect(s.avgSpeed).toBeGreaterThan(0);
    }
  });

  it("doesn't detect significant hill sprints on flat terrain: 2026-04-04", async () => {
    const a = await parseFixture("2026-04-04");
    const sprints = detectHillSprints(a.records);
    const significant = sprints.filter((s) => s.grade > 5 && s.distance > 80);
    expect(significant.length).toBeLessThan(3);
  });
});

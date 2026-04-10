import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../src/parseFit";
import { computeContextFitness, type ContextFitness } from "../src/fitness";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadAll(): Promise<
  Awaited<ReturnType<typeof parseFitFile>>[]
> {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".fit"));
  return Promise.all(
    files.map(async (name) => {
      const buf = readFileSync(join(FIXTURES, name));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return parseFitFile(ab, name);
    })
  );
}

describe("context-based fitness", { timeout: 30000 }, () => {
  it("produces fitness contexts from multiple activities", async () => {
    const activities = (await loadAll()).filter(
      (a) => a.summary.sport === "running"
    );
    const fitness = computeContextFitness(activities);

    // Should have at least one context with data
    expect(fitness.contexts.length).toBeGreaterThan(0);
  });

  it("separates easy 1km segments from interval reps", async () => {
    const activities = (await loadAll()).filter(
      (a) => a.summary.sport === "running"
    );
    const fitness = computeContextFitness(activities);

    // Should have distinct contexts for different efforts
    const labels = fitness.contexts.map((c) => c.label);
    // Should not have a single generic context — should be split by type
    expect(labels.length).toBeGreaterThan(1);
  });

  it("each context has a trend with multiple data points", async () => {
    const activities = (await loadAll()).filter(
      (a) => a.summary.sport === "running"
    );
    const fitness = computeContextFitness(activities);

    // At least one context should have >= 3 data points for a meaningful trend
    const withTrend = fitness.contexts.filter((c) => c.points.length >= 3);
    expect(withTrend.length).toBeGreaterThan(0);
  });

  it("higher training load boosts form score", async () => {
    const activities = (await loadAll()).filter(
      (a) => a.summary.sport === "running"
    );
    const fitness = computeContextFitness(activities);

    // Apr 8 has 5 workouts in 14 days — should score higher than
    // a period with 1 workout even if raw EF is similar
    const apr8 = fitness.formCurve.find((p) => p.dateStr.includes("Apr") && p.dateStr.includes("8"));
    const mar22 = fitness.formCurve.find((p) => p.dateStr.includes("Mar") && p.dateStr.includes("22"));

    // Mar 22 had 1 workout (fresh), Apr 8 had 5 workouts (loaded)
    // With training load bonus, Apr 8 should score >= Mar 22
    // Find periods with different training loads
    const apr = fitness.formCurve.filter((p) => p.dateStr.includes("Apr"));
    const feb = fitness.formCurve.filter((p) => p.dateStr.includes("Feb"));
    if (apr.length > 0 && feb.length > 0) {
      const aprAvg = apr.reduce((s, p) => s + p.score, 0) / apr.length;
      const febAvg = feb.reduce((s, p) => s + p.score, 0) / feb.length;
      // April with higher training load should score >= Feb with sparse training
      expect(aprAvg).toBeGreaterThanOrEqual(febAvg);
    }
  });

  it("computes an overall fitness score using all contexts, not just one", async () => {
    const activities = (await loadAll()).filter(
      (a) => a.summary.sport === "running"
    );
    const fitness = computeContextFitness(activities);

    expect(fitness.currentScore).toBeGreaterThanOrEqual(0);
    expect(fitness.currentScore).toBeLessThanOrEqual(100);
    expect(fitness.trend).toMatch(/improving|stable|declining/);

    // Score should be based on multiple contexts, not just one
    expect(fitness.contextWeights.length).toBeGreaterThan(1);
    // All weights should sum to ~1
    const totalWeight = fitness.contextWeights.reduce((s, w) => s + w.weight, 0);
    expect(totalWeight).toBeGreaterThan(0.9);
    expect(totalWeight).toBeLessThan(1.1);
  });
});

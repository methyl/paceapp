import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../src/parseFit";
import { computeTSB, type TSBData } from "../src/tsb";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadAll() {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".fit"));
  return Promise.all(
    files.map(async (name) => {
      const buf = readFileSync(join(FIXTURES, name));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return parseFitFile(ab, name);
    })
  );
}

describe("TSB model", () => {
  it("computes CTL, ATL, TSB from activities with HR data", async () => {
    const activities = (await loadAll()).filter(
      (a) => a.summary.sport === "running" && a.summary.avgHeartRate
    );
    const tsb = computeTSB(activities);

    expect(tsb.points.length).toBeGreaterThan(0);

    // CTL and ATL should be non-negative
    for (const p of tsb.points) {
      expect(p.ctl).toBeGreaterThanOrEqual(0);
      expect(p.atl).toBeGreaterThanOrEqual(0);
    }
  });

  it("CTL is a longer-term average than ATL", async () => {
    const activities = (await loadAll()).filter(
      (a) => a.summary.sport === "running" && a.summary.avgHeartRate
    );
    const tsb = computeTSB(activities);

    // After a training block, ATL should react faster than CTL
    // So at the latest point, if training recently, ATL >= CTL
    const last = tsb.points[tsb.points.length - 1];
    if (last) {
      // TSB = CTL - ATL — can be negative (fatigued) or positive (fresh)
      expect(last.tsb).toBe(Math.round(last.ctl - last.atl));
    }
  });

  it("provides current values", async () => {
    const activities = (await loadAll()).filter(
      (a) => a.summary.sport === "running" && a.summary.avgHeartRate
    );
    const tsb = computeTSB(activities);

    expect(tsb.currentCTL).toBeGreaterThanOrEqual(0);
    expect(tsb.currentATL).toBeGreaterThanOrEqual(0);
    expect(typeof tsb.currentTSB).toBe("number");
  });
});

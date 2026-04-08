import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../src/parseFit";
import { computePriorLoad } from "../src/fitness";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("prior load calculation", () => {
  it("accounts for HR intensity: post-interval recovery is not light load", async () => {
    // 2026-04-08: 2km easy + 1km @3:54 (HR ~157) + recovery + 1km @3:45
    // Find the first recovery segment after a hard interval (HR > 150)
    const a = await parseFitFile(loadFixture("2026-04-08"), "test");

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
    const a = await parseFitFile(loadFixture("2026-04-08"), "test");
    const priorAtSeg1 = computePriorLoad(a.segments, 0);
    expect(priorAtSeg1.load).toBe("fresh");
  });

  it("heavy prior load after multiple hard intervals: 2026-02-28", async () => {
    const a = await parseFitFile(loadFixture("2026-02-28"), "test");
    // After warmup + 4 intervals, prior load should be heavy
    const priorAtLastInterval = computePriorLoad(a.segments, 8);
    expect(["moderate", "heavy"]).toContain(priorAtLastInterval.load);
  });
});

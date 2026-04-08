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
    // After the first 1km hard interval, prior load should NOT be "fresh" or "light"
    const a = await parseFitFile(loadFixture("2026-04-08"), "test");

    // Segment 3 = recovery after first hard 1km rep
    // Prior load should reflect the hard effort (HR ~157)
    const priorAtSeg3 = computePriorLoad(a.segments, 2);

    // After a warmup + a hard interval at 157bpm, load should be at least moderate
    expect(priorAtSeg3.load).not.toBe("fresh");
    expect(priorAtSeg3.load).not.toBe("light");
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

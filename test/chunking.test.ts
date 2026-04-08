import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../src/parseFit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("long segment chunking", () => {
  it("splits segments longer than 2km into ~1km chunks: 2026-04-05", async () => {
    // This workout has a 12.3km opening segment — useless for comparison
    const a = await parseFitFile(loadFixture("2026-04-05"), "test");
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
    const a = await parseFitFile(loadFixture("2025-09-16"), "test");
    for (const seg of a.segments) {
      expect(
        seg.totalDistance,
        `Seg ${seg.lapIndex}: ${(seg.totalDistance / 1000).toFixed(1)}km is too long`
      ).toBeLessThan(2200);
    }
  });

  it("preserves short segments (intervals, recovery) as-is: 2026-02-28", async () => {
    const a = await parseFitFile(loadFixture("2026-02-28"), "test");
    // Interval segments (~400m) should NOT be split further
    const shortSegs = a.segments.filter((s) => s.totalDistance < 500 && s.totalDistance > 200);
    expect(shortSegs.length).toBeGreaterThan(0);
    // They should still be present
    for (const seg of shortSegs) {
      expect(seg.totalDistance).toBeGreaterThan(200);
    }
  });

  it("total distance is preserved after chunking", async () => {
    const a = await parseFitFile(loadFixture("2026-04-05"), "test");
    const segTotal = a.segments.reduce((s, seg) => s + seg.totalDistance, 0);
    const lapTotal = a.laps.reduce((s, lap) => s + lap.totalDistance, 0);
    // Should be within 1% of original
    expect(Math.abs(segTotal - lapTotal) / lapTotal).toBeLessThan(0.01);
  });
});

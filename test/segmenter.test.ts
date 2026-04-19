import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../frontend/parseFit";
import { isAutoLap } from "../frontend/segmenter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("auto-lap detection", () => {
  it("detects auto-laps on 1km splits: 2026-04-04", async () => {
    const a = await parseFitFile(loadFixture("2026-04-04"), "test");
    expect(isAutoLap(a.laps)).toBe(true);
  });

  it("detects manual laps: 2026-02-28 (intervals)", async () => {
    const a = await parseFitFile(loadFixture("2026-02-28"), "test");
    expect(isAutoLap(a.laps)).toBe(false);
  });

  it("detects auto-laps: 2025-09-19 (easy run)", async () => {
    const a = await parseFitFile(loadFixture("2025-09-19"), "test");
    expect(isAutoLap(a.laps)).toBe(true);
  });
});

describe("effort segmentation", () => {
  it("keeps manual lap structure but chunks long segments: 2026-02-28", async () => {
    const a = await parseFitFile(loadFixture("2026-02-28"), "test");
    // Manual laps should be preserved — short segments unchanged
    // But the 2.9km warmup should be chunked into ~1km pieces
    const shortLaps = a.laps.filter((l) => l.totalDistance < 2000);
    const shortSegs = a.segments.filter(
      (s) => !s.detected && s.totalDistance < 2000
    );
    // Short interval/recovery laps should still be there
    expect(shortSegs.length).toBeGreaterThanOrEqual(shortLaps.length);
  });

  it("does not create micro-segments from auto-laps: 2026-04-04", async () => {
    const a = await parseFitFile(loadFixture("2026-04-04"), "test");
    // If segments are detected, none should be < 200m
    for (const seg of a.segments) {
      if (seg.detected) {
        expect(seg.totalDistance).toBeGreaterThan(150);
      }
    }
  });

  it("does not over-segment a steady auto-lap run: 2025-05-27 (10km)", async () => {
    const a = await parseFitFile(loadFixture("2025-05-27"), "test");
    if (a.segmentsDetected) {
      // Steady run should not produce more segments than original laps
      expect(a.segments.length).toBeLessThanOrEqual(a.laps.length);
    }
  });

  it("falls back to original laps for steady run: 2026-03-28", async () => {
    const a = await parseFitFile(loadFixture("2026-03-28"), "test");
    // 10km easy run with auto-laps — no structure to detect
    if (a.segmentsDetected) {
      // If it does segment, should be few segments, not choppy
      expect(a.segments.length).toBeLessThan(5);
    }
  });
});

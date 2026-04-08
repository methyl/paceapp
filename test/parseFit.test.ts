import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../src/parseFit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function findFixture(pattern: string): string {
  const files = readdirSync(FIXTURES);
  const match = files.find((f) => f.includes(pattern));
  if (!match) throw new Error(`No fixture matching "${pattern}"`);
  return match;
}

function loadFixture(pattern: string): ArrayBuffer {
  const name = findFixture(pattern);
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("parseFitFile", () => {
  it("uses timer_time (moving time) not elapsed_time", async () => {
    // 2026-02-28: lap 9 has elapsed=194s but timer=118s (pause during recovery)
    const a = await parseFitFile(loadFixture("2026-02-28"), "test");
    const lap9 = a.laps[8];
    expect(lap9.totalElapsedTime).toBeLessThan(140);
    expect(lap9.totalElapsedTime).toBeGreaterThan(100);
  });

  it("computes sane pace when FIT avg_speed is wrong", async () => {
    // 2026-02-28: lap 9 FIT avg_speed=7.66 m/s (2:11/km) which is impossible
    const a = await parseFitFile(loadFixture("2026-02-28"), "test");
    const lap9 = a.laps[8];
    // Should be ~2.69 m/s (6:11/km)
    expect(lap9.avgSpeed).toBeGreaterThan(2);
    expect(lap9.avgSpeed).toBeLessThan(4);
  });

  it("all laps have plausible pace for running activities", async () => {
    const patterns = ["2026-02-28", "2026-04-04", "2025-06-01", "2025-10-12"];
    for (const p of patterns) {
      const a = await parseFitFile(loadFixture(p), p);
      for (const lap of a.laps) {
        if (lap.avgSpeed && lap.avgSpeed > 0 && lap.totalDistance > 100) {
          const paceSecPerKm = 1000 / lap.avgSpeed;
          expect(paceSecPerKm, `${p} lap ${lap.lapIndex}`).toBeGreaterThan(150);
          expect(paceSecPerKm, `${p} lap ${lap.lapIndex}`).toBeLessThan(600);
        }
      }
    }
  });

  it("filters non-running activities", async () => {
    // Soccer and cycling should be filtered by the app (sport check in App.tsx)
    const soccer = await parseFitFile(loadFixture("2025-08-28"), "test");
    expect(soccer.summary.sport).toBe("soccer");
    const cycling = await parseFitFile(loadFixture("2025-12-27"), "test");
    expect(cycling.summary.sport).toBe("cycling");
  });

  it("handles files with 0 laps", async () => {
    // HealthFit file with 0 laps
    const a = await parseFitFile(loadFixture("2026-01-25-142331"), "test");
    expect(a.laps.length).toBe(0);
    expect(a.summary.totalDistance).toBeGreaterThan(0);
  });

  it("handles paused workouts with elapsed != timer time", async () => {
    // 2025-06-21: elapsed=1456, timer=1182 (paused)
    const a = await parseFitFile(loadFixture("2025-06-21"), "test");
    // Total should use timer time when available
    expect(a.summary.totalElapsedTime).toBeLessThan(1300);
  });
});

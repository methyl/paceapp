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

  it("uses distance/time for pace instead of FIT avg_speed: 2026-03-24", async () => {
    // Garmin displays computed pace (distance/time), not FIT avg_speed.
    // FIT avg_speed is systematically faster than distance/time.
    // Lap 1: Garmin shows 6:00/km, FIT avg_speed gives 5:52, distance/time gives 6:00
    // Lap 10: Garmin shows 5:15/km, FIT avg_speed gives 4:48, distance/time gives 5:13
    const a = await parseFitFile(loadFixture("2026-03-24"), "test");

    // Lap 1: 1000m in 360s = 2.778 m/s = 6:00/km (not 5:52 from avg_speed)
    const lap1 = a.laps[0];
    const pace1 = lap1.avgSpeed ? 1000 / lap1.avgSpeed : 0;
    expect(pace1).toBeGreaterThan(350); // slower than 5:50
    expect(pace1).toBeLessThan(370);    // faster than 6:10

    // Lap 10: 1000m in 313s = 3.197 m/s = 5:13/km (not 4:48 from avg_speed)
    const lap10 = a.laps[9];
    const pace10 = lap10.avgSpeed ? 1000 / lap10.avgSpeed : 0;
    expect(pace10).toBeGreaterThan(305); // slower than 5:05
    expect(pace10).toBeLessThan(325);    // faster than 5:25
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

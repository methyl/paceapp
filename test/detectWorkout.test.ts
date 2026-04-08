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

describe("workout type detection", () => {
  it("detects interval workout: 2026-02-28 (400m reps with recovery)", async () => {
    const a = await parseFitFile(loadFixture("2026-02-28"), "test");
    expect(a.workoutType).toBe("intervals");
  });

  it("detects interval workout: 2025-06-24 (800m reps)", async () => {
    const a = await parseFitFile(loadFixture("2025-06-24"), "test");
    expect(a.workoutType).toBe("intervals");
  });

  it("detects easy run: 2025-09-19 (8km, HR 125, auto-laps)", async () => {
    const a = await parseFitFile(loadFixture("2025-09-19"), "test");
    expect(a.workoutType).toBe("easy");
  });

  it("detects easy run: 2025-07-27 (indoor, 5km, HR 129)", async () => {
    const a = await parseFitFile(loadFixture("2025-07-27"), "test");
    expect(a.workoutType).toBe("easy");
  });

  it("does not classify steady run as intervals: 2026-04-04 (10km auto-laps)", async () => {
    // This is a steady run with auto-laps, NOT intervals
    const a = await parseFitFile(loadFixture("2026-04-04"), "test");
    expect(a.workoutType).not.toBe("intervals");
  });

  it("detects race: 2025-06-01 (5km, 4:10/km, HR 165)", async () => {
    const a = await parseFitFile(loadFixture("2025-06-01"), "test");
    expect(a.workoutType).toBe("race");
  });

  it("detects race: 2025-10-12 (half marathon, HR 163)", async () => {
    const a = await parseFitFile(loadFixture("2025-10-12"), "test");
    expect(a.workoutType).toBe("race");
  });

  it("does not classify easy run as race: 2025-11-02 (7km, HR 131)", async () => {
    const a = await parseFitFile(loadFixture("2025-11-02"), "test");
    expect(a.workoutType).not.toBe("race");
  });
});

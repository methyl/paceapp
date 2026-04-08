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

describe("workout label generation", () => {
  it("labels steady run without splitting into intervals: 2026-04-04", async () => {
    const a = await parseFitFile(loadFixture("2026-04-04"), "test");
    // Should NOT contain "×" (interval notation)
    expect(a.workoutLabel).not.toContain("×");
    // Should contain distance
    expect(a.workoutLabel).toMatch(/10/);
  });

  it("labels race with pace: 2025-06-01 (5km race)", async () => {
    const a = await parseFitFile(loadFixture("2025-06-01"), "test");
    expect(a.workoutLabel).toContain("race");
    expect(a.workoutLabel).toContain("@");
  });

  it("does not label first km as easy when pace matches rest", async () => {
    // 2026-04-04: steady 10km, first km HR is lower but pace same
    const a = await parseFitFile(loadFixture("2026-04-04"), "test");
    // Should not start with "1km easy +"
    expect(a.workoutLabel).not.toMatch(/^1km easy \+/);
  });

  it("labels interval workout with reps: 2025-06-24 (800m reps)", async () => {
    const a = await parseFitFile(loadFixture("2025-06-24"), "test");
    // Should contain "×" and "800m" or similar distance
    expect(a.workoutLabel).toContain("×");
  });

  it("does not show recovery jogs in label: 2026-02-28", async () => {
    const a = await parseFitFile(loadFixture("2026-02-28"), "test");
    // Count occurrences of "+" — interval label should be compact
    const plusCount = (a.workoutLabel.match(/\+/g) || []).length;
    // Warmup + intervals + cooldown = max 2 plus signs
    expect(plusCount).toBeLessThanOrEqual(2);
  });

  it("labels easy run simply: 2025-09-19", async () => {
    const a = await parseFitFile(loadFixture("2025-09-19"), "test");
    expect(a.workoutLabel).toContain("easy");
    expect(a.workoutLabel).not.toContain("×");
  });
});

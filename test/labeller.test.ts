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
    const a = await parseFitFile(loadFixture("2025-06-01-182712"), "test");
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
    // Label should contain interval notation (×)
    expect(a.workoutLabel).toContain("×");
    // Should not contain many tiny "easy" fragments from recoveries
    const easyParts = (a.workoutLabel.match(/easy/g) || []).length;
    // At most warmup easy + cooldown easy
    expect(easyParts).toBeLessThanOrEqual(2);
  });

  it("labels 15km easy/steady run as one block, not split: 2026-03-24", async () => {
    const a = await parseFitFile(loadFixture("2026-03-24"), "test");
    // Should be a single block like "15km easy" or "15km steady @5:30"
    // NOT "7km steady + 1km easy + 7km steady"
    const plusCount = (a.workoutLabel.match(/\+/g) || []).length;
    expect(plusCount).toBe(0);
  });

  it("labels strides workout compactly with time marker: 2026-03-29", async () => {
    const a = await parseFitFile(loadFixture("2026-03-29"), "test");
    // Should be like "3.5km easy + 6×1min @4:37 + 1.4km easy"
    expect(a.workoutLabel).toContain("×");
    // All strides grouped as one set
    expect((a.workoutLabel.match(/×/g) || []).length).toBe(1);
    // Short reps at consistent ~60s should use time label, not distance
    expect(a.workoutLabel).toMatch(/×1min/);
    // No "run @pace" for warmup/cooldown
    expect(a.workoutLabel).not.toMatch(/run @/);
    // Max 3 parts: warmup + reps + cooldown
    const parts = a.workoutLabel.split(" + ");
    expect(parts.length).toBeLessThanOrEqual(3);
  });

  it("labels easy run simply: 2025-09-19", async () => {
    const a = await parseFitFile(loadFixture("2025-09-19"), "test");
    expect(a.workoutLabel).toContain("easy");
    expect(a.workoutLabel).not.toContain("×");
  });
});

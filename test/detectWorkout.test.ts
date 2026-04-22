import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../frontend/parseFit";
import { deriveTags } from "../workers/src/tags";
import { fallbackZones } from "../workers/src/zones";

/**
 * This suite used to test the client-side `workoutType` enum returned
 * by parseFit. We've unified client + server onto a single classifier
 * that emits a tag set, so these now exercise `deriveTags` — the same
 * call the server makes on every backfill. If the primary tag the user
 * sees on their library row diverges from what the client computed at
 * upload time, that's the drift bug this suite catches.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function tagsFor(pattern: string): Promise<string[]> {
  const parsed = await parseFitFile(loadFixture(pattern), "test");
  return deriveTags({
    zones: fallbackZones(),
    summary: parsed.summary,
    laps: parsed.laps,
    segments: parsed.segments,
    records: parsed.records,
    totalDistance: parsed.summary.totalDistance,
    totalAscent: null,
  });
}

describe("workout type detection (unified tag system)", () => {
  it("detects interval workout: 2026-02-28 (400m reps with recovery)", async () => {
    const tags = await tagsFor("2026-02-28");
    expect(tags).toContain("intervals");
  });

  it("detects interval workout: 2025-06-24 (800m reps)", async () => {
    const tags = await tagsFor("2025-06-24");
    expect(tags).toContain("intervals");
    expect(tags).not.toContain("strides");
  });

  it("detects easy run: 2025-09-19 (8km, HR 125, auto-laps)", async () => {
    const tags = await tagsFor("2025-09-19");
    expect(tags).toContain("easy");
    expect(tags).not.toContain("tempo");
    expect(tags).not.toContain("race");
  });

  it("detects easy run: 2025-07-27 (indoor, 5km, HR 129)", async () => {
    const tags = await tagsFor("2025-07-27");
    expect(tags).toContain("easy");
  });

  it("detects steady run, not progressive: 2026-04-04 (10km, HR 127-153, pace ~4:46)", async () => {
    const tags = await tagsFor("2026-04-04");
    expect(tags).toContain("steady");
    expect(tags).not.toContain("progressive");
    expect(tags).not.toContain("intervals");
  });

  it("detects race: 2025-06-01 (5km, 4:10/km, HR 165)", async () => {
    const tags = await tagsFor("2025-06-01-182712");
    expect(tags).toContain("race");
  });

  it("detects race: 2025-10-12 (half marathon, HR 163)", async () => {
    const tags = await tagsFor("2025-10-12-100103");
    expect(tags).toContain("race");
  });

  it("detects strides workout as intervals, not easy: 2026-03-29", async () => {
    // 3.5km easy + 6×~230m strides with recovery + 1.4km cooldown
    const tags = await tagsFor("2026-03-29");
    expect(tags).toContain("intervals");
    expect(tags).not.toContain("easy");
  });

  it("classifies easy run with strides as easy, not intervals: 2026-04-05", async () => {
    // 12.3km easy + 6×~75m strides + 1.4km cooldown
    const tags = await tagsFor("2026-04-05");
    expect(tags).toContain("easy");
    expect(tags).toContain("strides");
    expect(tags).not.toContain("intervals");
    expect(tags).not.toContain("progressive");
    expect(tags).not.toContain("steady");
    expect(tags).not.toContain("tempo");
  });

  it("does not classify easy run as race: 2025-11-02 (7km, HR 131)", async () => {
    const tags = await tagsFor("2025-11-02");
    expect(tags).not.toContain("race");
  });
});

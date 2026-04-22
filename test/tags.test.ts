import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseFitFile } from "../frontend/parseFit";
import { deriveTags } from "../workers/src/tags";
import { fallbackZones } from "../workers/src/zones";
import type { ParsedActivity } from "../frontend/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function tagsFor(pattern: string, totalAscentOverride?: number) {
  const parsed = await parseFitFile(loadFixture(pattern), "test");
  return {
    tags: deriveTagsFromParsed(parsed, totalAscentOverride),
    parsed,
  };
}

function deriveTagsFromParsed(a: ParsedActivity, totalAscentOverride?: number) {
  return deriveTags({
    zones: fallbackZones(),
    summary: a.summary,
    laps: a.laps,
    segments: a.segments,
    records: a.records,
    totalDistance: a.summary.totalDistance,
    // Each fixture's altitude noise differs — let callers override when
    // they want to pin the hilly/not-hilly decision without depending on
    // smoothed noise floor.
    totalAscent: totalAscentOverride ?? null,
  });
}

describe("tag derivation (server uses shared detectWorkoutType)", () => {
  it("easy + strides is tagged [easy, strides] not intervals/progressive/steady", async () => {
    // Same fixture detectWorkout.test.ts pins as workoutType=easy; the
    // drift bug had the server tagging this as
    // [intervals, progressive, steady, strides] despite workoutType=easy.
    const { tags, parsed } = await tagsFor("2026-04-05");
    expect(parsed.workoutType).toBe("easy");
    expect(tags).toContain("easy");
    expect(tags).toContain("strides");
    expect(tags).not.toContain("intervals");
    expect(tags).not.toContain("progressive");
    expect(tags).not.toContain("steady");
    expect(tags).not.toContain("tempo");
  });

  it("explicit strides workout tagged intervals + strides (structured fast reps)", async () => {
    // 3.5km easy + 6×~230m strides — detectWorkoutType returns "intervals"
    // because the fast portion is large enough. The tag set should mirror
    // the client's classification: intervals + strides (strides keeps the
    // sub-type signal).
    const { tags, parsed } = await tagsFor("2026-03-29");
    expect(parsed.workoutType).toBe("intervals");
    expect(tags).toContain("intervals");
    expect(tags).toContain("strides");
  });

  it("steady run is tagged steady, not tempo", async () => {
    // 10km, HR 127-153, pace ~4:46 — detectWorkout pins as "steady". The
    // server's old reimplementation drifted into "tempo" on this one.
    const { tags, parsed } = await tagsFor("2026-04-04");
    expect(parsed.workoutType).toBe("steady");
    expect(tags).toContain("steady");
    expect(tags).not.toContain("tempo");
    expect(tags).not.toContain("intervals");
    expect(tags).not.toContain("progressive");
  });

  it("race workout gets the race tag", async () => {
    const { tags, parsed } = await tagsFor("2025-06-01-182712");
    expect(parsed.workoutType).toBe("race");
    expect(tags).toContain("race");
  });

  it("intervals workout gets intervals tag, not strides (reps are long enough)", async () => {
    // 800m reps — average rep distance is far above the strides cap
    // (300m), so this should be intervals without strides.
    const { tags, parsed } = await tagsFor("2025-06-24");
    expect(parsed.workoutType).toBe("intervals");
    expect(tags).toContain("intervals");
    expect(tags).not.toContain("strides");
  });

  it("easy run is tagged easy (no structural tags)", async () => {
    const { tags, parsed } = await tagsFor("2025-09-19");
    expect(parsed.workoutType).toBe("easy");
    expect(tags).toContain("easy");
    expect(tags).not.toContain("intervals");
    expect(tags).not.toContain("strides");
    expect(tags).not.toContain("progressive");
    expect(tags).not.toContain("tempo");
  });

  it("hill sprints workout gets hill-intervals tag", async () => {
    const { tags, parsed } = await tagsFor("2025-09-09");
    // The client's label says 'hills', so the structural detector
    // should identify uphill reps.
    expect(parsed.workoutLabel).toContain("hills");
    expect(tags).toContain("hill-intervals");
  });

  it("hilly tag requires both m/km ratio and a minimum absolute ascent", async () => {
    // A short easy run with moderate per-km ascent but <100m total
    // should NOT be tagged hilly.
    const { tags: tagsLowAbsolute } = await tagsFor("2025-09-19", 80);
    expect(tagsLowAbsolute).not.toContain("hilly");

    // A long run with both >=15 m/km and >=100m total should be hilly.
    const { tags: tagsHilly } = await tagsFor("2026-03-24", 300);
    expect(tagsHilly).toContain("hilly");
  });

  it("flat noisy GPS doesn't tag hilly (12 m/km but under absolute threshold)", async () => {
    // User-reported case: a 7km run with 77m unsmoothed ascent (11 m/km
    // inflated by GPS jitter) gets smoothed much lower and falls below
    // both the ratio and absolute thresholds.
    const { tags } = await tagsFor("2025-09-19", 70);
    expect(tags).not.toContain("hilly");
  });

  // User-reported regression: 2026-03-24 (15km, 145 avg bpm). Was landing
  // as [hilly, tempo] before the unification; should be steady-ish and
  // *not* tempo once the classifier agrees with the client's label.
  it("15km steady run (2026-03-24) tags steady, not tempo", async () => {
    const { tags, parsed } = await tagsFor("2026-03-24");
    // Whatever the client's detector says, the server must agree.
    expect(tags).toContain(parsed.workoutType);
    expect(tags).not.toContain("tempo");
  });

  // User-reported regression: 2025-10-26 (7km easy, 136 avg bpm). Was
  // landing as [easy, hilly] on a route the user reports as flat. The
  // smoothed-altitude fix drops totalAscent well below the hilly
  // threshold; confirm the derived meta lines up.
  it("7km easy on flat terrain (2025-10-26) doesn't tag hilly", async () => {
    const parsed = await parseFitFile(loadFixture("2025-10-26"), "test");
    // Simulate the server path: derive smoothed ascent from records,
    // pass through deriveTags.
    const { elevationFromRecords } = await import("../shared/elevation");
    const { ascent } = elevationFromRecords(parsed.records);
    const tags = deriveTagsFromParsed(parsed, ascent ?? undefined);
    expect(tags).not.toContain("hilly");
  });
});

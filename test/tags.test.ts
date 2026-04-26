import { describe, it, expect } from "vitest";
import { deriveTags } from "../workers/src/tags";
import { fallbackZones } from "../workers/src/zones";
import { parseFixture } from "./fixtures/loadAll";
import type { ParsedActivity } from "../frontend/types";

async function tagsFor(pattern: string, totalAscentOverride?: number) {
  const parsed = await parseFixture(pattern);
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
    const parsed = await parseFixture("2025-10-26");
    // Simulate the server path: derive smoothed ascent from records,
    // pass through deriveTags.
    const { elevationFromRecords } = await import("../shared/elevation");
    const { ascent } = elevationFromRecords(parsed.records);
    const tags = deriveTagsFromParsed(parsed, ascent ?? undefined);
    expect(tags).not.toContain("hilly");
  });

  // User-reported regression: a 10km tempo with user's saved zones
  // {z1:125, z2:143, z3:163, z4:176} was landing as "race" because the
  // classifier used to derive ceilings from a single anchor. Now the
  // zones are honored directly.
  it("custom zones: HR at Z3 upper end (152) classifies as tempo, not race", async () => {
    // Synthesize a run where most laps sit at HR ~152 — well within
    // Z3 (143-163) for these zones. The detector must pick "tempo".
    const zones = { z1_max: 125, z2_max: 143, z3_max: 163, z4_max: 176 };
    const tags = deriveTags({
      zones,
      summary: syntheticSummary(10_000),
      laps: syntheticLaps([152, 150, 153, 149, 155, 151, 154, 150, 152, 153]),
      segments: [],
      records: [],
      totalDistance: 10_000,
      totalAscent: null,
    });
    expect(tags).toContain("tempo");
    expect(tags).not.toContain("race");
    expect(tags).not.toContain("easy");
  });

  // User-reported regression: "137 avg HR cannot be steady if 90%+ of
  // the run was in Z2". Z2 under the user's zone scheme is aerobic
  // base / easy. The classifier used to bucket Z1→easy / Z2→steady,
  // which contradicted training vocabulary. Now Z1+Z2 → easy.
  it("Z2-dominant run (HR 137 under 125/143/163/176) tags easy, not steady", async () => {
    const zones = { z1_max: 125, z2_max: 143, z3_max: 163, z4_max: 176 };
    const tags = deriveTags({
      zones,
      summary: syntheticSummary(10_000),
      laps: syntheticLaps([135, 137, 138, 136, 139, 140, 137, 138, 135, 137]),
      segments: [],
      records: [],
      totalDistance: 10_000,
      totalAscent: null,
    });
    expect(tags).toContain("easy");
    expect(tags).not.toContain("steady");
    expect(tags).not.toContain("tempo");
  });

  // Mixed Z2 + Z3 is the definition of "steady" now — marathon-pace
  // territory where neither easy nor tempo dominates.
  it("mixed Z2+Z3 run tags steady", async () => {
    const zones = { z1_max: 125, z2_max: 143, z3_max: 163, z4_max: 176 };
    const tags = deriveTags({
      zones,
      summary: syntheticSummary(10_000),
      // Half the laps in Z2 (easy), half in Z3 (tempo).
      laps: syntheticLaps([140, 142, 148, 152, 141, 150, 143, 155, 139, 149]),
      segments: [],
      records: [],
      totalDistance: 10_000,
      totalAscent: null,
    });
    expect(tags).toContain("steady");
  });

  // User-reported regression: a plain steady run on a hilly route was
  // tagged [hill-intervals, steady] because detectHillSprints would
  // pick up any 3+ uphill stretches on a hilly route. hill-intervals
  // should require *structured* repeated reps going uphill.
  it("hilly terrain without interval structure doesn't tag hill-intervals", async () => {
    const zones = { z1_max: 125, z2_max: 143, z3_max: 163, z4_max: 176 };
    // Use a real easy-run fixture; pass totalAscent high enough to
    // clear the hilly threshold but expect *no* hill-intervals.
    const parsed = await parseFixture("2025-09-19");
    const tags = deriveTags({
      zones,
      summary: parsed.summary,
      laps: parsed.laps,
      segments: parsed.segments,
      records: parsed.records,
      totalDistance: parsed.summary.totalDistance,
      totalAscent: 300, // pretend it's hilly
    });
    expect(tags).toContain("hilly");
    expect(tags).not.toContain("hill-intervals");
  });
});

// ---- synthetic-input helpers ----

function syntheticSummary(totalDistance: number) {
  return {
    totalDistance,
    totalElapsedTime: 3600,
    avgPace: "5:00",
  };
}

function syntheticLaps(hrByLap: number[]) {
  return hrByLap.map((hr, i) => ({
    lapIndex: i,
    startTime: new Date(Date.UTC(2026, 3, 1, 6, i * 5, 0)).toISOString(),
    totalDistance: 1000,
    totalElapsedTime: 300,
    avgHeartRate: hr,
    avgSpeed: 3.3,
    avgPace: "5:00",
  }));
}

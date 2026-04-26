import { describe, it, expect } from "vitest";
import { reprocessActivity } from "../frontend/parseFit";
import { buildActivityView } from "../workers/src/mcp/activityView";
import { parseFixture } from "./fixtures/loadAll";
import type { LapSummary } from "../shared/types";

/**
 * Round-trip an activity through JSON to model the upload pipeline:
 * the UI POSTs `JSON.stringify(parsedActivity)` and the worker reads it
 * back via `await obj.json()`. Going through that round-trip drops
 * non-serializable fields like the raw FIT message blob.
 */
function asStored(parsed: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
}

const META_FOR_TEST = {
  id: "test-id",
  file_name: "test.fit",
  workout_type: null,
  workout_label: null,
  total_ascent_m: null,
  total_descent_m: null,
  tags: [],
};

const RECONCILIATION_FIXTURES = [
  "2026-04-04",
  "2026-02-28",
  "2025-09-19",
  "2025-05-27",
  "2026-04-05",
  "2026-03-28",
  "2026-03-24",
];

function compareLaps(uiLap: LapSummary, mcpLap: LapSummary, label: string) {
  expect(mcpLap.totalDistance, `${label} totalDistance`).toBeCloseTo(uiLap.totalDistance, 5);
  expect(mcpLap.totalElapsedTime, `${label} totalElapsedTime`).toBeCloseTo(uiLap.totalElapsedTime, 5);
  expect(mcpLap.avgSpeed ?? 0, `${label} avgSpeed`).toBeCloseTo(uiLap.avgSpeed ?? 0, 6);
  expect(mcpLap.avgPace, `${label} avgPace`).toBe(uiLap.avgPace);
  if (uiLap.avgHeartRate != null) {
    expect(mcpLap.avgHeartRate, `${label} avgHeartRate`).toBeCloseTo(uiLap.avgHeartRate, 4);
  }
}

describe("MCP ↔ UI reconciliation: same FIT yields the same numbers", () => {
  it.each(RECONCILIATION_FIXTURES)(
    "fixture %s: laps from MCP match laps shown in the UI",
    async (pattern) => {
      const ui = await parseFixture(pattern);
      const stored = asStored(ui);
      const mcp = buildActivityView(stored, META_FOR_TEST, ["laps"]);

      expect(mcp.laps).toBeDefined();
      expect(mcp.laps!.length).toBe(ui.laps.length);
      mcp.laps!.forEach((mcpLap, i) => {
        compareLaps(ui.laps[i], mcpLap, `${pattern} lap ${i + 1}`);
      });
    },
  );

  it.each(RECONCILIATION_FIXTURES)(
    "fixture %s: segments from MCP match segments shown in the UI",
    async (pattern) => {
      const ui = await parseFixture(pattern);
      const stored = asStored(ui);
      const mcp = buildActivityView(stored, META_FOR_TEST, ["segments"]);

      expect(mcp.segments).toBeDefined();
      expect(mcp.segments!.length).toBe(ui.segments.length);
      mcp.segments!.forEach((mcpSeg, i) => {
        compareLaps(ui.segments[i], mcpSeg, `${pattern} segment ${i + 1}`);
      });
    },
  );

  it.each(RECONCILIATION_FIXTURES)(
    "fixture %s: summary from MCP matches summary shown in the UI",
    async (pattern) => {
      const ui = await parseFixture(pattern);
      const stored = asStored(ui);
      const mcp = buildActivityView(stored, META_FOR_TEST, ["summary"]);

      expect(mcp.summary).toBeDefined();
      expect(mcp.summary!.totalDistance).toBeCloseTo(ui.summary.totalDistance, 5);
      expect(mcp.summary!.totalElapsedTime).toBeCloseTo(ui.summary.totalElapsedTime, 5);
      expect(mcp.summary!.avgSpeed ?? 0).toBeCloseTo(ui.summary.avgSpeed ?? 0, 6);
      expect(mcp.summary!.avgPace).toBe(ui.summary.avgPace);
    },
  );

  it("MCP segments survive a stored-data drift caused by an old segmenter", async () => {
    // Simulates the very bug that motivated this refactor: an activity
    // uploaded before the segmenter fix has segments where avgSpeed was
    // computed by averaging instantaneous record speeds (drifts away
    // from totalDistance / totalElapsedTime). MCP must still return the
    // canonical numbers — i.e. it must re-derive on read instead of
    // trusting the stored payload.
    const ui = await parseFixture("2026-02-28");
    const stored = asStored(ui);

    // Corrupt the stored segments + lap pace the same way old code did.
    const storedLaps = stored.laps as LapSummary[];
    for (const lap of storedLaps) {
      lap.avgSpeed = (lap.avgSpeed ?? 0) * 1.1; // pretend pace drifted ~10%
      lap.avgPace = "0:00";
    }
    const storedSegs = stored.segments as LapSummary[];
    for (const seg of storedSegs) {
      seg.avgSpeed = (seg.avgSpeed ?? 0) * 0.85; // pretend old mean-of-records was slow
      seg.avgPace = "9:99";
    }

    const mcp = buildActivityView(stored, META_FOR_TEST, ["laps", "segments"]);

    // Even though the stored numbers were garbage, MCP returned values
    // identical to what the UI would have shown.
    expect(mcp.laps!.length).toBe(ui.laps.length);
    mcp.laps!.forEach((mcpLap, i) => compareLaps(ui.laps[i], mcpLap, `corrupted lap ${i + 1}`));
    expect(mcp.segments!.length).toBe(ui.segments.length);
    mcp.segments!.forEach((mcpSeg, i) =>
      compareLaps(ui.segments[i], mcpSeg, `corrupted segment ${i + 1}`),
    );
  });

  it("MCP splits match the UI's `computeKmSplits` output", async () => {
    const { computeKmSplits } = await import("../shared/splits");
    const ui = await parseFixture("2025-05-27");
    const stored = asStored(ui);
    const mcp = buildActivityView(stored, META_FOR_TEST, ["splits"]);
    const uiSplits = computeKmSplits(ui.records);

    expect(mcp.splits!.length).toBe(uiSplits.length);
    mcp.splits!.forEach((s, i) => compareLaps(uiSplits[i], s, `split ${i + 1}`));
  });

  it("reprocessActivity is idempotent under MCP-style normalization", async () => {
    // The UI hits `reprocessActivity` on every load. If MCP and UI use
    // the same shared code, running the cached activity through both
    // must converge — no off-by-one, no rounding drift.
    const ui = await parseFixture("2026-02-28");
    const reprocessed = reprocessActivity(ui);
    const stored = asStored(reprocessed);
    const mcp = buildActivityView(stored, META_FOR_TEST, ["laps", "segments"]);

    mcp.laps!.forEach((mcpLap, i) => compareLaps(reprocessed.laps[i], mcpLap, `idem lap ${i + 1}`));
    mcp.segments!.forEach((mcpSeg, i) =>
      compareLaps(reprocessed.segments[i], mcpSeg, `idem segment ${i + 1}`),
    );
  });
});

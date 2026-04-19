import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Decoder, Stream } from "@garmin/fitsdk";
import { parseFitFile, reprocessActivity } from "../src/parseFit";
import { exportActivityToFit } from "../src/exportFit";
import { buildExtensionLaps, synthesizeRecords } from "../src/synthesizeExtension";
import type { ParsedActivity } from "../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function extendAndExport(pattern: string): Promise<{
  original: ParsedActivity;
  extended: ParsedActivity;
  reimported: ParsedActivity;
  rawMessages: Record<string, unknown[]>;
}> {
  const original = await parseFitFile(loadFixture(pattern), pattern);
  const lastRec = original.records[original.records.length - 1];
  const nextStart: [number, number] = [
    (lastRec.lat ?? 50) + 0.001,
    (lastRec.lng ?? 19) + 0.001,
  ];
  const waypoints: [number, number][] = [
    [lastRec.lat ?? 50, lastRec.lng ?? 19],
    nextStart,
    [nextStart[0] + 0.002, nextStart[1] + 0.003],
    [nextStart[0] + 0.005, nextStart[1] + 0.007],
  ];

  const synthetic = synthesizeRecords({
    existingRecords: original.records,
    waypoints,
    totalFinishTimeSeconds: lastRec.elapsed + 600,
  });
  expect(synthetic.length).toBeGreaterThan(0);

  const { laps: extensionLaps, replacesLastExistingLap } = buildExtensionLaps(
    synthetic, original.laps,
  );
  const untouched = replacesLastExistingLap
    ? original.laps.slice(0, -1)
    : original.laps;
  const replacedPartialLap = replacesLastExistingLap
    ? original.laps[original.laps.length - 1]
    : undefined;
  const extended: ParsedActivity = reprocessActivity({
    ...original,
    records: [...original.records, ...synthetic],
    laps: [...untouched, ...extensionLaps],
    originalRecordCount: original.records.length,
    originalLapCount: untouched.length,
    replacedPartialLap,
    extended: true,
  });

  const exported = exportActivityToFit(extended);

  const stream = Stream.fromByteArray(Array.from(exported));
  const decoder = new Decoder(stream);
  expect(decoder.isFIT()).toBe(true);
  expect(decoder.checkIntegrity()).toBe(true);
  const { messages } = decoder.read();

  const reimported = await parseFitFile(exported.buffer as ArrayBuffer, "roundtrip");

  return { original, extended, reimported, rawMessages: messages };
}

describe("Extended FIT export includes extension laps", () => {
  it("writes more lap messages than the original had", async () => {
    const { original, rawMessages } = await extendAndExport("2026-04-08");
    const origCount = original.rawFitMessages?.lapMesgs?.length ?? 0;
    expect(rawMessages.lapMesgs.length).toBeGreaterThan(origCount);
  });

  it("extension lap messages have required FIT fields", async () => {
    const { original, rawMessages } = await extendAndExport("2026-04-08");
    const origCount = original.rawFitMessages?.lapMesgs?.length ?? 0;
    const extensionLaps = rawMessages.lapMesgs.slice(origCount) as Record<string, unknown>[];
    expect(extensionLaps.length).toBeGreaterThan(0);
    for (const lap of extensionLaps) {
      expect(lap.timestamp).toBeDefined();
      expect(lap.startTime).toBeDefined();
      expect(lap.totalElapsedTime).toBeTypeOf("number");
      expect(lap.totalTimerTime).toBeTypeOf("number");
      expect(lap.totalDistance).toBeTypeOf("number");
      expect((lap.totalDistance as number)).toBeGreaterThan(0);
    }
  });

  it("re-importing the exported FIT surfaces the extension laps", async () => {
    const { original, reimported } = await extendAndExport("2026-04-08");
    expect(reimported.laps.length).toBeGreaterThan(original.laps.length);
  });

  it("re-imported extension laps carry running dynamics when source did", async () => {
    const { original, reimported } = await extendAndExport("2026-04-08");
    const origLast = original.laps[original.laps.length - 1];
    // If the source had running dynamics, the extension should too.
    if (origLast.avgVerticalOscillation != null) {
      const extLap = reimported.laps[reimported.laps.length - 1];
      expect(extLap.avgVerticalOscillation).toBeDefined();
      expect(extLap.avgGroundContactTime).toBeDefined();
      expect(extLap.avgStrideLength).toBeDefined();
    }
  });

  it("session numLaps matches the number of lap messages written", async () => {
    const { rawMessages } = await extendAndExport("2026-04-08");
    const session = rawMessages.sessionMesgs[0] as Record<string, unknown>;
    expect(session.numLaps).toBe(rawMessages.lapMesgs.length);
  });

  it("in-app activity.laps includes the extension laps", async () => {
    const { original, extended } = await extendAndExport("2026-04-08");
    expect(extended.laps.length).toBeGreaterThan(original.laps.length);
    const addedLap = extended.laps[extended.laps.length - 1];
    expect(addedLap.totalDistance).toBeGreaterThan(0);
    expect(addedLap.totalElapsedTime).toBeGreaterThan(0);
    expect(addedLap.avgPace).toBeTypeOf("string");
  });
});

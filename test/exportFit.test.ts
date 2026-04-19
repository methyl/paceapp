import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Decoder, Stream } from "@garmin/fitsdk";
import { parseFitFile } from "../frontend/parseFit";
import { exportActivityToFit } from "../frontend/exportFit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(pattern: string): ArrayBuffer {
  const files = readdirSync(FIXTURES);
  const name = files.find((f) => f.includes(pattern))!;
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("FIT export", () => {
  it("produces a valid FIT file from a parsed activity", async () => {
    const activity = await parseFitFile(loadFixture("2026-04-08"), "test");
    const exported = exportActivityToFit(activity);

    // Verify it's a valid FIT file
    const stream = Stream.fromByteArray(Array.from(exported));
    const decoder = new Decoder(stream);
    expect(decoder.isFIT()).toBe(true);
    expect(decoder.checkIntegrity()).toBe(true);
  });

  it("preserves record count in round-trip", async () => {
    const activity = await parseFitFile(loadFixture("2026-04-08"), "test");
    const exported = exportActivityToFit(activity);

    const stream = Stream.fromByteArray(Array.from(exported));
    const decoder = new Decoder(stream);
    const { messages } = decoder.read();

    expect(messages.recordMesgs.length).toBe(activity.records.length);
  });

  it("preserves lap count in round-trip", async () => {
    const activity = await parseFitFile(loadFixture("2026-04-08"), "test");
    const exported = exportActivityToFit(activity);

    const stream = Stream.fromByteArray(Array.from(exported));
    const decoder = new Decoder(stream);
    const { messages } = decoder.read();

    // Laps in original activity
    const originalLapCount = activity.rawFitMessages?.lapMesgs?.length ?? 0;
    expect(messages.lapMesgs.length).toBe(originalLapCount);
  });

  it("preserves GPS data in round-trip", async () => {
    const activity = await parseFitFile(loadFixture("2026-04-08"), "test");
    const exported = exportActivityToFit(activity);

    const stream = Stream.fromByteArray(Array.from(exported));
    const decoder = new Decoder(stream);
    const { messages } = decoder.read();

    const withGps = messages.recordMesgs.filter(
      (r: Record<string, unknown>) => r.positionLat != null
    );
    const origWithGps = activity.records.filter((r) => r.lat != null);

    expect(withGps.length).toBe(origWithGps.length);
  });

  it("works for activity without rawFitMessages (minimal export)", async () => {
    const activity = await parseFitFile(loadFixture("2026-04-08"), "test");
    // Strip raw messages to force minimal path
    activity.rawFitMessages = undefined;
    const exported = exportActivityToFit(activity);

    const stream = Stream.fromByteArray(Array.from(exported));
    const decoder = new Decoder(stream);
    expect(decoder.isFIT()).toBe(true);
    expect(decoder.checkIntegrity()).toBe(true);
  });
});

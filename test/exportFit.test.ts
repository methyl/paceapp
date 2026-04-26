import { describe, it, expect, beforeAll } from "vitest";
import { Decoder, Stream } from "@garmin/fitsdk";
import { exportActivityToFit } from "../frontend/exportFit";
import { parseFixture } from "./fixtures/loadAll";
import type { ParsedActivity } from "../frontend/types";

describe("FIT export", () => {
  let activity: ParsedActivity;
  let exported: Uint8Array;
  let messages: Record<string, unknown[]>;

  beforeAll(async () => {
    activity = await parseFixture("2026-04-08");
    exported = exportActivityToFit(activity);
    const stream = Stream.fromByteArray(Array.from(exported));
    const decoder = new Decoder(stream);
    expect(decoder.isFIT()).toBe(true);
    expect(decoder.checkIntegrity()).toBe(true);
    messages = decoder.read().messages;
  });

  it("produces a valid FIT file from a parsed activity", () => {
    const stream = Stream.fromByteArray(Array.from(exported));
    const decoder = new Decoder(stream);
    expect(decoder.isFIT()).toBe(true);
    expect(decoder.checkIntegrity()).toBe(true);
  });

  it("preserves record count in round-trip", () => {
    expect(messages.recordMesgs.length).toBe(activity.records.length);
  });

  it("preserves lap count in round-trip", () => {
    const originalLapCount = activity.rawFitMessages?.lapMesgs?.length ?? 0;
    expect(messages.lapMesgs.length).toBe(originalLapCount);
  });

  it("preserves GPS data in round-trip", () => {
    const withGps = messages.recordMesgs.filter(
      (r) => (r as Record<string, unknown>).positionLat != null
    );
    const origWithGps = activity.records.filter((r) => r.lat != null);

    expect(withGps.length).toBe(origWithGps.length);
  });

  it("works for activity without rawFitMessages (minimal export)", () => {
    // Independent export path — must not reuse the cached `exported` since
    // we want to exercise the branch that has no raw messages to copy from.
    const stripped: ParsedActivity = { ...activity, rawFitMessages: undefined };
    const minimal = exportActivityToFit(stripped);

    const stream = Stream.fromByteArray(Array.from(minimal));
    const decoder = new Decoder(stream);
    expect(decoder.isFIT()).toBe(true);
    expect(decoder.checkIntegrity()).toBe(true);
  });
});

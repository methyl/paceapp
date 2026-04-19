import { Encoder } from "@garmin/fitsdk";
import type { ParsedActivity, RecordPoint } from "./types";
import {
  detectAutoLapDistance,
  splitRecordsByDistance,
  splitRecordsWithFirstOffset,
} from "./synthesizeExtension";

/**
 * FIT message numbers from the FIT SDK profile.
 */
const MESG = {
  fileId: 0,
  fileCreator: 49,
  deviceInfo: 23,
  event: 21,
  sport: 12,
  record: 20,
  lap: 19,
  session: 18,
  activity: 34,
  timeInZone: 198,
} as const;

const SEMICIRCLE = 2 ** 31 / 180;

/**
 * Normalize a timestamp-like value (ISO string, Date, or number) to a Date
 * object. The Garmin FIT encoder reads Date objects and silently encodes
 * ISO strings as the FIT epoch (1989-12-31), which makes the activity look
 * invalid to strict parsers — they drop everything after the first bad
 * timestamp, so the extension is invisible in external apps.
 */
function toDate(ts: unknown): Date {
  if (ts instanceof Date) return ts;
  if (typeof ts === "string" || typeof ts === "number") return new Date(ts);
  // Unknown shape — return now rather than crash; the encoder will at least
  // produce a parseable file.
  return new Date();
}

/**
 * Convert a RecordPoint to a FIT record message.
 * Matches the field names the Garmin SDK Encoder expects (camelCase).
 */
function recordToFitMesg(r: RecordPoint): Record<string, unknown> {
  const mesg: Record<string, unknown> = {
    timestamp: toDate(r.timestamp),
  };
  if (r.lat != null && r.lng != null) {
    // Convert degrees to FIT semicircles
    mesg.positionLat = Math.round(r.lat * SEMICIRCLE);
    mesg.positionLong = Math.round(r.lng * SEMICIRCLE);
  }
  if (r.altitude != null) {
    mesg.altitude = r.altitude;
    mesg.enhancedAltitude = r.altitude;
  }
  if (r.distance != null) mesg.distance = r.distance;
  if (r.speed != null) {
    mesg.speed = r.speed;
    mesg.enhancedSpeed = r.speed;
  }
  if (r.heartRate != null) mesg.heartRate = r.heartRate;
  if (r.cadence != null) {
    // FIT stores half-cadence for running as uint8 rpm + a separate
    // fractionalCadence (scale 128). Split with floor so the pair decodes
    // back to the original spm; Math.round can inflate the integer while
    // leaving the fractional at 0.5, off by +2 spm on re-import.
    const half = r.cadence / 2;
    mesg.cadence = Math.floor(half);
    mesg.fractionalCadence = half - Math.floor(half);
  }
  if (r.verticalOscillation != null) mesg.verticalOscillation = r.verticalOscillation;
  if (r.groundContactTime != null) mesg.stanceTime = r.groundContactTime;
  if (r.groundContactTimeBalance != null) mesg.stanceTimeBalance = r.groundContactTimeBalance;
  if (r.strideLength != null) mesg.stepLength = r.strideLength;
  if (r.verticalRatio != null) mesg.verticalRatio = r.verticalRatio;
  if (r.power != null) mesg.power = r.power;
  return mesg;
}

/**
 * Export a ParsedActivity as a valid FIT file.
 *
 * If rawFitMessages is available (from the original FIT file), re-encodes
 * those exact messages — preserving device info, events, sport, etc.
 * Records are replaced with the current activity records (including
 * any synthetic extension data).
 *
 * If rawFitMessages is not available, builds a minimal FIT file from
 * the activity data.
 */
export function exportActivityToFit(activity: ParsedActivity): Uint8Array {
  const encoder = new Encoder();
  const raw = activity.rawFitMessages;

  if (raw) {
    return exportWithRawMessages(encoder, activity, raw);
  }
  return exportMinimal(encoder, activity);
}

/**
 * The Garmin FIT SDK Encoder has a subtle ordering bug: its MesgDefinition
 * .equals() matches by set-of-fields, but data is written in the JS object's
 * key-iteration order. If two messages of the same type have the same fields
 * in a different insertion order, the encoder reuses the first message's
 * definition — and the second message's bytes land in the wrong fields on
 * decode (e.g., totalDistance decodes as totalCycles, wildly wrong values).
 * Normalizing key order before handing messages to the encoder avoids it.
 */
function normalizeKeyOrder(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(m).sort()) out[k] = m[k];
  return out;
}

function exportWithRawMessages(
  encoder: Encoder,
  activity: ParsedActivity,
  raw: Record<string, unknown[]>
): Uint8Array {
  // Write non-record messages from the original file
  const writeMesgs = (key: string, mesgNum: number) => {
    for (const m of raw[key] ?? []) {
      encoder.writeMesg({ mesgNum, ...normalizeKeyOrder(m as Record<string, unknown>) });
    }
  };

  writeMesgs("fileIdMesgs", MESG.fileId);
  writeMesgs("fileCreatorMesgs", MESG.fileCreator);
  writeMesgs("deviceInfoMesgs", MESG.deviceInfo);

  // Events: when the activity is extended, the trailing timer-stop event
  // from the original FIT points at the old end time. Strict external
  // parsers use that as the end-of-activity marker and ignore everything
  // after — the extension becomes invisible. Drop trailing stop events and
  // write a fresh one at the extended end.
  const events = [...((raw.eventMesgs ?? []) as Record<string, unknown>[])];
  if (activity.extended) {
    while (events.length > 0) {
      const last = events[events.length - 1];
      const isStop =
        (last.event === "timer" || last.event === "session") &&
        (last.eventType === "stop" ||
          last.eventType === "stopAll" ||
          last.eventType === "stopDisableAll");
      if (isStop) events.pop();
      else break;
    }
  }
  for (const m of events) {
    // Write event fields in a consistent order; the Garmin SDK encoder
    // garbles eventType when `data` is listed before it in the object.
    encoder.writeMesg({
      mesgNum: MESG.event,
      timestamp: m.timestamp,
      event: m.event,
      eventType: m.eventType,
      eventGroup: m.eventGroup,
      timerTrigger: m.timerTrigger,
      data: m.data,
    });
  }

  writeMesgs("sportMesgs", MESG.sport);

  // Write ALL records (original + synthetic) from our RecordPoint array
  for (const r of activity.records) {
    encoder.writeMesg({ mesgNum: MESG.record, ...recordToFitMesg(r) });
  }

  // Fresh end-of-activity stop event at the extended end time, replacing
  // the original trailing stop we filtered above.
  if (activity.extended && activity.records.length > 0) {
    const lastRec = activity.records[activity.records.length - 1];
    encoder.writeMesg({
      mesgNum: MESG.event,
      timestamp: toDate(lastRec.timestamp),
      event: "timer",
      eventType: "stopAll",
    });
  }

  const origLapCount = activity.originalLapCount ?? raw.lapMesgs?.length ?? activity.laps.length;
  let numLaps = activity.laps.length;

  // Write laps — use raw if not extended, otherwise rebuild
  if (activity.extended && raw.lapMesgs) {
    const hasAbsorbedPartial = !!activity.replacedPartialLap;

    // Untouched originals: every original lap except the absorbed partial.
    const untouchedCount = hasAbsorbedPartial
      ? raw.lapMesgs.length - 1
      : raw.lapMesgs.length;
    for (let i = 0; i < untouchedCount; i++) {
      encoder.writeMesg({
        mesgNum: MESG.lap,
        ...normalizeKeyOrder(raw.lapMesgs[i] as Record<string, unknown>),
      });
    }

    const extRecords = activity.records.slice(activity.originalRecordCount ?? 0);
    if (extRecords.length > 0) {
      const sampleLap = raw.lapMesgs[raw.lapMesgs.length - 1] as Record<string, unknown> | undefined;
      // Detect auto-lap from the original laps (minus absorbed partial) so
      // the pattern isn't diluted.
      const origLaps = activity.laps.slice(0, origLapCount);
      const autoLapDist = detectAutoLapDistance(origLaps);

      let chunks: RecordPoint[][];
      if (autoLapDist && activity.replacedPartialLap) {
        const remainder = autoLapDist - activity.replacedPartialLap.totalDistance;
        chunks = splitRecordsWithFirstOffset(extRecords, autoLapDist, remainder);
      } else if (autoLapDist) {
        chunks = splitRecordsByDistance(extRecords, autoLapDist);
      } else {
        chunks = [extRecords];
      }

      // Records that belonged to the absorbed partial lap — merged into the
      // first extension lap message so the exported FIT matches the in-app
      // lap table (a full auto-lap), not a stub 0.37 km lap followed by a
      // strangely-sized extension lap.
      const partialRealRecords = activity.replacedPartialLap
        ? recordsInLap(activity, activity.replacedPartialLap)
        : [];

      let idx = origLapCount;
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        if (chunk.length < 2) continue;
        const recordsForLap =
          ci === 0 && partialRealRecords.length > 0
            ? [...partialRealRecords, ...chunk]
            : chunk;
        encoder.writeMesg({
          mesgNum: MESG.lap,
          ...normalizeKeyOrder(
            buildExtensionLapMesg(recordsForLap, activity, idx, sampleLap, autoLapDist != null),
          ),
        });
        idx++;
      }
      numLaps = idx;
    }
  } else {
    writeMesgs("lapMesgs", MESG.lap);
  }

  // Update session with full activity stats
  if (raw.sessionMesgs?.length) {
    const session = { ...(raw.sessionMesgs[0] as Record<string, unknown>) };
    if (activity.extended) {
      updateSessionFromRecords(session, activity.records, numLaps);
    }
    encoder.writeMesg({ mesgNum: MESG.session, ...normalizeKeyOrder(session) });
  }

  // Update activity timestamp
  if (raw.activityMesgs?.length) {
    const act = { ...(raw.activityMesgs[0] as Record<string, unknown>) };
    const lastRec = activity.records[activity.records.length - 1];
    if (lastRec) {
      act.timestamp = toDate(lastRec.timestamp);
      act.totalTimerTime = lastRec.elapsed;
    }
    encoder.writeMesg({ mesgNum: MESG.activity, ...normalizeKeyOrder(act) });
  }

  return encoder.close();
}

function exportMinimal(encoder: Encoder, activity: ParsedActivity): Uint8Array {
  // Minimal FIT file when no raw messages available
  const now = new Date();
  const startDate = activity.summary.startTime ? toDate(activity.summary.startTime) : now;
  encoder.writeMesg({
    mesgNum: MESG.fileId,
    type: "activity",
    manufacturer: "development",
    timeCreated: startDate,
  });

  // Start event
  encoder.writeMesg({
    mesgNum: MESG.event,
    timestamp: startDate,
    event: "timer",
    eventType: "start",
  });

  // Records
  for (const r of activity.records) {
    encoder.writeMesg({ mesgNum: MESG.record, ...recordToFitMesg(r) });
  }

  // Stop event
  const lastRec = activity.records[activity.records.length - 1];
  const lastDate = lastRec ? toDate(lastRec.timestamp) : now;
  if (lastRec) {
    encoder.writeMesg({
      mesgNum: MESG.event,
      timestamp: lastDate,
      event: "timer",
      eventType: "stopAll",
    });
  }

  // Session
  const s = activity.summary;
  encoder.writeMesg({
    mesgNum: MESG.session,
    timestamp: lastDate,
    startTime: startDate,
    totalElapsedTime: s.totalElapsedTime,
    totalTimerTime: s.totalElapsedTime,
    totalDistance: s.totalDistance,
    sport: s.sport ?? "running",
    subSport: "generic",
    avgHeartRate: s.avgHeartRate ? Math.round(s.avgHeartRate) : undefined,
    avgSpeed: s.avgSpeed,
    avgCadence: s.avgCadence ? Math.round(s.avgCadence / 2) : undefined,
    avgPower: s.avgPower ? Math.round(s.avgPower) : undefined,
    firstLapIndex: 0,
    numLaps: 1,
    trigger: "activityEnd",
    eventType: "stop",
  });

  // Activity
  encoder.writeMesg({
    mesgNum: MESG.activity,
    timestamp: lastDate,
    numSessions: 1,
    type: "manual",
    event: "activity",
    eventType: "stop",
    totalTimerTime: s.totalElapsedTime,
  });

  return encoder.close();
}

function buildExtensionLapMesg(
  extRecords: RecordPoint[],
  activity: ParsedActivity,
  lapIndex: number,
  sampleLap: Record<string, unknown> | undefined,
  isAutoLap: boolean,
): Record<string, unknown> {
  const first = extRecords[0];
  const last = extRecords[extRecords.length - 1];
  const dist = last.distance - first.distance;
  const time = last.elapsed - first.elapsed;

  const avg = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  const max = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? Math.max(...v) : undefined;
  };

  // Elevation gain/loss from altitude deltas
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < extRecords.length; i++) {
    const prev = extRecords[i - 1].altitude;
    const cur = extRecords[i].altitude;
    if (prev != null && cur != null) {
      const d = cur - prev;
      if (d > 0) ascent += d;
      else descent -= d;
    }
  }

  const avgSpeed = time > 0 ? dist / time : 0;
  const avgCadenceHalf = avg(
    extRecords.map((r) => (r.cadence != null ? r.cadence / 2 : undefined)),
  );
  const maxCadenceHalf = max(
    extRecords.map((r) => (r.cadence != null ? r.cadence / 2 : undefined)),
  );
  const { cadInt: avgCadInt, cadFrac: avgCadFrac } = splitCadence(avgCadenceHalf);
  const { cadInt: maxCadInt, cadFrac: maxCadFrac } = splitCadence(maxCadenceHalf);

  // Total cycles must match totalCycles ≈ avgCadenceHalf * timerTime / 60, or
  // else Apple Health/Strava derive cadence from totalCycles/time and get a
  // value that's off by the ratio (original sample lap's cycles over our
  // extension's duration, which can be ~3x off).
  const { cycles, fractionalCycles } = integrateCycles(extRecords);

  const mesg: Record<string, unknown> = {
    // Preserve extra fields (e.g., left/right balance, intensity factor) from a
    // sibling lap so downstream tools don't see gaps the watch would fill in.
    ...(sampleLap ?? {}),
    timestamp: toDate(last.timestamp),
    startTime: toDate(first.timestamp),
    event: "lap",
    eventType: "stop",
    lapTrigger: isAutoLap ? "distance" : "manual",
    sport: activity.summary.sport ?? "running",
    subSport: (sampleLap?.subSport as string) ?? "generic",
    totalElapsedTime: time,
    totalTimerTime: time,
    totalDistance: dist,
    avgSpeed,
    enhancedAvgSpeed: avgSpeed,
    maxSpeed: max(extRecords.map((r) => r.speed)),
    enhancedMaxSpeed: max(extRecords.map((r) => r.speed)),
    avgHeartRate: round(avg(extRecords.map((r) => r.heartRate))),
    maxHeartRate: max(extRecords.map((r) => r.heartRate)),
    minHeartRate: min(extRecords.map((r) => r.heartRate)),
    avgCadence: avgCadInt,
    avgFractionalCadence: avgCadFrac,
    maxCadence: maxCadInt,
    maxFractionalCadence: maxCadFrac,
    totalCycles: cycles,
    totalFractionalCycles: fractionalCycles,
    avgPower: round(avg(extRecords.map((r) => r.power))),
    maxPower: round(max(extRecords.map((r) => r.power))),
    avgVerticalOscillation: avg(extRecords.map((r) => r.verticalOscillation)),
    avgStanceTime: avg(extRecords.map((r) => r.groundContactTime)),
    avgStanceTimeBalance: avg(extRecords.map((r) => r.groundContactTimeBalance)),
    avgStepLength: avg(extRecords.map((r) => r.strideLength)),
    avgVerticalRatio: avg(extRecords.map((r) => r.verticalRatio)),
    totalAscent: Math.round(ascent),
    totalDescent: Math.round(descent),
    totalCalories: estimateCalories(time, avgSpeed),
    intensity: "active",
    messageIndex: lapIndex,
  };

  if (first.lat != null && first.lng != null) {
    mesg.startPositionLat = Math.round(first.lat * SEMICIRCLE);
    mesg.startPositionLong = Math.round(first.lng * SEMICIRCLE);
  }
  if (last.lat != null && last.lng != null) {
    mesg.endPositionLat = Math.round(last.lat * SEMICIRCLE);
    mesg.endPositionLong = Math.round(last.lng * SEMICIRCLE);
  }

  // Strip values that wouldn't apply to the synthetic extension
  delete mesg.totalTrainingEffect;
  delete mesg.totalAnaerobicTrainingEffect;
  delete mesg.trainingStressScore;

  return mesg;
}

function min(vals: (number | undefined)[]): number | undefined {
  const v = vals.filter((x): x is number => x != null);
  return v.length > 0 ? Math.min(...v) : undefined;
}

/** Split a half-cadence value (rpm) into integer + fractional parts matching
 * the FIT profile's avgCadence (uint8 rpm) and avgFractionalCadence
 * (scale 128, 0..<1). Using floor preserves round-trip precision; Math.round
 * can push the integer up while leaving a 0.5 fractional, inflating cadence
 * by a full rpm (= 2 spm) on decode. */
function splitCadence(half: number | undefined): { cadInt?: number; cadFrac?: number } {
  if (half == null || !isFinite(half)) return {};
  const cadInt = Math.floor(half);
  const cadFrac = half - cadInt;
  return { cadInt, cadFrac };
}

/** Integrate instantaneous cadence over record intervals to get total cycles
 * (= total strides for running). Without this, an extension lap that
 * inherits totalCycles from a sibling lap renders cadence as
 * sibling_cycles / ext_time — wildly wrong in Apple Health and Strava. */
function integrateCycles(records: RecordPoint[]): { cycles?: number; fractionalCycles?: number } {
  if (records.length < 2) return {};
  let totalHalfCycles = 0; // rpm-seconds accumulated
  let sawCadence = false;
  for (let i = 1; i < records.length; i++) {
    const c = records[i].cadence;
    if (c == null) continue;
    sawCadence = true;
    const dt =
      (new Date(records[i].timestamp).getTime() -
        new Date(records[i - 1].timestamp).getTime()) /
      1000;
    if (dt <= 0 || dt > 60) continue;
    // cadence is spm; cycles per second = cadence/2/60
    totalHalfCycles += (c / 2 / 60) * dt;
  }
  if (!sawCadence) return {};
  const cycles = Math.floor(totalHalfCycles);
  const fractionalCycles = totalHalfCycles - cycles;
  return { cycles, fractionalCycles };
}

function round(n: number | undefined): number | undefined {
  return n != null ? Math.round(n) : undefined;
}

/**
 * Return the original records that fall within a lap's timestamp range.
 * Used to pull the real records of a partial lap that was absorbed by the
 * extension so they can be merged with synth records when building the
 * exported FIT lap message.
 */
function recordsInLap(
  activity: ParsedActivity,
  lap: { startTime: string; totalElapsedTime: number },
): RecordPoint[] {
  const startMs = toDate(lap.startTime).getTime();
  const endMs = startMs + lap.totalElapsedTime * 1000;
  const origRecCount = activity.originalRecordCount ?? activity.records.length;
  return activity.records.slice(0, origRecCount).filter((r) => {
    const ts = toDate(r.timestamp).getTime();
    return ts >= startMs && ts <= endMs + 500;
  });
}

/** Rough running calorie estimate: ~1 kcal per kg per km. Assumes 70kg — good
 * enough to avoid leaving the field blank in the extension lap. */
function estimateCalories(timeSeconds: number, speedMps: number): number {
  const km = (speedMps * timeSeconds) / 1000;
  return Math.round(km * 70);
}

function updateSessionFromRecords(
  session: Record<string, unknown>,
  records: RecordPoint[],
  numLaps: number,
) {
  if (records.length === 0) return;
  const last = records[records.length - 1];
  session.timestamp = toDate(last.timestamp);
  session.totalDistance = last.distance;
  session.totalElapsedTime = last.elapsed;
  session.totalTimerTime = last.elapsed;
  session.numLaps = numLaps;

  const avg = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  const max = (vals: (number | undefined)[]): number | undefined => {
    const v = vals.filter((x): x is number => x != null);
    return v.length > 0 ? Math.max(...v) : undefined;
  };

  const avgHR = avg(records.map((r) => r.heartRate));
  if (avgHR) session.avgHeartRate = Math.round(avgHR);
  const maxHR = max(records.map((r) => r.heartRate));
  if (maxHR) session.maxHeartRate = Math.round(maxHR);
  const minHR = (() => {
    const v = records.map((r) => r.heartRate).filter((x): x is number => x != null);
    return v.length > 0 ? Math.min(...v) : undefined;
  })();
  if (minHR) session.minHeartRate = Math.round(minHR);

  const avgSpeed = avg(records.map((r) => r.speed));
  if (avgSpeed) {
    session.avgSpeed = avgSpeed;
    session.enhancedAvgSpeed = avgSpeed;
  }
  const maxSpeed = max(records.map((r) => r.speed));
  if (maxSpeed) {
    session.maxSpeed = maxSpeed;
    session.enhancedMaxSpeed = maxSpeed;
  }

  const avgCadenceHalf = avg(
    records.map((r) => (r.cadence != null ? r.cadence / 2 : undefined)),
  );
  if (avgCadenceHalf != null) {
    session.avgCadence = Math.floor(avgCadenceHalf);
    session.avgFractionalCadence = avgCadenceHalf - Math.floor(avgCadenceHalf);
  }
  const maxCadenceHalf = max(
    records.map((r) => (r.cadence != null ? r.cadence / 2 : undefined)),
  );
  if (maxCadenceHalf != null) {
    session.maxCadence = Math.floor(maxCadenceHalf);
    session.maxFractionalCadence = maxCadenceHalf - Math.floor(maxCadenceHalf);
  }

  // Keep totalCycles consistent with avgCadence * totalTimerTime or Apple
  // Health / Strava derive a wildly wrong activity-wide cadence from the
  // stale value.
  const { cycles, fractionalCycles } = integrateCycles(records);
  if (cycles != null) {
    session.totalCycles = cycles;
    session.totalFractionalCycles = fractionalCycles;
  }

  const avgPower = avg(records.map((r) => r.power));
  if (avgPower != null) session.avgPower = Math.round(avgPower);
  const maxPower = max(records.map((r) => r.power));
  if (maxPower != null) session.maxPower = Math.round(maxPower);

  const avgVO = avg(records.map((r) => r.verticalOscillation));
  if (avgVO != null) session.avgVerticalOscillation = avgVO;
  const avgGCT = avg(records.map((r) => r.groundContactTime));
  if (avgGCT != null) session.avgStanceTime = avgGCT;
  const avgGCTB = avg(records.map((r) => r.groundContactTimeBalance));
  if (avgGCTB != null) session.avgStanceTimeBalance = avgGCTB;
  const avgStep = avg(records.map((r) => r.strideLength));
  if (avgStep != null) session.avgStepLength = avgStep;
  const avgVR = avg(records.map((r) => r.verticalRatio));
  if (avgVR != null) session.avgVerticalRatio = avgVR;

  // Re-aggregate elevation for the full activity
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1].altitude;
    const cur = records[i].altitude;
    if (prev != null && cur != null) {
      const d = cur - prev;
      if (d > 0) ascent += d;
      else descent -= d;
    }
  }
  session.totalAscent = Math.round(ascent);
  session.totalDescent = Math.round(descent);

  // Recompute the bounding box so Strava and map viewers include extension
  // points — the original session's nec/swc cover only the original track.
  let necLat: number | undefined;
  let necLng: number | undefined;
  let swcLat: number | undefined;
  let swcLng: number | undefined;
  for (const r of records) {
    if (r.lat == null || r.lng == null) continue;
    if (necLat == null || r.lat > necLat) necLat = r.lat;
    if (swcLat == null || r.lat < swcLat) swcLat = r.lat;
    if (necLng == null || r.lng > necLng) necLng = r.lng;
    if (swcLng == null || r.lng < swcLng) swcLng = r.lng;
  }
  if (necLat != null && necLng != null && swcLat != null && swcLng != null) {
    session.necLat = Math.round(necLat * SEMICIRCLE);
    session.necLong = Math.round(necLng * SEMICIRCLE);
    session.swcLat = Math.round(swcLat * SEMICIRCLE);
    session.swcLong = Math.round(swcLng * SEMICIRCLE);
  }
}

/**
 * Trigger a file download in the browser.
 */
export function downloadFitFile(data: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.replace(/\.fit$/i, "") + ".fit";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

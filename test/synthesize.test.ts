import { describe, it, expect } from "vitest";
import {
  haversineDistance,
  interpolateAlongPolyline,
  analyzeRecentTrend,
  synthesizeRecords,
  buildExtensionLaps,
} from "../src/synthesizeExtension";
import type { LapSummary, RecordPoint } from "../src/types";

function makeRecords(count: number, startLat = 51.11, startLng = 17.05): RecordPoint[] {
  const records: RecordPoint[] = [];
  const baseTime = new Date("2026-04-01T10:00:00Z");
  for (let i = 0; i < count; i++) {
    records.push({
      timestamp: new Date(baseTime.getTime() + i * 1000).toISOString(),
      elapsed: i,
      distance: i * 3, // ~3m/s = 5:33/km
      altitude: 120 + Math.sin(i / 50) * 2,
      lat: startLat + i * 0.00001,
      lng: startLng + i * 0.000015,
      heartRate: 130 + i * 0.05, // slow climb
      cadence: 170 + Math.random() * 4,
      speed: 3 + Math.random() * 0.2,
      verticalOscillation: 90,
      groundContactTime: 250,
      strideLength: 1100,
      verticalRatio: 8,
      power: 240,
      lapIndex: 1,
    });
  }
  return records;
}

describe("haversineDistance", () => {
  it("returns ~111km for 1 degree latitude", () => {
    const d = haversineDistance(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  it("returns 0 for same point", () => {
    expect(haversineDistance(51.11, 17.05, 51.11, 17.05)).toBe(0);
  });
});

describe("interpolateAlongPolyline", () => {
  it("produces evenly spaced points along a straight line", () => {
    const waypoints: [number, number][] = [
      [51.11, 17.05],
      [51.12, 17.05], // ~1.11km north
    ];
    const points = interpolateAlongPolyline(waypoints, 100); // every 100m
    expect(points.length).toBeGreaterThan(10);
    expect(points.length).toBeLessThanOrEqual(13);
    // All points should have same longitude
    for (const [, lng] of points) {
      expect(lng).toBeCloseTo(17.05, 4);
    }
  });

  it("handles L-shaped route", () => {
    const waypoints: [number, number][] = [
      [51.11, 17.05],
      [51.11, 17.06], // east
      [51.12, 17.06], // north
    ];
    const points = interpolateAlongPolyline(waypoints, 100);
    expect(points.length).toBeGreaterThan(15);
  });

  it("returns at least start and end points", () => {
    const waypoints: [number, number][] = [
      [51.11, 17.05],
      [51.1101, 17.05], // very short
    ];
    const points = interpolateAlongPolyline(waypoints, 100);
    expect(points.length).toBeGreaterThanOrEqual(2);
  });
});

describe("analyzeRecentTrend", () => {
  it("detects positive HR slope from climbing HR", () => {
    const records = makeRecords(120);
    const trend = analyzeRecentTrend(records);
    expect(trend.hrSlope).toBeGreaterThan(0);
    expect(trend.avgSpeed).toBeGreaterThan(2.5);
    expect(trend.recordInterval).toBeCloseTo(1, 0.5);
  });

  it("returns averages for dynamics", () => {
    const records = makeRecords(120);
    const trend = analyzeRecentTrend(records);
    expect(trend.avgCadence).toBeGreaterThan(160);
    expect(trend.avgVO).toBeCloseTo(90, 5);
    expect(trend.avgGCT).toBeCloseTo(250, 20);
  });
});

describe("synthesizeRecords", () => {
  it("generates records continuing from real data", () => {
    const existing = makeRecords(300);
    const lastReal = existing[existing.length - 1];
    const waypoints: [number, number][] = [
      [lastReal.lat! + 0.001, lastReal.lng!],
      [lastReal.lat! + 0.005, lastReal.lng!], // ~450m north
    ];

    const synthetic = synthesizeRecords({
      existingRecords: existing,
      waypoints,
      totalFinishTimeSeconds: 450, // 150s more than 300s existing
    });

    expect(synthetic.length).toBeGreaterThan(100);

    // Timestamps monotonically increasing
    for (let i = 1; i < synthetic.length; i++) {
      expect(new Date(synthetic[i].timestamp).getTime())
        .toBeGreaterThan(new Date(synthetic[i - 1].timestamp).getTime());
    }

    // Distance monotonically increasing
    for (let i = 1; i < synthetic.length; i++) {
      expect(synthetic[i].distance).toBeGreaterThanOrEqual(synthetic[i - 1].distance);
    }

    // First synthetic continues from last real
    expect(synthetic[0].distance).toBeGreaterThan(lastReal.distance);
    expect(new Date(synthetic[0].timestamp).getTime())
      .toBeGreaterThan(new Date(lastReal.timestamp).getTime());

    // All records have required fields
    for (const r of synthetic) {
      expect(r.lat).toBeDefined();
      expect(r.lng).toBeDefined();
      expect(r.speed).toBeGreaterThan(0);
      expect(r.elapsed).toBeGreaterThan(0);
    }

    // HR should be within reasonable bounds
    for (const r of synthetic) {
      if (r.heartRate != null) {
        expect(r.heartRate).toBeGreaterThan(100);
        expect(r.heartRate).toBeLessThan(210);
      }
    }
  });

  it("synthetic cadence variability is in the same ballpark as source", () => {
    // Source has cadence ~170-174 (mean 172, std ~1.15).
    const existing = makeRecords(600);
    const lastReal = existing[existing.length - 1];
    const waypoints: [number, number][] = [
      [lastReal.lat! + 0.001, lastReal.lng!],
      [lastReal.lat! + 0.02, lastReal.lng!],
    ];

    const synthetic = synthesizeRecords({
      existingRecords: existing,
      waypoints,
      totalFinishTimeSeconds: lastReal.elapsed + 900,
    });

    const cadences = synthetic
      .map((r) => r.cadence)
      .filter((c): c is number => c != null);
    expect(cadences.length).toBeGreaterThan(50);

    const mean = cadences.reduce((s, x) => s + x, 0) / cadences.length;
    const std = Math.sqrt(
      cadences.reduce((s, x) => s + (x - mean) ** 2, 0) / cadences.length,
    );

    // Mean should stay within the source's operating range
    expect(mean).toBeGreaterThan(168);
    expect(mean).toBeLessThan(176);
    // And we should see real variability — not a locked-in flat line
    expect(std).toBeGreaterThan(0.3);
  });

  it("uses actual per-metric std so synthetic VO varies with source", () => {
    // Build two sources: one with tight VO variance, one wide.
    const mkSource = (voJitter: number): RecordPoint[] => {
      const base = new Date("2026-04-01T10:00:00Z").getTime();
      const recs: RecordPoint[] = [];
      for (let i = 0; i < 600; i++) {
        recs.push({
          timestamp: new Date(base + i * 1000).toISOString(),
          elapsed: i,
          distance: i * 3,
          altitude: 100,
          lat: 51 + i * 1e-5,
          lng: 17,
          heartRate: 150,
          cadence: 172,
          speed: 3,
          verticalOscillation: 90 + (Math.random() - 0.5) * voJitter,
          groundContactTime: 250,
          strideLength: 1100,
          verticalRatio: 8,
          power: 240,
          lapIndex: 1,
        });
      }
      return recs;
    };

    const tight = synthesizeRecords({
      existingRecords: mkSource(0.5),
      waypoints: [[51.01, 17], [51.03, 17]],
      totalFinishTimeSeconds: 600 + 600,
    });
    const wide = synthesizeRecords({
      existingRecords: mkSource(15),
      waypoints: [[51.01, 17], [51.03, 17]],
      totalFinishTimeSeconds: 600 + 600,
    });

    const voStd = (recs: RecordPoint[]) => {
      const v = recs.map((r) => r.verticalOscillation!).filter((x) => x != null);
      const m = v.reduce((s, x) => s + x, 0) / v.length;
      return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
    };

    expect(voStd(wide)).toBeGreaterThan(voStd(tight) * 2);
  });

  it("extension cumulative distance matches the waypoint route", () => {
    const existing = makeRecords(300);
    const lastReal = existing[existing.length - 1];
    const waypoints: [number, number][] = [
      [lastReal.lat! + 0.001, lastReal.lng!],
      [lastReal.lat! + 0.01, lastReal.lng!],
    ];
    const synthetic = synthesizeRecords({
      existingRecords: existing,
      waypoints,
      totalFinishTimeSeconds: lastReal.elapsed + 300,
    });

    const lastSyn = synthetic[synthetic.length - 1];
    const extDist = lastSyn.distance - lastReal.distance;
    // Expect to cover roughly the route distance (~1.11km). Tolerance for
    // great-circle rounding.
    expect(extDist).toBeGreaterThan(900);
    expect(extDist).toBeLessThan(1400);
  });

  it("dynamics match typical-pace laps, not the slowdown before watch died", () => {
    // Simulate an activity where the runner was at a steady race pace for
    // most of the run, then slowed and fumbled with the watch for the last
    // few minutes before it died (lower cadence, higher VO, lower power).
    // The extension is supposed to continue the run at race pace, so its
    // dynamics should look like the main body of the run — not the final
    // minutes.
    const base = new Date("2026-04-01T10:00:00Z").getTime();
    const records: RecordPoint[] = [];
    const RACE_CADENCE = 172;
    const RACE_VO = 90;
    const RACE_POWER = 240;
    const RACE_SPEED = 3.5;
    let dist = 0;
    for (let i = 0; i < 1500; i++) {
      const slowing = i >= 1200; // last 5 min: slowdown + fumbling with watch
      const speed = slowing ? 2.6 : RACE_SPEED;
      const cadence = slowing ? 158 + Math.random() * 2 : RACE_CADENCE + Math.random() * 2;
      const vo = slowing ? 96 + Math.random() : RACE_VO + (Math.random() - 0.5) * 1;
      const power = slowing ? 195 + Math.random() * 5 : RACE_POWER + (Math.random() - 0.5) * 10;
      dist += speed;
      records.push({
        timestamp: new Date(base + i * 1000).toISOString(),
        elapsed: i,
        distance: dist,
        altitude: 100,
        lat: 51 + i * 1e-5,
        lng: 17,
        heartRate: 150,
        cadence,
        speed,
        verticalOscillation: vo,
        groundContactTime: 250,
        strideLength: 1200,
        verticalRatio: 8,
        power,
        lapIndex: 1,
      });
    }
    const lastReal = records[records.length - 1];

    // Target extension: 10 minutes at race pace (~2.1 km) → ~3.5 m/s target.
    const extDist = RACE_SPEED * 600;
    const latDelta = extDist / 111_000;
    const synthetic = synthesizeRecords({
      existingRecords: records,
      waypoints: [
        [lastReal.lat!, lastReal.lng!],
        [lastReal.lat! + latDelta, lastReal.lng!],
      ],
      totalFinishTimeSeconds: lastReal.elapsed + 600,
    });

    const meanOf = (
      vals: (number | undefined)[],
    ): number => {
      const v = vals.filter((x): x is number => x != null);
      return v.reduce((s, x) => s + x, 0) / v.length;
    };

    const cadenceMean = meanOf(synthetic.map((r) => r.cadence));
    const voMean = meanOf(synthetic.map((r) => r.verticalOscillation));
    const powerMean = meanOf(synthetic.map((r) => r.power));

    // Should be close to the RACE values (body of run), not the SLOWING
    // values from the final minutes.
    expect(cadenceMean).toBeGreaterThan(168); // race ~172, slow ~159
    expect(voMean).toBeLessThan(93); // race ~90, slow ~96.5
    expect(powerMean).toBeGreaterThan(225); // race ~240, slow ~197
  });

  it("synth step-to-step jumps match source smoothness, not white noise", () => {
    // Real running dynamics are heavily autocorrelated at 1Hz — stride /
    // vertical ratio / power change by small amounts between adjacent
    // samples, not by the full stationary std. A fixed low AR(1) alpha
    // (~0.88) ignored that and produced an extension whose record-to-record
    // jumps were several times larger than the source — visible as a noisy
    // tail next to a smooth start on the time-series dynamics charts.
    //
    // Build a source with tight second-to-second smoothness (AR(1) with high
    // alpha) and assert the synth doesn't blow past that jump size.
    const base = new Date("2026-04-01T10:00:00Z").getTime();
    const records: RecordPoint[] = [];
    // Ornstein–Uhlenbeck-style smooth process for stride, power, VR so lag-1
    // correlation is ~0.99 like real sensor data.
    const smooth = (mean: number, drift: number) => {
      let v = mean;
      return () => {
        v = 0.99 * v + 0.01 * mean + (Math.random() - 0.5) * drift;
        return v;
      };
    };
    const strideGen = smooth(1200, 4);
    const powerGen = smooth(240, 4);
    const vrGen = smooth(8, 0.1);
    let dist = 0;
    for (let i = 0; i < 1800; i++) {
      dist += 3.5;
      records.push({
        timestamp: new Date(base + i * 1000).toISOString(),
        elapsed: i,
        distance: dist,
        altitude: 100,
        lat: 51 + i * 1e-5,
        lng: 17,
        heartRate: 150,
        cadence: 172,
        speed: 3.5,
        verticalOscillation: 90,
        groundContactTime: 250,
        strideLength: strideGen(),
        verticalRatio: vrGen(),
        power: powerGen(),
        lapIndex: 1,
      });
    }
    const lastReal = records[records.length - 1];

    const synthetic = synthesizeRecords({
      existingRecords: records,
      waypoints: [
        [lastReal.lat!, lastReal.lng!],
        [lastReal.lat! + (3.5 * 600) / 111_000, lastReal.lng!],
      ],
      totalFinishTimeSeconds: lastReal.elapsed + 600,
    });

    const avgJump = (vals: (number | undefined)[]): number => {
      const v = vals.filter((x): x is number => x != null);
      if (v.length < 2) return 0;
      let s = 0;
      for (let i = 1; i < v.length; i++) s += Math.abs(v[i] - v[i - 1]);
      return s / (v.length - 1);
    };

    // Source record-to-record mean absolute jump.
    const srcStride = avgJump(records.map((r) => r.strideLength));
    const srcPower = avgJump(records.map((r) => r.power));
    const srcVR = avgJump(records.map((r) => r.verticalRatio));

    const synStride = avgJump(synthetic.map((r) => r.strideLength));
    const synPower = avgJump(synthetic.map((r) => r.power));
    const synVR = avgJump(synthetic.map((r) => r.verticalRatio));

    // Synth should be within ~3x the source's jump size. Before the alpha
    // fix this ratio was closer to 10x for high-autocorrelation sources.
    expect(synStride).toBeLessThan(srcStride * 3);
    expect(synPower).toBeLessThan(srcPower * 3);
    expect(synVR).toBeLessThan(srcVR * 3);
  });

  it("synthetic HR blends smoothly from last real HR (no jump)", () => {
    const existing = makeRecords(300);
    const lastReal = existing[existing.length - 1];
    const waypoints: [number, number][] = [
      [lastReal.lat! + 0.001, lastReal.lng!],
      [lastReal.lat! + 0.005, lastReal.lng!],
    ];
    const synthetic = synthesizeRecords({
      existingRecords: existing,
      waypoints,
      totalFinishTimeSeconds: lastReal.elapsed + 200,
    });
    const firstSynHR = synthetic[0].heartRate!;
    // First synthetic HR should be within ~8 bpm of the last real HR.
    expect(Math.abs(firstSynHR - lastReal.heartRate!)).toBeLessThan(8);
  });

  it("HR recovers to race-pace mean even when the run ended with a slowdown", () => {
    // Runner ran at HR ~150 (race pace) for most of the run, then slowed
    // in the final minutes and HR dropped to 125. The extension should
    // recover back toward the race-pace HR — not extrapolate the slowdown
    // decline downward for the whole extension.
    const base = new Date("2026-04-01T10:00:00Z").getTime();
    const records: RecordPoint[] = [];
    let dist = 0;
    for (let i = 0; i < 1500; i++) {
      const slowing = i >= 1200;
      const speed = slowing ? 2.5 : 3.5;
      dist += speed;
      records.push({
        timestamp: new Date(base + i * 1000).toISOString(),
        elapsed: i,
        distance: dist,
        altitude: 100,
        lat: 51 + i * 1e-5,
        lng: 17,
        heartRate: slowing ? 125 + Math.random() * 3 : 150 + Math.random() * 4,
        cadence: slowing ? 158 : 172,
        speed,
        verticalOscillation: 90,
        groundContactTime: 250,
        strideLength: 1200,
        verticalRatio: 8,
        power: 240,
        lapIndex: 1,
      });
    }
    const lastReal = records[records.length - 1];
    const extDist = 3.5 * 600;
    const latDelta = extDist / 111_000;
    const synthetic = synthesizeRecords({
      existingRecords: records,
      waypoints: [
        [lastReal.lat!, lastReal.lng!],
        [lastReal.lat! + latDelta, lastReal.lng!],
      ],
      totalFinishTimeSeconds: lastReal.elapsed + 600,
    });

    const firstHR = synthetic[0].heartRate!;
    // Handoff stays smooth — first synth HR is close to the last real HR.
    expect(Math.abs(firstHR - lastReal.heartRate!)).toBeLessThan(10);

    // After ~90 seconds HR should have recovered toward the race-pace mean
    // (~150), not kept dropping toward 100.
    const midPoint = synthetic[Math.floor(synthetic.length * 0.5)].heartRate!;
    expect(midPoint).toBeGreaterThan(140);
    expect(midPoint).toBeLessThan(160);

    // Last-half mean HR should be solidly in race-pace range.
    const second = synthetic.slice(Math.floor(synthetic.length / 2));
    const meanEnd = second
      .map((r) => r.heartRate!)
      .reduce((a, b) => a + b, 0) / second.length;
    expect(meanEnd).toBeGreaterThan(142);
    expect(meanEnd).toBeLessThan(158);
  });
});

function makeLap(
  lapIndex: number,
  startTime: string,
  dist: number,
  time: number,
  cadence = 170,
): LapSummary {
  return {
    lapIndex,
    startTime,
    totalDistance: dist,
    totalElapsedTime: time,
    avgSpeed: dist / time,
    avgPace: "0:00",
    avgCadence: cadence,
    avgHeartRate: 150,
    maxHeartRate: 155,
    avgVerticalOscillation: 90,
    avgGroundContactTime: 250,
    avgStrideLength: 1200,
    avgVerticalRatio: 8,
    avgPower: 240,
  };
}

describe("buildExtensionLaps", () => {
  function makeSynthRecords(
    count: number,
    startDist: number,
    startElapsed: number,
  ): RecordPoint[] {
    const base = new Date("2026-04-01T11:00:00Z").getTime();
    const recs: RecordPoint[] = [];
    for (let i = 0; i < count; i++) {
      recs.push({
        timestamp: new Date(base + i * 1000).toISOString(),
        elapsed: startElapsed + i,
        distance: startDist + i * 3,
        altitude: 100,
        lat: 51,
        lng: 17,
        heartRate: 150,
        cadence: 170,
        speed: 3,
        verticalOscillation: 90,
        groundContactTime: 250,
        strideLength: 1200,
        verticalRatio: 8,
        power: 240,
        lapIndex: 18,
      });
    }
    return recs;
  }

  it("absorbs a partial trailing auto-lap into the first synth chunk", () => {
    // 17 full 1-km auto-laps + 1 partial 0.37km lap (watch died mid-lap).
    const existing: LapSummary[] = [];
    let t = 0;
    for (let i = 1; i <= 17; i++) {
      existing.push(makeLap(i, new Date(t * 1000).toISOString(), 1000, 330));
      t += 330;
    }
    existing.push(makeLap(18, new Date(t * 1000).toISOString(), 370, 124));

    // Synth continues from where the partial lap ends.
    const synth = makeSynthRecords(600, 17370, 5734);

    const { laps, replacesLastExistingLap } = buildExtensionLaps(synth, existing);
    expect(replacesLastExistingLap).toBe(true);
    expect(laps.length).toBeGreaterThan(0);

    // First returned lap is the merged lap — distance should be ~1 km total,
    // keeping the partial lap's lapIndex.
    const merged = laps[0];
    expect(merged.lapIndex).toBe(18);
    expect(merged.totalDistance).toBeGreaterThan(950);
    expect(merged.totalDistance).toBeLessThan(1100);
    // Combined time is partial time + synth portion time.
    expect(merged.totalElapsedTime).toBeGreaterThan(124);
  });

  it("does not absorb when trailing lap is a full auto-lap", () => {
    // All laps are a clean 1 km — no partial at the end.
    const existing: LapSummary[] = [];
    for (let i = 1; i <= 18; i++) {
      existing.push(makeLap(i, new Date(i * 330 * 1000).toISOString(), 1000, 330));
    }
    const synth = makeSynthRecords(600, 18000, 5940);
    const { replacesLastExistingLap } = buildExtensionLaps(synth, existing);
    expect(replacesLastExistingLap).toBe(false);
  });

  it("does not absorb for non-auto-lap activities", () => {
    // Laps of wildly different distances — not auto-lap pattern.
    const existing: LapSummary[] = [
      makeLap(1, "2026-04-01T10:00:00Z", 500, 150),
      makeLap(2, "2026-04-01T10:02:30Z", 2000, 660),
      makeLap(3, "2026-04-01T10:13:30Z", 300, 90),
    ];
    const synth = makeSynthRecords(300, 2800, 900);
    const { replacesLastExistingLap } = buildExtensionLaps(synth, existing);
    expect(replacesLastExistingLap).toBe(false);
  });
});

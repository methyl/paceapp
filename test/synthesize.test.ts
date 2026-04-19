import { describe, it, expect } from "vitest";
import {
  haversineDistance,
  interpolateAlongPolyline,
  analyzeRecentTrend,
  synthesizeRecords,
} from "../src/synthesizeExtension";
import type { RecordPoint } from "../src/types";

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
});

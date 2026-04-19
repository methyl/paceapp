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
});

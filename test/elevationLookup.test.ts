import { describe, it, expect } from "vitest";
import { _internal } from "../frontend/elevationLookup";

const { downsample, expandToFullLength } = _internal;

describe("downsample", () => {
  it("returns input unchanged when at or below the cap", () => {
    const coords: [number, number][] = [
      [0, 0], [1, 1], [2, 2],
    ];
    const { sampleCoords, sampleIndices } = downsample(coords, 100);
    expect(sampleCoords).toBe(coords);
    expect(sampleIndices).toEqual([0, 1, 2]);
  });

  it("picks evenly spaced points including first and last", () => {
    const coords: [number, number][] = Array.from(
      { length: 1000 },
      (_, i) => [i, i] as [number, number],
    );
    const { sampleCoords, sampleIndices } = downsample(coords, 50);
    expect(sampleCoords.length).toBe(50);
    expect(sampleIndices.length).toBe(50);
    expect(sampleIndices[0]).toBe(0);
    expect(sampleIndices[49]).toBe(999);
    // Roughly uniform spacing — no two consecutive samples more than the
    // average spacing apart from the mean.
    const gaps = sampleIndices.slice(1).map((v, i) => v - sampleIndices[i]);
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    for (const g of gaps) {
      expect(Math.abs(g - meanGap)).toBeLessThan(2);
    }
  });
});

describe("expandToFullLength", () => {
  it("linearly interpolates a 50→1000 elevation profile", () => {
    // Source: 1000 coords with a clean linear elevation gradient.
    const totalLength = 1000;
    const sampleIndices: number[] = [];
    const sampleValues: number[] = [];
    for (let i = 0; i < 50; i++) {
      const idx = Math.round((i * (totalLength - 1)) / 49);
      sampleIndices.push(idx);
      sampleValues.push(idx); // y = x so we can check linear interpolation
    }

    const expanded = expandToFullLength(sampleValues, sampleIndices, totalLength);
    expect(expanded.length).toBe(totalLength);
    // Each interpolated point should be within ~1m of the true linear value.
    for (let i = 0; i < totalLength; i++) {
      expect(Math.abs(expanded[i] - i)).toBeLessThan(1);
    }
  });

  it("clamps to endpoints outside the sampled range", () => {
    const expanded = expandToFullLength([10, 20], [0, 9], 10);
    expect(expanded[0]).toBeCloseTo(10, 5);
    expect(expanded[9]).toBeCloseTo(20, 5);
    // Linear midpoint
    expect(expanded[5]).toBeCloseTo(15.55, 1);
  });
});

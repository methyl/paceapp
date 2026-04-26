import { describe, it, expect } from "vitest";
import {
  speedFromDistanceTime,
  speedToPace,
  paceFromDistanceTime,
  secPerKmFromSpeed,
  paceSecToStr,
  parsePaceToSec,
  formatTime,
} from "../shared/pace";

describe("speedFromDistanceTime", () => {
  it("returns distance / time", () => {
    expect(speedFromDistanceTime(1000, 360)).toBeCloseTo(1000 / 360, 9);
  });

  it("returns 0 on zero/negative time", () => {
    expect(speedFromDistanceTime(1000, 0)).toBe(0);
    expect(speedFromDistanceTime(1000, -1)).toBe(0);
  });

  it("returns 0 on non-finite input", () => {
    expect(speedFromDistanceTime(Infinity, 1)).toBe(0);
    expect(speedFromDistanceTime(1000, NaN)).toBe(0);
  });
});

describe("speedToPace", () => {
  it("formats m/s as M:SS per km", () => {
    expect(speedToPace(1000 / 300)).toBe("5:00");
    expect(speedToPace(1000 / 270)).toBe("4:30");
  });

  it("returns '-' for zero/invalid speed", () => {
    expect(speedToPace(0)).toBe("-");
    expect(speedToPace(undefined)).toBe("-");
    expect(speedToPace(null)).toBe("-");
    expect(speedToPace(NaN)).toBe("-");
    expect(speedToPace(-1)).toBe("-");
  });

  it("never emits seconds == 60 (carries into the minute)", () => {
    // 1000 / 4.20168 ≈ 238.0 — already on the boundary
    // Pick a speed where rounding would naively yield 60.
    // 1000 / speed = 299.6 → rounds to 300 → must be "5:00", not "4:60".
    const speed = 1000 / 299.6;
    const pace = speedToPace(speed);
    expect(pace).not.toMatch(/:60$/);
  });
});

describe("paceFromDistanceTime", () => {
  it("matches speedToPace(speedFromDistanceTime(...))", () => {
    expect(paceFromDistanceTime(1000, 300)).toBe(speedToPace(speedFromDistanceTime(1000, 300)));
    expect(paceFromDistanceTime(2000, 720)).toBe(speedToPace(speedFromDistanceTime(2000, 720)));
  });
});

describe("secPerKmFromSpeed", () => {
  it("inverts speedFromDistanceTime for the per-km case", () => {
    expect(secPerKmFromSpeed(1000 / 360)).toBeCloseTo(360, 9);
  });

  it("returns 0 on zero/invalid speed", () => {
    expect(secPerKmFromSpeed(0)).toBe(0);
    expect(secPerKmFromSpeed(undefined)).toBe(0);
    expect(secPerKmFromSpeed(NaN)).toBe(0);
  });
});

describe("paceSecToStr / parsePaceToSec", () => {
  it("round-trips integer second values", () => {
    for (const sec of [180, 240, 300, 359, 400]) {
      expect(parsePaceToSec(paceSecToStr(sec))).toBe(sec);
    }
  });

  it("paceSecToStr returns '—' for invalid input", () => {
    expect(paceSecToStr(0)).toBe("—");
    expect(paceSecToStr(NaN)).toBe("—");
    expect(paceSecToStr(-1)).toBe("—");
  });

  it("parsePaceToSec returns null for unparseable strings", () => {
    expect(parsePaceToSec("abc")).toBeNull();
    expect(parsePaceToSec(null)).toBeNull();
    expect(parsePaceToSec(undefined)).toBeNull();
  });

  it("parsePaceToSec passes a number through", () => {
    expect(parsePaceToSec(300)).toBe(300);
  });
});

describe("formatTime", () => {
  it("formats seconds as M:SS", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(59)).toBe("0:59");
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(3725)).toBe("62:05");
  });
});

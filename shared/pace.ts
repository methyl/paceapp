/**
 * Canonical pace/speed conversions. All code that turns a (distance, time)
 * pair into m/s or a "M:SS" pace string MUST go through here. Keeping the
 * formula in one place is what stops the kind of drift where UI shows
 * 4:30/km and MCP shows 4:23/km for the same lap because two callers
 * disagreed on whether to derive speed from distance/time or to average
 * record-level instantaneous speeds.
 */

/** Derive m/s from distance (m) and time (s). Returns 0 when time <= 0. */
export function speedFromDistanceTime(distanceM: number, timeS: number): number {
  if (!Number.isFinite(distanceM) || !Number.isFinite(timeS) || timeS <= 0) return 0;
  return distanceM / timeS;
}

/** Format a speed (m/s) as a "M:SS" per-km pace string. "-" when speed is 0/invalid. */
export function speedToPace(speedMps: number | undefined | null): string {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps <= 0) return "-";
  const secPerKm = 1000 / speedMps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  // 59.6 rounds to 60 — carry into the minute so we never emit "4:60".
  if (sec === 60) return `${min + 1}:00`;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** Convenience: pace string straight from distance/time. */
export function paceFromDistanceTime(distanceM: number, timeS: number): string {
  return speedToPace(speedFromDistanceTime(distanceM, timeS));
}

/** Seconds-per-km from m/s. Returns 0 when speed is 0/invalid. */
export function secPerKmFromSpeed(speedMps: number | undefined | null): number {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps <= 0) return 0;
  return 1000 / speedMps;
}

/** Format a "seconds-per-km" number as a "M:SS" string. "—" when invalid. */
export function paceSecToStr(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  if (s === 60) return `${m + 1}:00`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Parse a "M:SS" pace string (or pass-through a number) into seconds-per-km. */
export function parsePaceToSec(pace: string | number | undefined | null): number | null {
  if (pace == null) return null;
  if (typeof pace === "number") return Number.isFinite(pace) ? pace : null;
  const m = pace.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Format a duration in seconds as "M:SS". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  if (sec === 60) return `${min + 1}:00`;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

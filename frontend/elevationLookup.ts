// Terrain elevation lookups for the run-extension flow.
//
// Open-Meteo's free Elevation API (Copernicus DEM, ~90m grid) gives us a
// realistic ground-truth altitude profile along a synthesized extension
// route. Without it, synthetic altitude is just noise around the runner's
// last recorded value — so an extension over a hill registers no ascent
// and the activity's totalAscent/totalDescent stays stuck at the original.

const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

// Cap one request at 100 coordinates (Open-Meteo's per-call limit). For
// longer routes we downsample to this many evenly spaced points and
// linearly interpolate the elevations back to the input length — terrain
// at the ~90m DEM grid resolution doesn't vary meaningfully between two
// adjacent samples, so this matches the source resolution either way.
// Single-batch fetches finish in under a second and avoid the rate-limit
// failures we saw when a long synthetic route fanned out into many
// parallel batched requests.
const MAX_SAMPLES = 100;

/**
 * Fetch terrain elevation (m) for each [lat, lng] coordinate. Always
 * returns an array the same length as the input (or null on failure).
 */
export async function fetchElevations(
  coords: [number, number][],
  signal?: AbortSignal,
): Promise<number[] | null> {
  if (coords.length === 0) return [];

  const { sampleCoords, sampleIndices } = downsample(coords, MAX_SAMPLES);

  try {
    const sampled = await fetchOnce(sampleCoords, signal);
    if (!sampled) return null;
    if (sampled.length === coords.length) return sampled;
    return expandToFullLength(sampled, sampleIndices, coords.length);
  } catch {
    return null;
  }
}

function downsample(
  coords: [number, number][],
  maxSamples: number,
): { sampleCoords: [number, number][]; sampleIndices: number[] } {
  if (coords.length <= maxSamples) {
    return {
      sampleCoords: coords,
      sampleIndices: coords.map((_, i) => i),
    };
  }
  const sampleCoords: [number, number][] = [];
  const sampleIndices: number[] = [];
  for (let i = 0; i < maxSamples; i++) {
    const idx = Math.round((i * (coords.length - 1)) / (maxSamples - 1));
    sampleIndices.push(idx);
    sampleCoords.push(coords[idx]);
  }
  return { sampleCoords, sampleIndices };
}

function expandToFullLength(
  values: number[],
  sampleIndices: number[],
  totalLength: number,
): number[] {
  const out = new Array<number>(totalLength);
  let lo = 0;
  for (let i = 0; i < totalLength; i++) {
    while (lo < sampleIndices.length - 2 && sampleIndices[lo + 1] <= i) lo++;
    const hi = lo + 1 < sampleIndices.length ? lo + 1 : lo;
    const span = sampleIndices[hi] - sampleIndices[lo];
    const t = span > 0 ? (i - sampleIndices[lo]) / span : 0;
    out[i] = values[lo] + (values[hi] - values[lo]) * t;
  }
  return out;
}

// Exported for unit tests.
export const _internal = { downsample, expandToFullLength };

async function fetchOnce(
  coords: [number, number][],
  signal?: AbortSignal,
): Promise<number[] | null> {
  const lats = coords.map(([lat]) => lat.toFixed(6)).join(",");
  const lngs = coords.map(([, lng]) => lng.toFixed(6)).join(",");
  const url = `${ELEVATION_URL}?latitude=${lats}&longitude=${lngs}`;

  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = await res.json();
  const arr = data?.elevation;
  if (!Array.isArray(arr) || arr.length !== coords.length) return null;
  const out: number[] = [];
  for (const e of arr) {
    if (typeof e !== "number" || !Number.isFinite(e)) return null;
    out.push(e);
  }
  return out;
}

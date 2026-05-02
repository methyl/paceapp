// Terrain elevation lookups for the run-extension flow.
//
// Open-Meteo's free Elevation API (Copernicus DEM, ~90m grid) gives us a
// realistic ground-truth altitude profile along a synthesized extension
// route. Without it, synthetic altitude is just noise around the runner's
// last recorded value — so an extension over a hill registers no ascent
// and the activity's totalAscent/totalDescent stays stuck at the original.

const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

// Open-Meteo accepts up to 100 coordinates per request. We batch in
// parallel; if any batch fails, we abandon the whole lookup so callers
// fall back cleanly to the legacy flat-altitude behavior rather than
// stitching together a partial profile with gaps.
const BATCH_SIZE = 100;

/**
 * Fetch terrain elevation (m) for each [lat, lng] coordinate. Returns null
 * on any failure — callers should treat null as "elevation unavailable" and
 * fall back to drift-based altitude synthesis.
 */
export async function fetchElevations(
  coords: [number, number][],
  signal?: AbortSignal,
): Promise<number[] | null> {
  if (coords.length === 0) return [];

  const batches: [number, number][][] = [];
  for (let i = 0; i < coords.length; i += BATCH_SIZE) {
    batches.push(coords.slice(i, i + BATCH_SIZE));
  }

  try {
    const results = await Promise.all(
      batches.map((batch) => fetchBatch(batch, signal)),
    );
    if (results.some((r) => r === null)) return null;
    return results.flat() as number[];
  } catch {
    return null;
  }
}

async function fetchBatch(
  batch: [number, number][],
  signal?: AbortSignal,
): Promise<number[] | null> {
  const lats = batch.map(([lat]) => lat.toFixed(6)).join(",");
  const lngs = batch.map(([, lng]) => lng.toFixed(6)).join(",");
  const url = `${ELEVATION_URL}?latitude=${lats}&longitude=${lngs}`;

  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = await res.json();
  const arr = data?.elevation;
  if (!Array.isArray(arr) || arr.length !== batch.length) return null;
  const out: number[] = [];
  for (const e of arr) {
    if (typeof e !== "number" || !Number.isFinite(e)) return null;
    out.push(e);
  }
  return out;
}

import { useEffect, useRef, useState } from "react";
import { fetchElevations } from "./elevationLookup";

// OSRM demo server run by FOSSGIS — follows roads AND footpaths/trails
// via OSM's `foot` profile (same backend used by openstreetmap.org directions).
const OSRM_FOOT_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";

export interface SnappedRoute {
  /** Snapped polyline as [lat, lng] pairs. */
  coordinates: [number, number][];
  /** Total road/trail distance in meters. */
  distance: number;
  /** Terrain elevation (m) parallel to `coordinates`, from a DEM lookup.
   *  Null when the elevation service is unreachable — synthesis then falls
   *  back to flat drift around the runner's last altitude. */
  elevations: number[] | null;
}

export async function fetchFootRoute(
  waypoints: [number, number][],
  signal?: AbortSignal,
): Promise<SnappedRoute | null> {
  if (waypoints.length < 2) return null;

  const coords = waypoints
    .map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(";");
  const url = `${OSRM_FOOT_URL}/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;

  const coordinates: [number, number][] = route.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => [lat, lng] as [number, number],
  );

  // Best-effort elevation lookup. Don't fail the whole route if the DEM
  // service is down — the caller can synthesize without it, just with the
  // legacy flat-altitude behavior.
  const elevations = await fetchElevations(coordinates, signal);

  return { coordinates, distance: route.distance, elevations };
}

function waypointsKey(wp: [number, number][]): string {
  return wp.map(([a, b]) => `${a.toFixed(6)},${b.toFixed(6)}`).join("|");
}

export interface SnappedRouteState {
  route: SnappedRoute | null;
  loading: boolean;
  error: string | null;
}

/**
 * Debounced OSRM foot-routing lookup. Returns the snapped path that
 * follows roads/trails between the user's waypoints.
 */
export function useSnappedRoute(
  waypoints: [number, number][],
): SnappedRouteState {
  const [state, setState] = useState<SnappedRouteState>({
    route: null,
    loading: false,
    error: null,
  });
  const lastKey = useRef<string>("");

  useEffect(() => {
    const key = waypointsKey(waypoints);
    if (key === lastKey.current && state.route) return;
    lastKey.current = key;

    if (waypoints.length < 2) {
      setState({ route: null, loading: false, error: null });
      return;
    }

    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    const handle = window.setTimeout(async () => {
      try {
        const route = await fetchFootRoute(waypoints, ac.signal);
        if (ac.signal.aborted) return;
        if (!route) {
          setState({
            route: null,
            loading: false,
            error: "No route found — using straight line",
          });
          return;
        }
        setState({ route, loading: false, error: null });
      } catch (err) {
        if (ac.signal.aborted) return;
        setState({
          route: null,
          loading: false,
          error: "Routing unavailable — using straight line",
        });
      }
    }, 300);

    return () => {
      window.clearTimeout(handle);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypointsKey(waypoints)]);

  return state;
}

import { useEffect, useMemo, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RecordPoint } from "../types";
import { haversineDistance } from "../synthesizeExtension";

interface RouteMapProps {
  records: RecordPoint[];
  height?: number;
  editMode?: boolean;
  waypoints?: [number, number][];
  onWaypointsChange?: (waypoints: [number, number][]) => void;
  /** Road/trail-snapped polyline between waypoints. Falls back to straight lines if absent. */
  snappedPath?: [number, number][];
  /** Total snapped route distance in meters (used for the overlay readout). */
  snappedDistance?: number;
}

export default function RouteMap({
  records,
  height = 250,
  editMode = false,
  waypoints = [],
  onWaypointsChange,
  snappedPath,
  snappedDistance,
}: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const startMarkerRef = useRef<L.CircleMarker | null>(null);
  const endMarkerRef = useRef<L.CircleMarker | null>(null);
  const waypointMarkersRef = useRef<L.Marker[]>([]);
  const waypointEndMarkerRef = useRef<L.CircleMarker | null>(null);
  const extensionLineRef = useRef<L.Polyline | null>(null);
  const connectLineRef = useRef<L.Polyline | null>(null);
  const didInitialFitRef = useRef(false);
  const onChangeRef = useRef(onWaypointsChange);
  const waypointsRef = useRef(waypoints);

  // Keep latest callback/waypoints in refs so marker handlers don't need to be
  // re-bound (and markers don't need to be re-created) on every parent render.
  useEffect(() => {
    onChangeRef.current = onWaypointsChange;
    waypointsRef.current = waypoints;
  });

  // Memoize points so identity is stable across re-renders that don't change `records`.
  const points = useMemo(
    () =>
      records
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => [r.lat!, r.lng!] as [number, number]),
    [records],
  );

  const handleMapClick = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!editMode || !onChangeRef.current) return;
      onChangeRef.current([...waypointsRef.current, [e.latlng.lat, e.latlng.lng]]);
    },
    [editMode],
  );

  // Initialize map once and set up the base route polyline
  useEffect(() => {
    if (!mapRef.current || points.length < 2) return;

    if (!leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: editMode,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(leafletMap.current);
    }

    const map = leafletMap.current;

    // (Re)draw base route polyline
    if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
    routeLayerRef.current = L.polyline(points, {
      color: "#6366f1",
      weight: 3,
      opacity: 0.8,
    }).addTo(map);

    // Start marker
    if (startMarkerRef.current) map.removeLayer(startMarkerRef.current);
    startMarkerRef.current = L.circleMarker(points[0], {
      radius: 6,
      color: "#22c55e",
      fillColor: "#22c55e",
      fillOpacity: 1,
    }).addTo(map);

    // End marker for the real route — hidden in edit mode once the user starts
    // adding waypoints (the last waypoint becomes the new visual end).
    if (endMarkerRef.current) {
      map.removeLayer(endMarkerRef.current);
      endMarkerRef.current = null;
    }
    if (!editMode || waypoints.length === 0) {
      endMarkerRef.current = L.circleMarker(points[points.length - 1], {
        radius: 6,
        color: "#ef4444",
        fillColor: "#ef4444",
        fillOpacity: 1,
      }).addTo(map);
    }

    // Fit bounds only on the first draw of a given records set; later we leave
    // the user's chosen zoom/pan alone (so placing a waypoint doesn't reset it).
    if (!didInitialFitRef.current) {
      map.fitBounds(routeLayerRef.current.getBounds(), { padding: [20, 20] });
      didInitialFitRef.current = true;
    }
  }, [points, editMode, waypoints.length]);

  // Reset the initial-fit flag when the underlying records change so a new
  // activity gets framed properly.
  useEffect(() => {
    didInitialFitRef.current = false;
  }, [records]);

  // Toggle scroll wheel zoom with edit mode
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;
    if (editMode) map.scrollWheelZoom.enable();
    else map.scrollWheelZoom.disable();
  }, [editMode]);

  // Map click handler for waypoint placement
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    if (editMode) {
      map.on("click", handleMapClick);
    }
    return () => {
      map.off("click", handleMapClick);
    };
  }, [editMode, handleMapClick]);

  // Draw waypoints, extension line, and connecting leg
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    // When not in edit mode, clear any waypoint layers and bail.
    if (!editMode) {
      for (const m of waypointMarkersRef.current) map.removeLayer(m);
      waypointMarkersRef.current = [];
      if (extensionLineRef.current) {
        map.removeLayer(extensionLineRef.current);
        extensionLineRef.current = null;
      }
      if (connectLineRef.current) {
        map.removeLayer(connectLineRef.current);
        connectLineRef.current = null;
      }
      if (waypointEndMarkerRef.current) {
        map.removeLayer(waypointEndMarkerRef.current);
        waypointEndMarkerRef.current = null;
      }
      return;
    }

    // Connect last real GPS point to first waypoint
    if (connectLineRef.current) {
      map.removeLayer(connectLineRef.current);
      connectLineRef.current = null;
    }
    const lastReal = points[points.length - 1];
    if (lastReal && waypoints.length > 0) {
      connectLineRef.current = L.polyline([lastReal, waypoints[0]], {
        color: "#f97316",
        weight: 2,
        dashArray: "6 4",
        opacity: 0.7,
      }).addTo(map);
    }

    // Extension polyline — prefer snapped path when available
    if (extensionLineRef.current) {
      map.removeLayer(extensionLineRef.current);
      extensionLineRef.current = null;
    }
    const hasSnapped = snappedPath && snappedPath.length >= 2;
    if (hasSnapped) {
      extensionLineRef.current = L.polyline(snappedPath!, {
        color: "#f97316",
        weight: 3,
        opacity: 0.9,
      }).addTo(map);
    } else if (waypoints.length >= 2) {
      extensionLineRef.current = L.polyline(waypoints, {
        color: "#f97316",
        weight: 3,
        dashArray: "8 4",
        opacity: 0.8,
      }).addTo(map);
    }

    // Reconcile waypoint markers: reuse existing ones where possible (critical
    // for mobile — destroying a marker mid-drag strands the tap and the next
    // click can land as a spurious waypoint).
    const existing = waypointMarkersRef.current;
    // Trim excess
    while (existing.length > waypoints.length) {
      const m = existing.pop();
      if (m) map.removeLayer(m);
    }
    // Update / create
    waypoints.forEach((wp, i) => {
      const html = `<div style="background:#f97316;color:white;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);touch-action:none">${i + 1}</div>`;
      let marker = existing[i];
      if (!marker) {
        marker = L.marker(wp, {
          draggable: true,
          autoPan: false,
          // Stop click/touch events on the marker from reaching the map so a
          // drag-release doesn't register as a new waypoint on mobile.
          bubblingMouseEvents: false,
          icon: L.divIcon({
            className: "",
            html,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        }).addTo(map);

        const idx = i;
        marker.on("dragend", () => {
          const pos = marker!.getLatLng();
          const updated = [...waypointsRef.current];
          updated[idx] = [pos.lat, pos.lng];
          onChangeRef.current?.(updated);
        });
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e as unknown as Event);
        });
        marker.on("contextmenu", (e) => {
          L.DomEvent.preventDefault(e as unknown as Event);
          L.DomEvent.stopPropagation(e as unknown as Event);
          const updated = waypointsRef.current.filter((_, j) => j !== idx);
          onChangeRef.current?.(updated);
        });

        existing[i] = marker;
      } else {
        // Update position & label in place
        const current = marker.getLatLng();
        if (current.lat !== wp[0] || current.lng !== wp[1]) {
          marker.setLatLng(wp);
        }
        marker.setIcon(
          L.divIcon({
            className: "",
            html,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        );
      }
    });

    // End marker at the last waypoint
    if (waypointEndMarkerRef.current) {
      map.removeLayer(waypointEndMarkerRef.current);
      waypointEndMarkerRef.current = null;
    }
    if (waypoints.length > 0) {
      const lastWp = waypoints[waypoints.length - 1];
      waypointEndMarkerRef.current = L.circleMarker(lastWp, {
        radius: 6,
        color: "#ef4444",
        fillColor: "#ef4444",
        fillOpacity: 1,
      }).addTo(map);
    }
  }, [waypoints, points, editMode, snappedPath]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  if (points.length < 2) return null;

  // Compute extension distance for display — prefer snapped distance if we have one
  let extensionDist = snappedDistance ?? 0;
  if (!snappedDistance && waypoints.length >= 2) {
    for (let i = 1; i < waypoints.length; i++) {
      extensionDist += haversineDistance(
        waypoints[i - 1][0], waypoints[i - 1][1],
        waypoints[i][0], waypoints[i][1]
      );
    }
  }

  return (
    <div className="relative">
      <div
        ref={mapRef}
        style={{ height: `${height}px` }}
        className="rounded-lg border border-gray-200 z-0"
      />
      {editMode && waypoints.length >= 2 && (
        <div className="absolute bottom-2 right-2 bg-white/90 rounded px-2 py-1 text-xs font-medium text-gray-700 shadow z-10">
          Extension: {(extensionDist / 1000).toFixed(2)} km
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useCallback } from "react";
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
  const waypointMarkersRef = useRef<L.Marker[]>([]);
  const extensionLineRef = useRef<L.Polyline | null>(null);
  const connectLineRef = useRef<L.Polyline | null>(null);

  const points = records
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => [r.lat!, r.lng!] as [number, number]);

  const handleMapClick = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!editMode || !onWaypointsChange) return;
      onWaypointsChange([...waypoints, [e.latlng.lat, e.latlng.lng]]);
    },
    [editMode, waypoints, onWaypointsChange]
  );

  // Initialize map
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

    if (editMode) {
      map.scrollWheelZoom.enable();
    }

    // Clear existing route layers
    map.eachLayer((layer) => {
      if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

    // Draw existing route
    const polyline = L.polyline(points, {
      color: "#6366f1",
      weight: 3,
      opacity: 0.8,
    }).addTo(map);

    // Start marker
    L.circleMarker(points[0], {
      radius: 6,
      color: "#22c55e",
      fillColor: "#22c55e",
      fillOpacity: 1,
    }).addTo(map);

    // End marker (only if not in edit mode or no waypoints)
    if (!editMode || waypoints.length === 0) {
      L.circleMarker(points[points.length - 1], {
        radius: 6,
        color: "#ef4444",
        fillColor: "#ef4444",
        fillOpacity: 1,
      }).addTo(map);
    }

    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
  }, [points, editMode]);

  // Handle click events
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

  // Draw waypoints and extension line
  useEffect(() => {
    const map = leafletMap.current;
    if (!map || !editMode) return;

    // Clear previous waypoint markers
    for (const m of waypointMarkersRef.current) map.removeLayer(m);
    waypointMarkersRef.current = [];
    if (extensionLineRef.current) map.removeLayer(extensionLineRef.current);
    if (connectLineRef.current) map.removeLayer(connectLineRef.current);

    if (waypoints.length === 0) return;

    // Connect last real GPS point to first waypoint (always a straight "leg" since
    // we don't know where the runner was between end-of-data and the first waypoint).
    const lastReal = points[points.length - 1];
    if (lastReal) {
      connectLineRef.current = L.polyline([lastReal, waypoints[0]], {
        color: "#f97316",
        weight: 2,
        dashArray: "6 4",
        opacity: 0.7,
      }).addTo(map);
    }

    // Extension polyline — prefer the snapped (road/trail) path when available
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

    // Waypoint markers
    waypoints.forEach((wp, i) => {
      const marker = L.marker(wp, {
        draggable: true,
        icon: L.divIcon({
          className: "",
          html: `<div style="background:#f97316;color:white;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)">${i + 1}</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(map);

      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        const updated = [...waypoints];
        updated[i] = [pos.lat, pos.lng];
        onWaypointsChange?.(updated);
      });

      marker.on("contextmenu", (e) => {
        L.DomEvent.preventDefault(e as unknown as Event);
        const updated = waypoints.filter((_, idx) => idx !== i);
        onWaypointsChange?.(updated);
      });

      waypointMarkersRef.current.push(marker);
    });

    // End marker at last waypoint
    const lastWp = waypoints[waypoints.length - 1];
    L.circleMarker(lastWp, {
      radius: 6,
      color: "#ef4444",
      fillColor: "#ef4444",
      fillOpacity: 1,
    }).addTo(map);
  }, [waypoints, points, editMode, onWaypointsChange, snappedPath]);

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

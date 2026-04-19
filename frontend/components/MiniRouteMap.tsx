import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RecordPoint } from "../types";

interface MiniRouteMapProps {
  records: RecordPoint[];
  color?: string;
  height?: number;
}

export default function MiniRouteMap({
  records,
  color = "#6366f1",
  height = 120,
}: MiniRouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  const allPoints = records.filter((r) => r.lat != null && r.lng != null);
  // Use distance-based simplification: skip points that are very close to the previous kept point
  const points: [number, number][] = [];
  const minGap = allPoints.length > 500 ? 0.00005 : 0; // ~5m at equator
  let lastLat = -999, lastLng = -999;
  for (const r of allPoints) {
    if (Math.abs(r.lat! - lastLat) > minGap || Math.abs(r.lng! - lastLng) > minGap) {
      points.push([r.lat!, r.lng!]);
      lastLat = r.lat!;
      lastLng = r.lng!;
    }
  }

  useEffect(() => {
    if (!mapRef.current || points.length < 2) return;

    if (!leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(leafletMap.current);
    }

    const map = leafletMap.current;

    map.eachLayer((layer) => {
      if (layer instanceof L.Polyline) map.removeLayer(layer);
    });

    const polyline = L.polyline(points, {
      color,
      weight: 2.5,
      opacity: 0.8,
    }).addTo(map);

    // invalidateSize + setTimeout ensures Leaflet knows the container size
    // before fitting bounds — prevents garbled rendering in card layouts
    map.invalidateSize();
    setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(polyline.getBounds(), { padding: [8, 8], maxZoom: 16 });
    }, 50);
  }, [points, color]);

  useEffect(() => {
    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  if (points.length < 2) {
    return (
      <div
        style={{ height: `${height}px` }}
        className="rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-400"
      >
        No GPS
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      style={{ height: `${height}px` }}
      className="rounded-lg z-0"
    />
  );
}

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RecordPoint } from "../types";

interface RouteMapProps {
  records: RecordPoint[];
  height?: number;
}

export default function RouteMap({ records, height = 250 }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  const points = records
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => [r.lat!, r.lng!] as [number, number]);

  useEffect(() => {
    if (!mapRef.current || points.length < 2) return;

    // Create map if it doesn't exist
    if (!leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(leafletMap.current);
    }

    const map = leafletMap.current;

    // Clear existing layers (except tile layer)
    map.eachLayer((layer) => {
      if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

    // Draw route
    const polyline = L.polyline(points, {
      color: "#6366f1",
      weight: 3,
      opacity: 0.8,
    }).addTo(map);

    // Start/end markers
    L.circleMarker(points[0], {
      radius: 6,
      color: "#22c55e",
      fillColor: "#22c55e",
      fillOpacity: 1,
    }).addTo(map);

    L.circleMarker(points[points.length - 1], {
      radius: 6,
      color: "#ef4444",
      fillColor: "#ef4444",
      fillOpacity: 1,
    }).addTo(map);

    // Fit bounds
    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });

    return () => {
      // Cleanup on unmount
    };
  }, [points]);

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  if (points.length < 2) return null;

  return (
    <div
      ref={mapRef}
      style={{ height: `${height}px` }}
      className="rounded-lg border border-gray-200 z-0"
    />
  );
}

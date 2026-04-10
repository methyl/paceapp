import { useEffect, useRef, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ParsedActivity } from "../types";
import { WORKOUT_COLORS } from "../types";

interface LibraryMapProps {
  activities: ParsedActivity[];
  onSelect: (activity: ParsedActivity) => void;
}

export default function LibraryMap({ activities, onSelect }: LibraryMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  const routes = useMemo(
    () =>
      activities
        .map((a) => {
          const pts = a.records
            .filter((r) => r.lat != null && r.lng != null)
            .map((r) => [r.lat!, r.lng!] as [number, number]);
          return { activity: a, points: pts };
        })
        .filter((r) => r.points.length >= 10),
    [activities]
  );

  useEffect(() => {
    if (!mapRef.current || routes.length === 0) return;

    if (!leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(leafletMap.current);
    }

    const map = leafletMap.current;

    // Clear existing route layers
    map.eachLayer((layer) => {
      if (layer instanceof L.Polyline) map.removeLayer(layer);
    });

    // Draw all routes
    const allPoints: [number, number][] = [];
    for (const route of routes) {
      const color = WORKOUT_COLORS[route.activity.workoutType] ?? "#6b7280";
      // Downsample for performance
      const step = Math.max(1, Math.floor(route.points.length / 100));
      const sampled = route.points.filter((_, i) => i % step === 0);

      const polyline = L.polyline(sampled, {
        color,
        weight: 2.5,
        opacity: 0.6,
      }).addTo(map);

      const date = route.activity.summary.startTime
        ? new Date(route.activity.summary.startTime).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : "";

      polyline.bindTooltip(
        `${date} ${route.activity.workoutLabel}`,
        { sticky: true, className: "text-xs" }
      );

      polyline.on("click", () => onSelect(route.activity));

      allPoints.push(...sampled);
    }

    // Fit bounds to all routes
    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [routes, onSelect]);

  useEffect(() => {
    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  if (routes.length === 0) return null;

  return (
    <div
      ref={mapRef}
      style={{ height: "300px" }}
      className="rounded-lg border border-gray-200 z-0"
    />
  );
}

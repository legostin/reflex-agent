/**
 * Popular routing/maps services. Used by the map widget to surface a
 * "Маршрут в…" popup per pin, and by Settings → Map services to let the
 * user toggle which ones appear.
 *
 * `urlFor(lat, lng)` returns a deep-link that opens a routing query to the
 * given single destination. `routeUrlFor(stops)` returns a deep-link for a
 * multi-waypoint route — providers that don't support waypoints fall back
 * to "directions to the last stop only".
 */

export interface RouteStop {
  lat: number;
  lng: number;
}

export interface MapService {
  id: string;
  label: string;
  /** Short hint for the settings checkbox row. */
  description: string;
  /** CSS brand color (used by the badge icon). */
  brand: string;
  /** 1-3 char glyph for the inline brand icon. */
  glyph: string;
  /** Single destination deep-link. */
  urlFor: (lat: number, lng: number) => string;
  /** Multi-waypoint route deep-link. At least 2 stops. */
  routeUrlFor: (stops: RouteStop[]) => string;
}

/** Build a Google-style waypoint string (lat,lng). */
function ll(s: RouteStop): string {
  return `${s.lat},${s.lng}`;
}
/** 2GIS uses lng,lat. */
function llRev(s: RouteStop): string {
  return `${s.lng},${s.lat}`;
}

export const MAP_SERVICES: MapService[] = [
  {
    id: "google",
    label: "Google Maps",
    description: "Глобальный, navigation+street view. Работает везде кроме РФ-блокировок.",
    brand: "#4285F4",
    glyph: "G",
    urlFor: (lat, lng) =>
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    routeUrlFor: (stops) => {
      if (stops.length < 2) return "";
      const origin = ll(stops[0]!);
      const destination = ll(stops[stops.length - 1]!);
      const waypoints = stops
        .slice(1, -1)
        .map(ll)
        .join("|");
      const wp = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
      return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${wp}`;
    },
  },
  {
    id: "yandex",
    label: "Яндекс.Карты",
    description: "СНГ, лучшая детализация по РФ и пробки в реальном времени.",
    brand: "#FFCC00",
    glyph: "Я",
    urlFor: (lat, lng) =>
      `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`,
    routeUrlFor: (stops) =>
      `https://yandex.ru/maps/?rtext=${stops.map(ll).join("~")}&rtt=auto`,
  },
  {
    id: "2gis",
    label: "2ГИС",
    description: "СНГ, точные адреса и POI. Уникальная свойственность РФ-городов.",
    brand: "#1BA049",
    glyph: "2",
    urlFor: (lat, lng) => `https://2gis.ru/routeSearch/to/${lng},${lat}`,
    routeUrlFor: (stops) => {
      // 2GIS: /routeSearch/rsType/car/from/<lng,lat>/to/<lng,lat>
      // Waypoints in between are passed as `/via/<lng,lat>` repeated.
      const from = llRev(stops[0]!);
      const to = llRev(stops[stops.length - 1]!);
      const via = stops
        .slice(1, -1)
        .map((s) => `/via/${llRev(s)}`)
        .join("");
      return `https://2gis.ru/routeSearch/rsType/car/from/${from}${via}/to/${to}`;
    },
  },
  {
    id: "apple",
    label: "Apple Maps",
    description: "Откроется в нативном приложении на iOS/macOS, иначе на сайте.",
    brand: "#1d1d1f",
    glyph: "A",
    urlFor: (lat, lng) => `https://maps.apple.com/?daddr=${lat},${lng}`,
    routeUrlFor: (stops) => {
      // Apple Maps URL scheme chains stops with `+to:`
      const start = ll(stops[0]!);
      const chain = stops
        .slice(1)
        .map((s) => `+to:${ll(s)}`)
        .join("");
      return `https://maps.apple.com/?saddr=${start}&daddr=${start}${chain}`;
    },
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    description: "Открытые данные, без аккаунта. Базовая навигация.",
    brand: "#7EB73F",
    glyph: "OSM",
    urlFor: (lat, lng) =>
      `https://www.openstreetmap.org/directions?to=${lat},${lng}`,
    routeUrlFor: (stops) => {
      const route = stops.map(ll).join(";");
      return `https://www.openstreetmap.org/directions?route=${encodeURIComponent(route)}`;
    },
  },
  {
    id: "waze",
    label: "Waze",
    description: "Авто-навигация с краудсорсингом пробок и предупреждений.",
    brand: "#33CCFF",
    glyph: "W",
    urlFor: (lat, lng) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
    routeUrlFor: (stops) => {
      // Waze deep-link supports a single destination — pick the last stop.
      const dest = stops[stops.length - 1]!;
      return `https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`;
    },
  },
  {
    id: "organic",
    label: "Organic Maps",
    description: "Офлайн-карты с открытыми данными. Открывается в приложении.",
    brand: "#006C35",
    glyph: "OM",
    urlFor: (lat, lng) => `om://map?ll=${lat},${lng}`,
    routeUrlFor: (stops) => {
      const a = stops[0]!;
      const b = stops[stops.length - 1]!;
      return `om://route?sll=${a.lat},${a.lng}&saddr=&dll=${b.lat},${b.lng}&daddr=&type=vehicle`;
    },
  },
];

export const DEFAULT_ENABLED_SERVICES = ["google", "yandex", "apple", "osm"];

export function getEnabledServices(enabledIds: readonly string[]): MapService[] {
  const set = new Set(enabledIds);
  return MAP_SERVICES.filter((s) => set.has(s.id));
}

export function getServiceById(id: string): MapService | undefined {
  return MAP_SERVICES.find((s) => s.id === id);
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Copy,
  Loader2,
  MapPin,
  Plus,
  Route,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { MapData, MapPoint, MapRoute } from "@/lib/server/widgets/types";
import {
  MAP_SERVICES,
  DEFAULT_ENABLED_SERVICES,
  type MapService,
  type RouteStop,
} from "@/lib/client/map-services";
import { MapServiceBadge } from "@/lib/client/map-service-badge";
import { getEnabledMapServicesAction } from "@/lib/server/map-actions";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

interface NominatimHit {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
}

/**
 * Map widget. Renders points and an optional route polyline on a Leaflet
 * map (CDN-loaded on demand). Beyond display, the dashboard version of
 * the widget supports:
 *   - in-place geocoding search (Nominatim) → click result adds a point
 *   - "Route mode": pick points in order, persist into `data.route.stops`,
 *     draw a polyline, deep-link to each provider as a multi-waypoint
 *     route
 *   - per-service brand icons for copying / opening the routing link
 *
 * In readonly mode (chat preview card) the search/route-builder UI is
 * hidden — those affordances belong to the dashboard, not to a turn
 * artifact.
 */
export function MapWidget({
  data,
  readonly,
  onPatch,
}: {
  rootId: string;
  data: MapData;
  readonly?: boolean;
  onPatch?: (next: MapData) => Promise<void> | void;
}) {
  const t = useTranslations("roots");
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [enabledServices, setEnabledServices] = useState<string[]>(
    DEFAULT_ENABLED_SERVICES,
  );
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<NominatimHit[]>([]);
  const [routeMode, setRouteMode] = useState(false);
  const [routeDraft, setRouteDraft] = useState<number[]>([]);

  const points = data.points ?? [];
  const persistedStops = data.route?.stops ?? [];
  // The list of stops we actually render on the map (and what the route
  // deep-links use): draft while editing, persisted otherwise.
  const effectiveStops = routeMode ? routeDraft : persistedStops;
  const routeCoords: RouteStop[] = useMemo(
    () =>
      effectiveStops
        .map((i) => points[i])
        .filter((p): p is MapPoint => !!p)
        .map((p) => ({ lat: p.lat, lng: p.lng })),
    [effectiveStops, points],
  );
  const services = useMemo(
    () => MAP_SERVICES.filter((s) => enabledServices.includes(s.id)),
    [enabledServices],
  );

  // Pull enabled-services list once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await getEnabledMapServicesAction();
        if (!cancelled && r.ok) setEnabledServices(r.enabled);
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load Leaflet on demand (CDN, idempotent).
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).L) {
      setLeafletReady(true);
      return;
    }
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${LEAFLET_JS}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => setLeafletReady(true));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).L) setLeafletReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => setLeafletReady(true);
    script.onerror = () =>
      toast.error(t("mapWidget.leafletLoadFailed"));
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init / refresh the map. Re-runs whenever data or the visible stops change.
  useEffect(() => {
    if (!leafletReady || !containerRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!L) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    if (points.length === 0) return;

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    });
    mapRef.current = map;

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      maxZoom: 19,
    }).addTo(map);

    const markers = points.map((p, idx) => {
      const inRoute = effectiveStops.includes(idx);
      const html = popupHtml(p, services, {
        openIn: t("mapWidget.openIn"),
        copyCoords: t("mapWidget.copyCoords"),
      });
      const marker = L.marker([p.lat, p.lng], {
        opacity: routeMode && !inRoute ? 0.55 : 1,
      }).addTo(map);
      marker.bindPopup(html, { maxWidth: 280 });
      marker.on("click", () => {
        if (routeMode) {
          setRouteDraft((cur) =>
            cur.includes(idx) ? cur.filter((j) => j !== idx) : [...cur, idx],
          );
        }
      });
      return marker;
    });

    // Polyline for the route.
    if (routeCoords.length >= 2) {
      L.polyline(
        routeCoords.map((s) => [s.lat, s.lng]),
        {
          color: data.route?.color ?? "#7c3aed",
          weight: 4,
          opacity: 0.85,
          dashArray: routeMode ? "6,6" : undefined,
        },
      ).addTo(map);
    }

    const onPopupClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const copyTarget = target.closest<HTMLElement>("[data-reflex-copy]");
      if (copyTarget) {
        const url = copyTarget.getAttribute("data-reflex-copy");
        if (url) {
          void navigator.clipboard
            .writeText(url)
            .then(() => toast.success(t("mapWidget.copied")))
            .catch(() => toast.error(t("mapWidget.clipboardUnavailable")));
        }
        e.preventDefault();
      }
    };
    containerRef.current.addEventListener("click", onPopupClick);

    if (data.center && typeof data.zoom === "number") {
      map.setView([data.center.lat, data.center.lng], data.zoom);
    } else if (points.length === 1) {
      map.setView([points[0]!.lat, points[0]!.lng], data.zoom ?? 12);
    } else {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.2));
    }

    return () => {
      containerRef.current?.removeEventListener("click", onPopupClick);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    leafletReady,
    data,
    enabledServices.join("|"),
    routeMode,
    routeDraft.join(","),
  ]);

  const interactive = !readonly && !!onPatch;

  const doSearch = async () => {
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    setHits([]);
    try {
      const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=6`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as NominatimHit[];
      setHits(json);
      if (json.length === 0) toast.message(t("mapWidget.nothingFound"));
    } catch (err) {
      toast.error(
        t("mapWidget.searchFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setSearching(false);
    }
  };

  const addPointFromHit = async (hit: NominatimHit) => {
    if (!interactive) return;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error(t("mapWidget.invalidCoordinates"));
      return;
    }
    const title =
      hit.display_name.split(",")[0]?.trim() || hit.display_name.slice(0, 60);
    const next: MapData = {
      ...data,
      points: [
        ...points,
        { lat, lng, title, description: hit.display_name },
      ],
    };
    setHits([]);
    setSearch("");
    await onPatch?.(next);
  };

  const removePoint = async (idx: number) => {
    if (!interactive) return;
    const nextPoints = points.filter((_, i) => i !== idx);
    // Re-map route indices: drop the deleted index, shift higher ones down.
    let nextRoute: MapRoute | undefined = data.route;
    if (data.route?.stops?.length) {
      const stops = data.route.stops
        .filter((j) => j !== idx)
        .map((j) => (j > idx ? j - 1 : j));
      nextRoute = stops.length >= 2 ? { ...data.route, stops } : undefined;
    }
    const next: MapData = {
      ...data,
      points: nextPoints,
      ...(nextRoute ? { route: nextRoute } : { route: undefined }),
    };
    await onPatch?.(next);
  };

  const startRouteMode = () => {
    setRouteDraft(persistedStops);
    setRouteMode(true);
  };
  const cancelRouteMode = () => {
    setRouteMode(false);
    setRouteDraft([]);
  };
  const clearRoute = async () => {
    if (!interactive) return;
    const next: MapData = { ...data, route: undefined };
    await onPatch?.(next);
    setRouteMode(false);
    setRouteDraft([]);
  };
  const saveRoute = async () => {
    if (!interactive) return;
    if (routeDraft.length < 2) {
      toast.error(t("mapWidget.routeNeedsTwo"));
      return;
    }
    const next: MapData = {
      ...data,
      route: { ...(data.route ?? {}), stops: routeDraft },
    };
    await onPatch?.(next);
    setRouteMode(false);
  };

  if (points.length === 0 && !interactive) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("mapWidget.noPointsReadonly")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {interactive && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void doSearch();
                  }
                }}
                placeholder={t("mapWidget.searchPlaceholder")}
                className="w-full rounded border bg-background pl-7 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <button
              type="button"
              onClick={() => void doSearch()}
              disabled={searching || !search.trim()}
              className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1"
            >
              {searching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Search className="h-3 w-3" />
              )}
              {t("mapWidget.search")}
            </button>
            {routeMode ? (
              <>
                <button
                  type="button"
                  onClick={() => void saveRoute()}
                  className="rounded px-2 py-1 text-xs bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center gap-1"
                  title={t("mapWidget.saveRouteTitle")}
                >
                  <Route className="h-3 w-3" /> {t("mapWidget.save")}
                </button>
                <button
                  type="button"
                  onClick={cancelRouteMode}
                  className="rounded border px-2 py-1 text-xs hover:bg-accent inline-flex items-center gap-1"
                  title={t("mapWidget.cancelTitle")}
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startRouteMode}
                disabled={points.length < 2}
                className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1"
                title={t("mapWidget.routeButtonTitle")}
              >
                <Route className="h-3 w-3" />
                {t("mapWidget.route")}
              </button>
            )}
          </div>
          {hits.length > 0 && (
            <ul className="rounded border bg-card divide-y text-xs max-h-44 overflow-y-auto">
              {hits.map((h, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => void addPointFromHit(h)}
                    className="w-full text-left flex items-start gap-2 px-2 py-1.5 hover:bg-accent"
                  >
                    <Plus className="h-3 w-3 mt-0.5 text-emerald-700 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">
                        {h.display_name.split(",")[0]}
                      </span>
                      <span className="block text-[10px] text-muted-foreground truncate">
                        {h.display_name}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {routeMode && (
            <div className="rounded border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-900/50 px-2 py-1.5 text-[11px] text-violet-900 dark:text-violet-200">
              {t.rich("mapWidget.routeModeHint", {
                count: routeDraft.length,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="rounded-md border overflow-hidden bg-muted/30"
        style={{ height: 280 }}
      />

      {/* Persisted route → service-icons row, only when not in edit mode. */}
      {!routeMode && routeCoords.length >= 2 && services.length > 0 && (
        <div className="rounded border bg-card px-2 py-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium">
              <Route className="h-3 w-3 text-violet-600" />
              {t("mapWidget.routeLabel", { count: routeCoords.length })}
            </span>
            {services.map((svc) => (
              <RouteServiceLink
                key={svc.id}
                service={svc}
                stops={routeCoords}
              />
            ))}
            {interactive && (
              <button
                type="button"
                onClick={() => void clearRoute()}
                className="ml-auto text-[10px] text-muted-foreground hover:text-destructive inline-flex items-center gap-0.5"
                title={t("mapWidget.deleteRouteTitle")}
              >
                <Trash2 className="h-3 w-3" />
                {t("mapWidget.delete")}
              </button>
            )}
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {points.map((p, i) => {
          const inRoute = effectiveStops.indexOf(i);
          return (
            <li
              key={i}
              className={
                "flex items-start gap-2 rounded-md border bg-card px-2 py-1.5 text-xs " +
                (routeMode && inRoute >= 0
                  ? "ring-1 ring-violet-400 border-violet-300"
                  : "")
              }
            >
              {routeMode ? (
                <button
                  type="button"
                  onClick={() =>
                    setRouteDraft((cur) =>
                      cur.includes(i)
                        ? cur.filter((j) => j !== i)
                        : [...cur, i],
                    )
                  }
                  className={
                    "h-5 w-5 mt-0.5 shrink-0 rounded-full border text-[10px] font-mono inline-flex items-center justify-center " +
                    (inRoute >= 0
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-card text-muted-foreground")
                  }
                  title={
                    inRoute >= 0
                      ? t("mapWidget.removeFromRoute")
                      : t("mapWidget.addToRoute")
                  }
                >
                  {inRoute >= 0 ? inRoute + 1 : "+"}
                </button>
              ) : (
                <MapPin
                  className={
                    "h-3 w-3 mt-1 shrink-0 " +
                    (persistedStops.includes(i)
                      ? "text-violet-600"
                      : "text-emerald-700")
                  }
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{p.title}</div>
                {p.description && (
                  <p className="text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                    {p.description}
                  </p>
                )}
                <div className="text-[10px] text-muted-foreground/80 font-mono mt-0.5">
                  {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                </div>
              </div>
              <PointActions
                point={p}
                services={services}
                interactive={interactive}
                onRemove={() => void removePoint(i)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Per-row compact action menu in the linear list under the map. Mirrors
 * the popup actions but more discoverable (popup requires clicking the
 * pin first). Brand badges replace the generic Navigation icon — the
 * user instantly sees which provider opens.
 */
function PointActions({
  point,
  services,
  interactive,
  onRemove,
}: {
  point: MapPoint;
  services: MapService[];
  interactive: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("roots");
  const copyCoords = () => {
    void navigator.clipboard
      .writeText(`${point.lat}, ${point.lng}`)
      .then(() => toast.success(t("mapWidget.coordsCopied")))
      .catch(() => toast.error(t("mapWidget.clipboardUnavailable")));
  };
  return (
    <div className="flex items-center gap-1 shrink-0">
      {services.slice(0, 4).map((svc) => (
        <a
          key={svc.id}
          href={svc.urlFor(point.lat, point.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-0.5 hover:ring-1 hover:ring-offset-1 hover:ring-violet-300"
          title={t("mapWidget.navigationTitle", { service: svc.label })}
        >
          <MapServiceBadge service={svc} size={18} />
        </a>
      ))}
      <button
        type="button"
        onClick={copyCoords}
        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        title={t("mapWidget.copyCoords")}
      >
        <Copy className="h-3 w-3" />
      </button>
      {interactive && (
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive"
          title={t("mapWidget.removePoint")}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/**
 * Brand-icon link that opens the full route (all waypoints) in the
 * provider's web/native app. Falls back gracefully if the provider's URL
 * scheme can't represent the route — `routeUrlFor` is responsible for
 * the fallback (e.g., Waze only takes a destination).
 */
function RouteServiceLink({
  service,
  stops,
}: {
  service: MapService;
  stops: RouteStop[];
}) {
  const t = useTranslations("roots");
  const url = service.routeUrlFor(stops);
  const copy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("mapWidget.linkCopied", { service: service.label })))
      .catch(() => toast.error(t("mapWidget.clipboardUnavailable")));
  };
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onContextMenu={copy}
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent"
      title={t("mapWidget.openTitle", { service: service.label })}
    >
      <MapServiceBadge service={service} size={16} />
      <span className="truncate max-w-[80px]">{service.label}</span>
      <button
        type="button"
        onClick={copy}
        className="text-muted-foreground hover:text-foreground"
        title={t("mapWidget.copyLinkTitle")}
      >
        <Copy className="h-2.5 w-2.5" />
      </button>
    </a>
  );
}

/**
 * Build the HTML for a marker popup. Returns a plain string (Leaflet
 * popups don't support React). Event delegation in the map container
 * wires clipboard actions; external links use plain `<a target="_blank">`.
 */
function popupHtml(
  point: MapPoint,
  services: MapService[],
  labels: { openIn: string; copyCoords: string },
): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const linksHtml = services
    .map((svc) => {
      const url = svc.urlFor(point.lat, point.lng);
      return (
        `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" ` +
        `title="${escape(svc.label)}" ` +
        `style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:2px 6px;` +
        `border-radius:5px;border:1px solid #e5e7eb;text-decoration:none;font-size:11px;color:#111;` +
        `background:#fff;">` +
        `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${svc.brand};` +
        `color:#fff;font-size:9px;font-weight:700;line-height:14px;text-align:center;` +
        `letter-spacing:${svc.glyph.length > 1 ? "-0.05em" : "0"}">${escape(svc.glyph)}</span>` +
        `<span>${escape(svc.label)}</span>` +
        `</a>`
      );
    })
    .join("");
  return [
    `<div style="font-family:inherit;min-width:200px">`,
    `<div style="font-weight:600;font-size:13px;margin-bottom:2px">${escape(point.title)}</div>`,
    point.description
      ? `<div style="font-size:12px;color:#666;margin-bottom:6px">${escape(point.description)}</div>`
      : "",
    `<div style="font-family:monospace;font-size:10px;color:#888;margin-bottom:6px">${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}</div>`,
    services.length > 0
      ? `<div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">${escape(labels.openIn)}</div>${linksHtml}`
      : "",
    `<div style="margin-top:6px"><button type="button" data-reflex-copy="${point.lat}, ${point.lng}" style="font-size:11px;padding:2px 8px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer">📋 ${escape(labels.copyCoords)}</button></div>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("");
}

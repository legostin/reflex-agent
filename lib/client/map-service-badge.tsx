"use client";

import type { MapService } from "./map-services";

/**
 * Compact brand badge for a routing/maps service — colored square with
 * 1-3 char glyph. Kept tiny so we can stack multiple of them per point
 * row in the map widget. Designed to be button-like when wrapped in an
 * <a> or <button>.
 */
export function MapServiceBadge({
  service,
  size = 18,
  className,
}: {
  service: MapService;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center justify-center rounded-[5px] font-bold leading-none text-white shrink-0 " +
        (className ?? "")
      }
      style={{
        background: service.brand,
        width: size,
        height: size,
        fontSize: Math.max(8, Math.floor(size * 0.55)),
        letterSpacing: service.glyph.length > 1 ? "-0.05em" : "0",
      }}
      aria-hidden
    >
      {service.glyph}
    </span>
  );
}

"use client";

import { ExternalLink, Map } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MAP_SERVICES } from "@/lib/client/map-services";
import type { Settings } from "@/lib/settings";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/**
 * Toggle which routing/maps services show up in the map widget's
 * "Маршрут в…" popup. Pure presentation — actual persistence happens
 * via the settings-form save flow. Free-form id list (not enum) so
 * users can later add custom providers without a schema migration.
 */
export function MapServicesSection({ settings, onChange }: Props) {
  const enabled = new Set(settings.mapServices.enabled);
  const toggle = (id: string) => {
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ mapServices: { enabled: [...next] } });
  };
  const sample = { lat: 55.7558, lng: 37.6173 }; // Moscow center, for preview link

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Map className="h-4 w-4 text-emerald-700" />
          <span>Сервисы маршрутов</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Выбранные сервисы появятся в попапе на каждой точке карта-виджета —
          «Маршрут в…». Ссылка генерится прямо из координат, без посредников.
          Можно проверить превью-ссылку (точка по умолчанию — центр Москвы).
        </p>
        <ul className="space-y-1.5">
          {MAP_SERVICES.map((svc) => {
            const isOn = enabled.has(svc.id);
            return (
              <li
                key={svc.id}
                className="flex items-start gap-2 rounded-md border bg-card px-3 py-2"
              >
                <input
                  id={`map-svc-${svc.id}`}
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(svc.id)}
                  className="mt-1 h-3.5 w-3.5"
                />
                <label
                  htmlFor={`map-svc-${svc.id}`}
                  className="min-w-0 flex-1 cursor-pointer"
                >
                  <div className="text-sm font-medium">{svc.label}</div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {svc.description}
                  </p>
                </label>
                <a
                  href={svc.urlFor(sample.lat, sample.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-muted-foreground hover:underline inline-flex items-center gap-0.5 shrink-0 mt-1"
                  title="Открыть превью-ссылку"
                >
                  превью
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

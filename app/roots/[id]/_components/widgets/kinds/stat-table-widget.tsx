"use client";

import { useTranslations } from "next-intl";
import type { StatTableData } from "@/lib/server/widgets/types";

export function StatTableWidget({
  data,
}: {
  rootId: string;
  data: StatTableData;
  readonly?: boolean;
  onPatch?: (next: StatTableData) => Promise<void> | void;
}) {
  const t = useTranslations("roots");
  const rows = data.rows ?? [];
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("statTableWidget.empty")}</p>;
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        {data.columns && data.columns.length > 0 && (
          <thead>
            <tr className="border-b">
              {data.columns.map((c, i) => (
                <th
                  key={i}
                  className="text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1.5 py-1.5"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-dashed last:border-b-0 hover:bg-accent/30"
            >
              {row.map((cell, ci) => (
                <td key={ci} className="px-1.5 py-1.5 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

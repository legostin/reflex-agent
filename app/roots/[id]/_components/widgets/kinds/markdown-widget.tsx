"use client";

import type { MarkdownData } from "@/lib/server/widgets/types";
import { MarkdownView } from "../../markdown-view";

export function MarkdownWidget({
  data,
}: {
  rootId: string;
  data: MarkdownData;
  readonly?: boolean;
  onPatch?: (next: MarkdownData) => Promise<void> | void;
}) {
  // Markdown bodies are agent-authored — inline editing would clash with
  // the "edit via chat" model. Stays read-only on the dashboard.
  return (
    <div className="text-sm">
      <MarkdownView source={data.body ?? ""} />
    </div>
  );
}

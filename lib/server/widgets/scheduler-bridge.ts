import "server-only";
import { readWidgetMemoryFile } from "./store";
import type { WidgetRecord } from "./types";

/**
 * Build the synthetic user-message that drives a widget refresh turn.
 * Shared between the auto-scheduler and the manual "refresh now" button
 * so both code paths produce identical prompts and the agent sees the
 * same instructions either way.
 */
export async function buildRefreshPromptForWidget(
  rootPath: string,
  widget: WidgetRecord,
): Promise<string> {
  const memoryFileBody = widget.memoryFile
    ? await readWidgetMemoryFile(rootPath, widget.memoryFile)
    : null;
  const lines: string[] = [];
  lines.push(
    `[Reflex auto-refresh] Widget "${widget.title}" (id: \`${widget.id}\`, kind: \`${widget.kind}\`) is due for an update.`,
  );
  lines.push("");
  lines.push("Current widget data:");
  lines.push("```json");
  lines.push(JSON.stringify(widget.data, null, 2));
  lines.push("```");
  lines.push("");
  if (widget.memory && widget.memory.trim()) {
    lines.push("Current inline memory:");
    lines.push("```");
    lines.push(widget.memory);
    lines.push("```");
    lines.push("");
  }
  if (widget.memoryFile) {
    lines.push(`Memory file: \`${widget.memoryFile}\``);
    if (memoryFileBody && memoryFileBody.trim()) {
      lines.push("```markdown");
      lines.push(memoryFileBody.slice(0, 4000));
      lines.push("```");
    } else {
      lines.push("_(file is empty or does not exist — create it on the first update)_");
    }
    lines.push("");
  }
  lines.push("What to do:");
  lines.push(
    `- Emit \`<<reflex:widget-update>>\` with id="${widget.id}" and fresh data.`,
  );
  lines.push(
    "- If `memory` exists, update its contents (dedup links, value history, etc.). Do not reset it to empty.",
  );
  if (widget.memoryFile) {
    lines.push(
      `- If it makes sense, append to memoryFile (\`${widget.memoryFile}\`) via \`<<reflex:kb>>\` (kind="widget-memory", title="<title>"). Do not duplicate the widget's own data there.`,
    );
  }
  lines.push(
    "- Keep the chat reply short (one line) — this is an automatic refresh, no extended commentary needed.",
  );
  lines.push(
    `- Cadence: \`${widget.refresh ?? "manual"}\`. Do not change it without an explicit request.`,
  );
  return lines.join("\n");
}

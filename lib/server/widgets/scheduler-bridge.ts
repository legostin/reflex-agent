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
    `[Reflex auto-refresh] Виджет «${widget.title}» (id: \`${widget.id}\`, kind: \`${widget.kind}\`) пришло время обновить.`,
  );
  lines.push("");
  lines.push("Текущие данные виджета:");
  lines.push("```json");
  lines.push(JSON.stringify(widget.data, null, 2));
  lines.push("```");
  lines.push("");
  if (widget.memory && widget.memory.trim()) {
    lines.push("Текущая inline-memory:");
    lines.push("```");
    lines.push(widget.memory);
    lines.push("```");
    lines.push("");
  }
  if (widget.memoryFile) {
    lines.push(`Memory-файл: \`${widget.memoryFile}\``);
    if (memoryFileBody && memoryFileBody.trim()) {
      lines.push("```markdown");
      lines.push(memoryFileBody.slice(0, 4000));
      lines.push("```");
    } else {
      lines.push("_(файл пуст или не существует — создашь при первом апдейте)_");
    }
    lines.push("");
  }
  lines.push("Что сделать:");
  lines.push(
    `- Эмитни \`<<reflex:widget-update>>\` с id="${widget.id}" и свежими данными.`,
  );
  lines.push(
    "- Если есть `memory` — обнови её содержимое (дедуп ссылок, история значений и т.п.). Не сбрасывай в ноль.",
  );
  if (widget.memoryFile) {
    lines.push(
      `- Если есть смысл — допиши в memoryFile (\`${widget.memoryFile}\`) через \`<<reflex:kb>>\` (kind="widget-memory", title="<заголовок>"). Не дублируй там содержимое самого виджета.`,
    );
  }
  lines.push(
    "- В чат отвечай коротко (одна строка) — это автоматический рефреш, развёрнутый комментарий не нужен.",
  );
  lines.push(
    `- Cadence: \`${widget.refresh ?? "manual"}\`. Не меняй её без явной просьбы.`,
  );
  return lines.join("\n");
}

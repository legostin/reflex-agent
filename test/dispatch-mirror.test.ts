import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The dispatcher notify funnel (model B): dispatch() records ONE line in the
 * dispatcher thread; the mirror forwards new notification lines to channels via
 * a cursor (seeds silently on first run, at-most-once, idempotent). Temp
 * REFLEX_HOME.
 */

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "reflex-dispatch-"));
  process.env.REFLEX_HOME = home;
});
afterAll(async () => {
  if (home) await fs.rm(home, { recursive: true, force: true });
});

const NOTE = (e: { type: string; subtype?: string }) =>
  e.type === "system" && e.subtype === "notification";

describe("dispatch()", () => {
  it("records one notification line in the dispatcher thread", async () => {
    const { dispatch } = await import("@/lib/server/home/dispatch");
    const { getDispatcherTopic } = await import("@/lib/server/home/dispatcher");
    const { readEvents } = await import("@/lib/server/agents/events-log");

    await dispatch({ title: "Loose ends", body: "you owe Lena a reply" });

    const d = await getDispatcherTopic();
    const notes = (await readEvents(d.rootPath, d.topicId)).filter((e) =>
      NOTE(e as { type: string; subtype?: string }),
    );
    expect(notes.length).toBe(1);
    const text = (notes[0] as { text?: string }).text ?? "";
    expect(text).toContain("you owe Lena a reply");
    expect(text).toContain("Loose ends");
    // Let dispatch()'s fire-and-forget mirror settle so it doesn't leak the
    // module-level guard into the next test.
    await new Promise((r) => setTimeout(r, 200));
  }, 30_000);
});

describe("mirrorDispatcher()", () => {
  it("seeds silently, then forwards new lines once (cursor idempotent)", async () => {
    const { mirrorDispatcher } = await import("@/lib/server/home/dispatch");
    const { getDispatcherTopic } = await import("@/lib/server/home/dispatcher");
    const { appendEventSeq, readEvents } = await import(
      "@/lib/server/agents/events-log",
    );

    const d = await getDispatcherTopic();
    const cursorFile = path.join(d.rootPath, "dispatcher-mirror.json");
    const len = async () => (await readEvents(d.rootPath, d.topicId)).length;
    const cursor = async () =>
      JSON.parse(await fs.readFile(cursorFile, "utf8")).mirroredCount as number;

    // First run seeds the cursor to the current end — never dumps history.
    await mirrorDispatcher();
    expect(await cursor()).toBe(await len());

    // A new notification line appended directly (bypassing dispatch's inline
    // mirror so the cursor math is deterministic).
    await appendEventSeq(d.rootPath, d.topicId, {
      type: "system",
      subtype: "notification",
      text: "morning digest",
      agentId: "test",
      ts: new Date().toISOString(),
      seq: 0,
    });

    // Mirror catches up to end-of-log (forwards the new line, no real channel
    // configured so the send is a no-op — we assert the cursor advanced).
    await mirrorDispatcher();
    const after = await len();
    expect(await cursor()).toBe(after);

    // Idempotent: a second run neither advances nor throws.
    await mirrorDispatcher();
    expect(await cursor()).toBe(after);
  }, 30_000);
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HostContext } from "@/lib/server/utilities/host-api";

/**
 * Stage 3 posture: when settings.sharing.requireScopedReads is on, the blanket
 * kb.list / kb.read are narrowed to the caller's OWN entries plus those it
 * holds a live data grant for. Isolated in its own file because the settings
 * store freezes its path at import — settings.json must exist before host-api
 * is first imported.
 */

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "reflex-scoped-"));
  process.env.REFLEX_HOME = home;
});
afterAll(async () => {
  if (home) await fs.rm(home, { recursive: true, force: true });
});

async function writeKb(spaceDir: string, kind: string, name: string, createdBy: string, title: string) {
  const dir = path.join(spaceDir, ".reflex", kind);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, name),
    `---\ntitle: ${title}\nkind: ${kind}\ncreatedBy: ${createdBy}\n---\n${title} body\n`,
    "utf8",
  );
}

describe("requireScopedReads posture (Stage 3)", () => {
  it("narrows blanket kb.list / kb.read to self-owned + granted", async () => {
    // Turn the posture ON before importing host-api (settings path is frozen
    // at module import).
    await fs.writeFile(
      path.join(home, "settings.json"),
      JSON.stringify({ version: 1, sharing: { requireScopedReads: true } }),
      "utf8",
    );

    const reg = await import("@/lib/registry");
    const { ManifestSchema } = await import("@/lib/server/utilities/types");
    const gs = await import("@/lib/server/utilities/grant-store");
    const { dispatchHostCall } = await import("@/lib/server/utilities/host-api");

    const spaceDir = await fs.mkdtemp(path.join(home, "space-"));
    const root = await reg.addRoot(spaceDir);
    await writeKb(spaceDir, "task", "real.md", "utility:task-board@1.0.0", "A task");
    await writeKb(spaceDir, "draft", "mine.md", "utility:writer-studio@0.1.0", "My draft");
    await writeKb(spaceDir, "note", "secret.md", "utility:vault@1.0.0", "Private note");

    const m = ManifestSchema.parse({
      id: "writer-studio",
      name: "Writer Studio",
      version: "0.1.0",
      permissions: { kb: { read: true } },
    });
    const ctx: HostContext = {
      utility: { scope: "project", rootId: root.id, dir: "/x", manifest: m, bundleAvailable: false },
      channel: "iframe",
    };

    // Self-owned only — task (other utility) and note (other utility) hidden.
    let list = (await dispatchHostCall(ctx, "kb.list", { rootId: root.id })) as Array<{
      relPath: string;
    }>;
    expect(list.map((x) => x.relPath).sort()).toEqual(["draft/mine.md"]);

    // Grant task-board:task → its task entry becomes visible; note still hidden.
    await gs.createGrant({
      consumer: "writer-studio",
      provider: "task-board",
      plane: "data",
      selector: "task",
      scope: root.id,
    });
    list = (await dispatchHostCall(ctx, "kb.list", { rootId: root.id })) as Array<{
      relPath: string;
    }>;
    expect(list.map((x) => x.relPath).sort()).toEqual(["draft/mine.md", "task/real.md"]);
    expect(list.map((x) => x.relPath)).not.toContain("note/secret.md");

    // Blanket read of an ungranted foreign entry is denied under the posture.
    await expect(
      dispatchHostCall(ctx, "kb.read", { relPath: "note/secret.md", rootId: root.id }),
    ).rejects.toThrow(/requireScopedReads/);

    // Self-owned read still works.
    const r = (await dispatchHostCall(ctx, "kb.read", {
      relPath: "draft/mine.md",
      rootId: root.id,
    })) as { content: string };
    expect(r.content).toContain("My draft");
  });
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HostContext } from "@/lib/server/utilities/host-api";

/**
 * Share Plane end-to-end (DATA plane), driven through the real dispatchHostCall
 * — the same entry the iframe/worker use. Proves the writer-studio ↔ task-board
 * flow: a consumer reads ONLY the provider's owned entries, only with a live
 * grant, and can never read a forged entry or an ungranted kind. (Stage 2.)
 */

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "reflex-flow-"));
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

describe("Share Plane end-to-end (DATA plane)", () => {
  it("reads only the provider's owned entries, gated by a live grant", async () => {
    const reg = await import("@/lib/registry");
    const { ManifestSchema } = await import("@/lib/server/utilities/types");
    const gs = await import("@/lib/server/utilities/grant-store");
    const pd = await import("@/lib/server/utilities/provider-directory");
    const { dispatchHostCall } = await import("@/lib/server/utilities/host-api");

    const spaceDir = await fs.mkdtemp(path.join(home, "space-"));
    const root = await reg.addRoot(spaceDir);

    // task-board owns kind:task; one real task + one forged by another utility.
    await writeKb(spaceDir, "task", "real.md", "utility:task-board@1.0.0", "Write launch post");
    await writeKb(spaceDir, "task", "forged.md", "utility:evil@9.9.9", "Forged task");
    await pd.rebuildProviderDirectory([
      {
        id: "task-board",
        scope: "project",
        rootId: root.id,
        version: "1.0.0",
        provides: { data: [{ kind: "task", read: true }] },
      },
    ]);

    const consumer = ManifestSchema.parse({
      id: "writer-studio",
      name: "Writer Studio",
      version: "0.1.0",
      permissions: { shares: { consume: true } },
      consumes: { data: [{ provider: "task-board", kind: "task", reason: "draft per task" }] },
    });
    const ctx: HostContext = {
      utility: {
        scope: "project",
        rootId: root.id,
        dir: path.join(spaceDir, ".reflex", "utilities", "writer-studio"),
        manifest: consumer,
        bundleAvailable: false,
      },
      channel: "iframe",
    };

    const listArgs = { provider: "task-board", kind: "task", rootId: root.id };

    // 1. No grant → denied.
    await expect(dispatchHostCall(ctx, "kb.scopedList", listArgs)).rejects.toThrow(
      /grant_required/,
    );

    // 2. Grant the DATA plane.
    await gs.createGrant({
      consumer: "writer-studio",
      provider: "task-board",
      plane: "data",
      selector: "task",
      scope: root.id,
    });

    // 3. Lists ONLY task-board's owned entry — the forged one is filtered out.
    const list = (await dispatchHostCall(ctx, "kb.scopedList", listArgs)) as Array<{
      relPath: string;
    }>;
    expect(list.map((x) => x.relPath)).toEqual(["task/real.md"]);

    // 4. Reading the owned entry works; the forged one is refused.
    const read = (await dispatchHostCall(ctx, "kb.scopedRead", {
      ...listArgs,
      relPath: "task/real.md",
    })) as { content: string };
    expect(read.content).toContain("Write launch post body");
    await expect(
      dispatchHostCall(ctx, "kb.scopedRead", { ...listArgs, relPath: "task/forged.md" }),
    ).rejects.toThrow(/not owned/);

    // 5. An ungranted kind is denied even though the consumer can name it.
    await expect(
      dispatchHostCall(ctx, "kb.scopedList", { provider: "task-board", kind: "note", rootId: root.id }),
    ).rejects.toThrow(/grant_required/);

    // 6. Without shares.consume the whole path is denied.
    const noConsume = ManifestSchema.parse({
      id: "nosy",
      name: "Nosy",
      version: "0.1.0",
      permissions: {},
    });
    const nosyCtx: HostContext = { ...ctx, utility: { ...ctx.utility, manifest: noConsume } };
    await gs.createGrant({
      consumer: "nosy",
      provider: "task-board",
      plane: "data",
      selector: "task",
      scope: root.id,
    });
    await expect(dispatchHostCall(nosyCtx, "kb.scopedList", listArgs)).rejects.toThrow(
      /shares\.consume/,
    );
  });
});

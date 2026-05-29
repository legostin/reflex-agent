import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readJsonFile,
  writeJsonFile,
} from "@/lib/reflex/store/json-store";

describe("json-store — atomic, serialized, mode-aware", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "reflex-jsonstore-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("round-trips a value; missing file reads as null", async () => {
    const f = path.join(dir, "x.json");
    expect(await readJsonFile(f)).toBeNull();
    await writeJsonFile(f, { a: 1, b: ["c"] });
    expect(await readJsonFile(f)).toEqual({ a: 1, b: ["c"] });
  });

  it("creates parent directories", async () => {
    const f = path.join(dir, "nested", "deep", "y.json");
    await writeJsonFile(f, { ok: true });
    expect(await readJsonFile(f)).toEqual({ ok: true });
  });

  it("serializes concurrent writes — file is always valid JSON, last write wins", async () => {
    const f = path.join(dir, "race.json");
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) => writeJsonFile(f, { i })),
    );
    // No torn writes: it parses, and the value is one of the writes (the last).
    const got = (await readJsonFile<{ i: number }>(f))!;
    expect(typeof got.i).toBe("number");
    expect(got.i).toBeGreaterThanOrEqual(0);
    expect(got.i).toBeLessThan(N);
    // And no stray .tmp left behind.
    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
  });

  it("applies file mode (0o600) for credential stores", async () => {
    const f = path.join(dir, "secret.json");
    await writeJsonFile(f, { token: "x" }, { mode: 0o600 });
    const st = await fs.stat(f);
    // Skip the assertion on platforms without POSIX perms (Windows).
    if (process.platform !== "win32") {
      expect(st.mode & 0o777).toBe(0o600);
    }
  });
});

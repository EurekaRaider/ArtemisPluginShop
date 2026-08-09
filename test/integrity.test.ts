import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The release scripts are plain ESM so they can run before TypeScript compilation.
// @ts-expect-error JavaScript release helper intentionally has no declaration file.
import { collectPlugin, resolvePluginPath } from "../scripts/integrity-lib.mjs";

describe("marketplace integrity", () => {
  it("rejects marketplace path traversal", () => {
    expect(() =>
      resolvePluginPath("/repository", "./plugins/../../outside"),
    ).toThrow(/escapes plugins/);
  });

  it("rejects symbolic links in plugin packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-integrity-"));
    const plugin = join(root, "plugin");
    await mkdir(plugin);
    await writeFile(join(root, "outside.txt"), "secret");
    await symlink(join(root, "outside.txt"), join(plugin, "linked.txt"));
    await expect(collectPlugin(plugin)).rejects.toThrow(
      /Symbolic links are not allowed/,
    );
  });
});

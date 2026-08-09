import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("published security contract", () => {
  it("does not expose permanent Gmail deletion or settings tools", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../src/gmail/server.ts"),
      "utf8",
    );
    expect(source).not.toContain("gmail_delete_message");
    expect(source).not.toContain("batchDelete");
    expect(source).not.toContain("/settings/");
    expect(source).not.toContain("mail.google.com");
  });

  it("declares only host-provided Google authentication", async () => {
    for (const plugin of ["google-workspace", "gmail"]) {
      const manifest = JSON.parse(
        await readFile(
          resolve(import.meta.dirname, `../plugins/${plugin}/.mcp.json`),
          "utf8",
        ),
      );
      const config = manifest.mcpServers[plugin];
      expect(config.command).toBe("${ARTEMIS_NODE}");
      expect(config["x-artemis"].auth.provider).toBe("google");
      expect(config.env).toBeUndefined();
    }
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  validateConnectorDefinition,
  assertConnectorTransport,
} from "../src/shared/connector-contract.js";

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

  it("validates every marketplace connector against the host contract", async () => {
    const marketplace = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, "../.agents/plugins/marketplace.json"),
        "utf8",
      ),
    );
    for (const entry of marketplace.plugins) {
      const mcp = JSON.parse(
        await readFile(
          resolve(import.meta.dirname, `../plugins/${entry.name}/.mcp.json`),
          "utf8",
        ),
      );
      const configs = Object.values(mcp.mcpServers) as Array<
        Record<string, any>
      >;
      expect(configs).toHaveLength(1);
      const config = configs[0]!;
      const declaration = validateConnectorDefinition(
        config["x-artemis"].connector,
      );
      expect(declaration.id).toBe(entry.name);
      expect(() =>
        assertConnectorTransport(
          declaration,
          config.command ? "stdio" : "streamable-http",
          config.url,
        ),
      ).not.toThrow();
    }
  });
  it("declares versioned connector authentication", async () => {
    for (const plugin of ["google-workspace", "gmail"]) {
      const manifest = JSON.parse(
        await readFile(
          resolve(import.meta.dirname, `../plugins/${plugin}/.mcp.json`),
          "utf8",
        ),
      );
      const config = manifest.mcpServers[plugin];
      expect(config.command).toBe("${ARTEMIS_NODE}");
      expect(config["x-artemis"].connector.provider).toBe("google");
      expect(config.env).toBeUndefined();
    }
  });
});

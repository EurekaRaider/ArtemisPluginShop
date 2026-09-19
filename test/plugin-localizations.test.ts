import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// @ts-expect-error JavaScript release helper intentionally has no declaration file.
import * as pluginI18n from "../scripts/plugin-localizations.mjs";

const { pluginLocales, verifyPluginLocalizations } = pluginI18n;

const root = new URL("../", import.meta.url);
const marketplace = JSON.parse(
  await readFile(new URL(".agents/plugins/marketplace.json", root), "utf8"),
);
const manifests = await Promise.all(
  marketplace.plugins.map(async (plugin: { name: string }) =>
    JSON.parse(
      await readFile(
        new URL(`plugins/${plugin.name}/.codex-plugin/plugin.json`, root),
        "utf8",
      ),
    ),
  ),
);

describe("plugin translations", () => {
  it.each(manifests)(
    "ships complete translated metadata for $name",
    (manifest) => {
      expect(pluginLocales).toHaveLength(14);
      expect(() => verifyPluginLocalizations(manifest)).not.toThrow();
    },
  );

  it("prevents missing translations and accidental English fallback from being signed off", () => {
    const manifest = structuredClone(manifests[0]);
    delete manifest.localizations["zh-TW"];
    expect(() => verifyPluginLocalizations(manifest)).toThrow(
      /14 Artemis languages/,
    );
    manifest.localizations["zh-TW"] = manifest.localizations.en;
    expect(() => verifyPluginLocalizations(manifest)).toThrow(
      /14 Artemis languages/,
    );
  });

  it("rejects oversized translated display text", () => {
    const manifest = structuredClone(manifests[0]);
    manifest.localizations.ja.displayName = "字".repeat(121);
    expect(() => verifyPluginLocalizations(manifest)).toThrow(
      /14 Artemis languages/,
    );
  });
});

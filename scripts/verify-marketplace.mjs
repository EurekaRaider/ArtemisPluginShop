import {
  validateConnectorDefinition,
  assertConnectorTransport,
} from "../src/shared/connector-contract.ts";
import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalJson,
  collectPlugin,
  resolvePluginPath,
  sha256,
} from "./integrity-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const marketplaceBytes = await readFile(
  resolve(root, ".agents/plugins/marketplace.json"),
);
const marketplace = JSON.parse(marketplaceBytes.toString("utf8"));
const packageMetadata = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const integrity = JSON.parse(
  await readFile(resolve(root, ".artemis/integrity.json"), "utf8"),
);

if (integrity.schemaVersion !== 1)
  throw new Error("Unsupported integrity schema version.");
if (integrity.signatureAlgorithm !== "Ed25519")
  throw new Error("Only Ed25519 signatures are accepted.");
if (integrity.marketplaceName !== marketplace.name)
  throw new Error("Marketplace name does not match integrity data.");
if (integrity.marketplaceHash !== sha256(marketplaceBytes))
  throw new Error("Marketplace manifest hash mismatch.");
if (integrity.sourceUrl !== packageMetadata.repository?.url)
  throw new Error("Offline package GitHub source URL mismatch.");
if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0)
  throw new Error("Marketplace has no plugins.");

const unsigned = { ...integrity };
delete unsigned.signature;
const publicDer = Buffer.from(integrity.publicKey, "base64");
if (sha256(publicDer) !== integrity.signingKeyFingerprint)
  throw new Error("Signing key fingerprint mismatch.");
const publicKey = createPublicKey({
  key: publicDer,
  format: "der",
  type: "spki",
});
if (
  !verify(
    null,
    Buffer.from(canonicalJson(unsigned)),
    publicKey,
    Buffer.from(integrity.signature, "base64"),
  )
) {
  throw new Error("Marketplace signature is invalid.");
}

const signedPlugins = new Map(
  integrity.plugins.map((plugin) => [plugin.name, plugin]),
);
for (const entry of marketplace.plugins) {
  if (
    entry.policy?.installation !== "AVAILABLE" ||
    entry.policy?.authentication !== "ON_INSTALL"
  ) {
    throw new Error(`Plugin ${entry.name} has invalid marketplace policy.`);
  }
  if (
    !["Productivity", "Communication", "Development", "Design"].includes(
      entry.category,
    )
  )
    throw new Error(`Plugin ${entry.name} has invalid category.`);
  const pluginRoot = resolvePluginPath(root, entry.source);
  const manifest = JSON.parse(
    await readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
  );
  if (manifest.name !== entry.name)
    throw new Error(`Plugin name mismatch for ${entry.name}.`);
  const mcp = JSON.parse(
    await readFile(resolve(pluginRoot, ".mcp.json"), "utf8"),
  );
  const servers = Object.values(mcp.mcpServers ?? {});
  if (servers.length !== 1)
    throw new Error("Each plugin must declare exactly one connector runtime.");
  const declaration = servers[0]["x-artemis"]?.connector;
  if (
    !declaration ||
    declaration.version !== 1 ||
    declaration.id !== entry.name ||
    servers[0]["x-artemis"].auth !== undefined
  )
    throw new Error(`Invalid connector contract: ${entry.name}`);
  if (
    JSON.stringify(mcp).match(
      /"(?:accessToken|refreshToken|appPassword|clientSecret|client_secret)"\s*:/u,
    )
  )
    throw new Error("Credentials cannot be published in connector packages.");
  const validated = validateConnectorDefinition(declaration);
  assertConnectorTransport(
    validated,
    servers[0].command ? "stdio" : "streamable-http",
    servers[0].url,
  );
  if (
    servers[0].command &&
    (servers[0].command !== "${ARTEMIS_NODE}" ||
      JSON.stringify(servers[0].args) !==
        JSON.stringify(["${PLUGIN_ROOT}/runtime/server.mjs"]))
  )
    throw new Error("Local connectors must use the bundled runtime.");
  if (servers[0].env || servers[0].headers)
    throw new Error("Connector credentials must be supplied by the host.");
  const collected = await collectPlugin(pluginRoot);
  const signed = signedPlugins.get(entry.name);
  if (
    !signed ||
    signed.version !== manifest.version ||
    signed.contentHash !== collected.contentHash
  ) {
    throw new Error(`Plugin content hash mismatch for ${entry.name}.`);
  }
  if (
    signed.size !== collected.size ||
    canonicalJson(signed.files) !== canonicalJson(collected.files)
  ) {
    throw new Error(`Plugin file list mismatch for ${entry.name}.`);
  }
}

if (signedPlugins.size !== marketplace.plugins.length)
  throw new Error("Integrity data has unexpected plugins.");
console.log(
  `Verified ${marketplace.plugins.length} signed plugins (${integrity.signingKeyFingerprint}).`,
);

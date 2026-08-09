import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  canonicalJson,
  collectPlugin,
  resolvePluginPath,
  sha256,
} from "./integrity-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const keyPath = resolve(
  process.env.ARTEMIS_MARKETPLACE_SIGNING_KEY ??
    resolve(root, ".artemis/signing-key.pem"),
);
const generateKey = process.argv.includes("--generate-key");

if (generateKey) {
  const { privateKey } = generateKeyPairSync("ed25519");
  await mkdir(dirname(keyPath), { recursive: true });
  await writeFile(
    keyPath,
    privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600, flag: "wx" },
  );
}

const privateKey = createPrivateKey(await readFile(keyPath));
await chmod(keyPath, 0o600);
const publicKey = createPublicKey(privateKey);
const publicDer = publicKey.export({ format: "der", type: "spki" });
const marketplaceBytes = await readFile(
  resolve(root, ".agents/plugins/marketplace.json"),
);
const marketplace = JSON.parse(marketplaceBytes.toString("utf8"));
const packageMetadata = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const sourceUrl = packageMetadata.repository?.url;
if (
  typeof sourceUrl !== "string" ||
  !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/u.test(
    sourceUrl,
  )
) {
  throw new Error(
    "package.json must declare the public GitHub repository URL.",
  );
}

const plugins = [];
for (const entry of marketplace.plugins ?? []) {
  const pluginRoot = resolvePluginPath(root, entry.source);
  const manifest = JSON.parse(
    await readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
  );
  plugins.push({
    name: entry.name,
    version: manifest.version,
    ...(await collectPlugin(pluginRoot)),
  });
}
plugins.sort((left, right) => left.name.localeCompare(right.name, "en"));

const unsigned = {
  schemaVersion: 1,
  marketplaceName: marketplace.name,
  marketplaceHash: sha256(marketplaceBytes),
  signatureAlgorithm: "Ed25519",
  publicKey: Buffer.from(publicDer).toString("base64"),
  signingKeyFingerprint: sha256(publicDer),
  signedAt: new Date().toISOString(),
  sourceUrl,
  plugins,
};
const signature = sign(
  null,
  Buffer.from(canonicalJson(unsigned)),
  privateKey,
).toString("base64");
await writeFile(
  resolve(root, ".artemis/integrity.json"),
  `${JSON.stringify({ ...unsigned, signature }, null, 2)}\n`,
);
console.log(
  `Signed ${plugins.length} plugins with ${unsigned.signingKeyFingerprint}.`,
);

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

import { c as createTar } from "tar";

const root = resolve(import.meta.dirname, "..");
const metadata = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const marketplace = JSON.parse(
  await readFile(resolve(root, ".agents/plugins/marketplace.json"), "utf8"),
);
const integrity = JSON.parse(
  await readFile(resolve(root, ".artemis/integrity.json"), "utf8"),
);
const packageName = `ArtemisPluginShop-offline-${metadata.version}`;
const outputDirectory = resolve(root, "dist");
const outputPath = resolve(outputDirectory, `${packageName}.tar.gz`);
const stage = await mkdtemp(resolve(tmpdir(), "artemis-plugin-shop-offline-"));
const packageRoot = resolve(stage, packageName);

function safeRelativePath(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe offline package path: ${value}`);
  }
  return normalized;
}

const marketplaceSources = new Map(
  marketplace.plugins.map((entry) => [
    entry.name,
    safeRelativePath(entry.source?.path ?? entry.source),
  ]),
);
const files = new Set([
  ".agents/plugins/marketplace.json",
  ".artemis/integrity.json",
]);
for (const plugin of integrity.plugins ?? []) {
  const pluginRoot = marketplaceSources.get(plugin.name);
  if (!pluginRoot || !Array.isArray(plugin.files)) {
    throw new Error(
      `Signed plugin is missing from the marketplace: ${plugin.name}`,
    );
  }
  for (const file of plugin.files) {
    files.add(`${pluginRoot}/${safeRelativePath(file.path)}`);
  }
}

try {
  for (const relativePath of [...files].sort()) {
    const source = resolve(root, relativePath);
    const destination = resolve(packageRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await mkdir(outputDirectory, { recursive: true });
  await rm(outputPath, { force: true });
  await createTar(
    {
      cwd: stage,
      file: outputPath,
      gzip: true,
      noMtime: true,
      portable: true,
      strict: true,
    },
    [packageName],
  );
  const archive = await readFile(outputPath);
  const digest = createHash("sha256").update(archive).digest("hex");
  await writeFile(
    `${outputPath}.sha256`,
    `${digest}  ${basename(outputPath)}\n`,
  );
  console.log(`${outputPath}\nSHA-256 ${digest}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}

import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";

import { x as extractTar } from "tar";

import { resolvePluginPath } from "./integrity-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const marketplace = JSON.parse(
  await readFile(resolve(root, ".agents/plugins/marketplace.json"), "utf8"),
);
const sourcePaths = [
  ".agents/plugins/marketplace.json",
  ".artemis/integrity.json",
  ...marketplace.plugins.map((entry) =>
    relative(root, resolvePluginPath(root, entry.source)).split(sep).join("/"),
  ),
];
const metadata = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const archivePath = resolve(
  process.argv[2] ??
    resolve(
      root,
      "dist",
      `ArtemisPluginShop-offline-${metadata.version}.tar.gz`,
    ),
);
const expectedDigest = (await readFile(`${archivePath}.sha256`, "utf8")).split(
  /\s+/u,
)[0];
const archive = await readFile(archivePath);
const actualDigest = createHash("sha256").update(archive).digest("hex");
if (actualDigest !== expectedDigest) {
  throw new Error("Offline package checksum mismatch.");
}

const stage = await mkdtemp(resolve(tmpdir(), "verify-artemis-offline-"));
const extracted = stage;
const sourceFiles = await collectFiles(root, true);

try {
  await extractTar({
    cwd: stage,
    file: archivePath,
    preserveOwner: false,
    strict: true,
    strip: 1,
  });
  const packagedFiles = await collectFiles(extracted, false);
  if (packagedFiles.has(".artemis/signing-key.pem")) {
    throw new Error("Offline package contains the private signing key.");
  }
  if (sourceFiles.size !== packagedFiles.size) {
    throw new Error(
      "Offline package file list does not match signed contents.",
    );
  }
  for (const [path, hash] of sourceFiles) {
    if (packagedFiles.get(path) !== hash) {
      throw new Error(`Offline package content mismatch: ${path}`);
    }
  }
  console.log(
    `Verified ${basename(archivePath)} (${packagedFiles.size} files, ${actualDigest}).`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}

async function collectFiles(directory, sourceMode) {
  const files = new Map();
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      const relativePath = relative(directory, path).split(sep).join("/");
      if (
        sourceMode &&
        !sourcePaths.some(
          (allowed) =>
            relativePath === allowed ||
            relativePath.startsWith(`${allowed}/`) ||
            allowed.startsWith(`${relativePath}/`),
        )
      ) {
        continue;
      }
      const information = await lstat(path);
      if (information.isSymbolicLink()) {
        throw new Error(
          `Offline package contains a symbolic link: ${entry.name}`,
        );
      }
      if (information.isDirectory()) {
        await visit(path);
      } else if (information.isFile()) {
        const data = await readFile(path);
        files.set(
          relativePath,
          createHash("sha256").update(data).digest("hex"),
        );
      }
    }
  };
  await visit(directory);
  return files;
}

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export const MAX_PLUGIN_BYTES = 25 * 1024 * 1024;
export const MAX_PLUGIN_FILES = 500;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function collectPlugin(pluginRoot) {
  const absoluteRoot = resolve(pluginRoot);
  const canonicalRoot = await realpath(absoluteRoot);
  const files = [];
  await walk(absoluteRoot, absoluteRoot, canonicalRoot, files);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (files.length > MAX_PLUGIN_FILES)
    throw new Error(`Plugin has more than ${MAX_PLUGIN_FILES} files.`);
  const size = files.reduce((sum, file) => sum + file.size, 0);
  if (size > MAX_PLUGIN_BYTES)
    throw new Error(`Plugin exceeds ${MAX_PLUGIN_BYTES} bytes.`);

  const digest = createHash("sha256");
  for (const file of files)
    digest.update(file.path).update("\0").update(file.sha256).update("\0");
  return { contentHash: digest.digest("hex"), size, files };
}

async function walk(directory, root, canonicalRoot, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error(
        `Symbolic links are not allowed: ${relative(root, path)}`,
      );
    const canonicalPath = await realpath(path);
    if (
      canonicalPath !== canonicalRoot &&
      !canonicalPath.startsWith(`${canonicalRoot}${sep}`)
    ) {
      throw new Error(`Path escapes plugin root: ${relative(root, path)}`);
    }
    if (stat.isDirectory()) {
      await walk(path, root, canonicalRoot, files);
    } else if (stat.isFile()) {
      const data = await readFile(path);
      files.push({
        path: relative(root, path).split(sep).join("/"),
        size: data.byteLength,
        sha256: sha256(data),
      });
    } else {
      throw new Error(`Unsupported filesystem entry: ${relative(root, path)}`);
    }
  }
}

export function resolvePluginPath(repositoryRoot, source) {
  const path =
    typeof source === "string"
      ? source
      : source?.source === "local"
        ? source.path
        : undefined;
  if (typeof path !== "string" || !path.startsWith("./")) {
    throw new Error(
      `Marketplace source must be a repository-relative path: ${String(source)}`,
    );
  }
  const pluginPath = resolve(repositoryRoot, path);
  const pluginsRoot = resolve(repositoryRoot, "plugins");
  if (
    pluginPath !== pluginsRoot &&
    !pluginPath.startsWith(`${pluginsRoot}${sep}`)
  ) {
    throw new Error(`Marketplace source escapes plugins/: ${path}`);
  }
  return pluginPath;
}

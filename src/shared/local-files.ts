import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const MAX_LOCAL_FILE_BYTES = 25 * 1024 * 1024;

export async function readWorkspaceFile(path: string): Promise<Uint8Array> {
  const absolutePath = workspacePath(path);
  const data = await readFile(absolutePath);
  if (data.byteLength > MAX_LOCAL_FILE_BYTES) {
    throw new Error("Local file exceeds the 25 MiB plugin transfer limit.");
  }
  return data;
}

export async function writeWorkspaceFile(
  path: string,
  data: Uint8Array,
): Promise<string> {
  if (data.byteLength > MAX_LOCAL_FILE_BYTES) {
    throw new Error(
      "Downloaded file exceeds the 25 MiB plugin transfer limit.",
    );
  }
  const absolutePath = workspacePath(path);
  await writeFile(absolutePath, data, { flag: "wx" });
  return absolutePath;
}

function workspacePath(path: string): string {
  const root = resolve(process.cwd());
  const target = resolve(root, path);
  const child = relative(root, target);
  if (
    isAbsolute(child) ||
    child === ".." ||
    child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(
      "Local file path must stay inside the active Artemis workspace.",
    );
  }
  return target;
}

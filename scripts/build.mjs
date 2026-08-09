import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const targets = [
  [
    "src/google-workspace/server.ts",
    "plugins/google-workspace/runtime/server.mjs",
  ],
  ["src/gmail/server.ts", "plugins/gmail/runtime/server.mjs"],
];

for (const [entry, output] of targets) {
  const outfile = resolve(root, output);
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(root, entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: false,
    legalComments: "none",
    sourcemap: false,
    banner: {
      js: "// Generated from this repository; no install-time dependencies are required.",
    },
  });
  const generated = await readFile(outfile, "utf8");
  const normalized = generated.replace(/[\t ]+$/gmu, "");
  if (normalized !== generated) await writeFile(outfile, normalized);
}

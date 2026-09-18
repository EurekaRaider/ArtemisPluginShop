import { localPlugins } from "./plugin-builds.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const targets = localPlugins.map((name) => [
  `src/${name}/server.ts`,
  `plugins/${name}/runtime/server.mjs`,
]);

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
      js: "// Generated; no install-time dependencies.\nimport { createRequire as artemisCreateRequire } from 'node:module'; const require = artemisCreateRequire(import.meta.url);",
    },
  });
  const generated = await readFile(outfile, "utf8");
  const normalized = generated.replace(/[\t ]+$/gmu, "");
  if (normalized !== generated) await writeFile(outfile, normalized);
}

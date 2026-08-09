import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const requireArm64 = process.argv.includes("--require-arm64");
if (
  requireArm64 &&
  (process.platform !== "darwin" || process.arch !== "arm64")
) {
  throw new Error(
    `macOS arm64 runtime required, received ${process.platform}-${process.arch}.`,
  );
}

const root = resolve(import.meta.dirname, "..");
for (const plugin of ["google-workspace", "gmail"]) {
  await smokeRuntime(
    plugin,
    resolve(root, "plugins", plugin, "runtime", "server.mjs"),
  );
}
console.log(`Runtime smoke passed on ${process.platform}-${process.arch}.`);

async function smokeRuntime(name, runtimePath) {
  const child = spawn(process.execPath, [runtimePath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout });
  const responses = new Map();
  const waiters = new Map();
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (typeof message.id !== "number") return;
    const waiter = waiters.get(message.id);
    if (waiter) {
      waiters.delete(message.id);
      waiter(message);
    } else {
      responses.set(message.id, message);
    }
  });
  let id = 0;
  const request = async (method, params = {}) => {
    id += 1;
    const requestId = id;
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
    );
    const existing = responses.get(requestId);
    if (existing) return existing;
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(requestId);
        reject(
          new Error(
            `${name} did not answer ${method}. ${stderr.join("").trim()}`,
          ),
        );
      }, 10_000);
      waiters.set(requestId, (message) => {
        clearTimeout(timeout);
        resolvePromise(message);
      });
    });
  };
  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "artemis-offline-smoke", version: "1.0.0" },
    });
    if (initialized.error) throw new Error(`${name} initialize failed.`);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const listed = await request("tools/list");
    if (
      listed.error ||
      !Array.isArray(listed.result?.tools) ||
      !listed.result.tools.length
    ) {
      throw new Error(`${name} did not expose any MCP tools.`);
    }
  } finally {
    lines.close();
    child.kill("SIGTERM");
  }
}

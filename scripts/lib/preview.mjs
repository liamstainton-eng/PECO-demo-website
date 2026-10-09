// Start and stop `astro preview` on a free local port for QA scripts
// (verify-all.mjs, run-lighthouse.mjs). Spawns node directly (no shell), so
// stopping kills the server on Windows too.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const ASTRO = fileURLToPath(
  new URL("../../node_modules/astro/bin/astro.mjs", import.meta.url),
);

/** A TCP port that is free right now on 127.0.0.1. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start `astro preview` serving `outDir` (default dist) and wait until it answers.
 * @returns {Promise<{ url: string, port: number, stop: () => Promise<void> }>}
 */
export async function startPreview({ outDir, timeoutMs = 60_000 } = {}) {
  const port = await freePort();
  const args = [
    ASTRO,
    "preview",
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
    "--ignore-lock",
  ];
  if (outDir && outDir !== "dist") args.push("--outDir", outDir);
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const exited = new Promise((resolve) => child.once("exit", resolve));

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
  };

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `astro preview exited early (${child.exitCode}):\n${log}`,
      );
    try {
      const res = await fetch(url + "/");
      await res.body?.cancel();
      if (res.ok) return { url, port, stop };
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await stop();
  throw new Error(
    `astro preview did not answer on ${url} within ${timeoutMs} ms:\n${log}`,
  );
}

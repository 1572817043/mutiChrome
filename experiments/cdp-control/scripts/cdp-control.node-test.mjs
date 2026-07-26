import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPortsAvailable,
  buildChromeLaunchArgs,
  collectActionResults,
  readRuntimePids,
  shouldCleanupPid,
  writeRuntimePids,
} from "./lib.mjs";

test("assertPortsAvailable reports occupied ports without killing the listener", async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.equal(typeof address, "object");

  try {
    await assert.rejects(
      () => assertPortsAvailable([address.port]),
      /CDP debug port is already in use/,
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runtime pid file round-trips only experiment-owned Chrome processes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cdp-runtime-"));
  const pidFile = path.join(tempDir, "pids.json");
  const entries = [
    {
      profileId: "profile-a",
      pid: 12345,
      port: 9222,
      profileDir: "/tmp/profile-a",
      startedAt: "2026-07-26T00:00:00.000Z",
      command: "Google Chrome --user-data-dir=/tmp/profile-a --remote-debugging-port=9222",
    },
  ];

  await writeRuntimePids(pidFile, entries);
  assert.deepEqual(await readRuntimePids(pidFile), entries);
  assert.equal(shouldCleanupPid(entries[0], "/tmp/profile-a"), true);
  assert.equal(shouldCleanupPid(entries[0], "/tmp/profile-a", "Google Chrome"), false);
  assert.equal(shouldCleanupPid({ ...entries[0], command: "Google Chrome" }, "/tmp/profile-a"), false);
  assert.equal(shouldCleanupPid({ ...entries[0], profileDir: "/tmp/other" }, "/tmp/profile-a"), false);
});

test("buildChromeLaunchArgs assigns profile directory and remote debugging port", () => {
  const args = buildChromeLaunchArgs({
    profileDir: "/tmp/mc-profile-a",
    port: 9222,
    url: "http://127.0.0.1:8080/",
  });

  assert.ok(args.includes("--user-data-dir=/tmp/mc-profile-a"));
  assert.ok(args.includes("--remote-debugging-port=9222"));
  assert.ok(args.includes("--no-first-run"));
  assert.ok(args.includes("--no-default-browser-check"));
  assert.equal(args.at(-1), "http://127.0.0.1:8080/");
});

test("collectActionResults keeps successful profiles when one profile fails", async () => {
  const results = await collectActionResults([
    {
      profileId: "profile-a",
      run: async () => ({ clicked: true, typed: true }),
    },
    {
      profileId: "profile-b",
      run: async () => {
        throw new Error("selector not found: #primary-action");
      },
    },
    {
      profileId: "profile-c",
      run: async () => ({ clicked: true, typed: true }),
    },
  ]);

  assert.deepEqual(
    results.map((result) => result.status),
    ["succeeded", "failed", "succeeded"],
  );
  assert.match(results[1].error, /selector not found/);
});

test("experiment gitignore excludes runtime artifacts", async () => {
  const gitignore = await fs.readFile(new URL("../.gitignore", import.meta.url), "utf8");

  assert.match(gitignore, /tmp-profiles\//);
  assert.match(gitignore, /\.runtime\//);
  assert.match(gitignore, /logs\//);
  assert.match(gitignore, /screenshots\//);
}
);

test("README records concrete experiment conclusions", async () => {
  const readme = await fs.readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /### 结果/);
  assert.match(readme, /### macOS 结果/);
  assert.match(readme, /### Windows 待测/);
  assert.match(readme, /### 已知限制/);
  assert.match(readme, /### 对主应用架构的结论/);
  assert.doesNotMatch(readme, /待运行实验后记录/);
});

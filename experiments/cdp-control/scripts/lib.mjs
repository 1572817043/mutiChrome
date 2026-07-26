import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
export const experimentDir = path.resolve(__dirname, "..");
export const runtimeDir = path.join(experimentDir, ".runtime");
export const pidFilePath = path.join(runtimeDir, "pids.json");
export const tmpProfilesDir = path.join(experimentDir, "tmp-profiles");
export const testPageDir = path.join(experimentDir, "test-page");

export const profileConfigs = [
  { profileId: "profile-a", port: 9222, mode: "normal" },
  { profileId: "profile-b", port: 9223, mode: "normal" },
  { profileId: "profile-c", port: 9224, mode: "missing-button" },
];

export function buildChromeLaunchArgs({ profileDir, port, url }) {
  return [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ];
}

export async function assertPortsAvailable(ports) {
  const occupied = [];

  for (const port of ports) {
    const available = await canListenOnPort(port);
    if (!available) occupied.push(port);
  }

  if (occupied.length > 0) {
    throw new Error(
      `CDP debug port is already in use: ${occupied.join(", ")}. Close the process using it or choose other ports; this script will not kill existing processes.`,
    );
  }
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export async function readRuntimePids(pidFile = pidFilePath) {
  try {
    const content = await fs.readFile(pidFile, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeRuntimePids(pidFile = pidFilePath, entries) {
  await fs.mkdir(path.dirname(pidFile), { recursive: true });
  await fs.writeFile(pidFile, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

export function shouldCleanupPid(entry, expectedProfileDir = entry.profileDir, actualCommand = entry.command) {
  if (!entry || typeof entry.pid !== "number") return false;
  if (entry.profileDir !== expectedProfileDir) return false;
  if (typeof entry.command !== "string") return false;
  if (typeof actualCommand !== "string") return false;
  return (
    entry.command.includes(`--user-data-dir=${expectedProfileDir}`) &&
    entry.command.includes(`--remote-debugging-port=${entry.port}`) &&
    actualCommand.includes(`--user-data-dir=${expectedProfileDir}`) &&
    actualCommand.includes(`--remote-debugging-port=${entry.port}`)
  );
}

export async function collectActionResults(actions) {
  return Promise.all(
    actions.map(async (action) => {
      try {
        const value = await action.run();
        return {
          profileId: action.profileId,
          status: "succeeded",
          value,
        };
      } catch (error) {
        return {
          profileId: action.profileId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export async function ensureExperimentDirs() {
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.mkdir(tmpProfilesDir, { recursive: true });
}

export function findChromeExecutable() {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          ]
        : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

  return candidates[0];
}

export function buildTestPageUrl({ serverPort, mode }) {
  return `http://127.0.0.1:${serverPort}/index.html?mode=${encodeURIComponent(mode)}`;
}

export async function startStaticServer(rootDir = testPageDir) {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const filePath = path.join(rootDir, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ""));

    try {
      const content = await fs.readFile(filePath);
      response.writeHead(200, { "content-type": contentTypeForPath(filePath) });
      response.end(content);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Failed to start local test server");

  return {
    port: address.port,
    urlForMode: (mode) => buildTestPageUrl({ serverPort: address.port, mode }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function contentTypeForPath(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

export async function waitForCdpPort(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for CDP port ${port}: ${lastError?.message || "no response"}`);
}

export async function listTabsForPort(port) {
  const tabs = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  return tabs.filter((tab) => tab.type === "page");
}

export async function getFirstPageTarget(port) {
  const tabs = await listTabsForPort(port);
  const target = tabs.find((tab) => tab.webSocketDebuggerUrl);
  if (!target) throw new Error(`No CDP page target found on port ${port}`);
  return target;
}

export async function connectToTarget(target) {
  if (typeof WebSocket !== "function") {
    throw new Error("This experiment requires a Node runtime with built-in WebSocket support.");
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      resolve(message.result);
    }
  });

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
    });
  }

  return {
    send,
    close: () => socket.close(),
  };
}

export async function navigateTarget(client, url) {
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Page.navigate", { url });
  await waitForExpression(client, "document.readyState === 'complete'");
}

export async function clickSelector(client, selector) {
  await evaluateOrThrow(
    client,
    `
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error("selector not found: ${selector}");
        element.click();
        return true;
      })()
    `,
  );
}

export async function typeText(client, selector, text) {
  await evaluateOrThrow(
    client,
    `
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error("selector not found: ${selector}");
        element.focus();
        element.value = ${JSON.stringify(text)};
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `,
  );
}

export async function readPageState(client) {
  return evaluateOrThrow(
    client,
    `
      (() => ({
        url: location.href,
        title: document.title,
        clickCount: document.querySelector("#click-count")?.textContent || "",
        typedOutput: document.querySelector("#typed-output")?.textContent || ""
      }))()
    `,
  );
}

async function waitForExpression(client, expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await evaluateOrThrow(client, expression);
    if (value === true) return;
    await delay(100);
  }

  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function evaluateOrThrow(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(text);
  }

  return result.result?.value;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatTable(rows) {
  return JSON.stringify(rows, null, 2);
}

export async function processCommandLine(pid) {
  if (process.platform === "win32") {
    return "";
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    return stdout.trim();
  } catch {
    return "";
  }
}

export function signalForCleanup() {
  return os.platform() === "win32" ? undefined : "SIGTERM";
}

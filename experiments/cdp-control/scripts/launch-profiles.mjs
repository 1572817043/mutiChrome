import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import {
  assertPortsAvailable,
  buildChromeLaunchArgs,
  ensureExperimentDirs,
  findChromeExecutable,
  pidFilePath,
  profileConfigs,
  startStaticServer,
  tmpProfilesDir,
  waitForCdpPort,
  writeRuntimePids,
} from "./lib.mjs";

await ensureExperimentDirs();

const ports = profileConfigs.map((profile) => profile.port);
await assertPortsAvailable(ports);

const chromeExecutable = findChromeExecutable();
const server = await startStaticServer();
const pidEntries = [];

try {
  for (const profile of profileConfigs) {
    const profileDir = path.join(tmpProfilesDir, profile.profileId);
    await fs.mkdir(profileDir, { recursive: true });
    const url = server.urlForMode(profile.mode);
    const args = buildChromeLaunchArgs({ profileDir, port: profile.port, url });
    const child = spawn(chromeExecutable, args, {
      detached: true,
      stdio: "ignore",
    });

    child.unref();
    pidEntries.push({
      profileId: profile.profileId,
      pid: child.pid,
      port: profile.port,
      profileDir,
      startedAt: new Date().toISOString(),
      command: `${chromeExecutable} ${args.join(" ")}`,
    });
  }

  await writeRuntimePids(pidFilePath, pidEntries);

  for (const profile of profileConfigs) {
    await waitForCdpPort(profile.port);
  }

  console.log("Launched CDP profiles:");
  console.log(JSON.stringify(pidEntries, null, 2));
} finally {
  await server.close();
}

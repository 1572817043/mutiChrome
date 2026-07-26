import fs from "node:fs/promises";

import {
  pidFilePath,
  processCommandLine,
  readRuntimePids,
  shouldCleanupPid,
  signalForCleanup,
  writeRuntimePids,
} from "./lib.mjs";

const entries = await readRuntimePids(pidFilePath);
const remaining = [];
const cleaned = [];
const skipped = [];

for (const entry of entries) {
  const actualCommand = await processCommandLine(entry.pid);

  if (!actualCommand) {
    cleaned.push({ ...entry, alreadyExited: true });
    continue;
  }

  if (!shouldCleanupPid(entry, entry.profileDir, actualCommand)) {
    skipped.push({ ...entry, reason: "live process command does not match experiment Chrome command" });
    remaining.push(entry);
    continue;
  }

  try {
    process.kill(entry.pid, signalForCleanup());
    cleaned.push(entry);
  } catch (error) {
    if (error.code === "ESRCH") {
      cleaned.push({ ...entry, alreadyExited: true });
    } else {
      skipped.push({ ...entry, reason: error.message });
      remaining.push(entry);
    }
  }
}

if (remaining.length > 0) {
  await writeRuntimePids(pidFilePath, remaining);
} else {
  await fs.rm(pidFilePath, { force: true });
}

console.log(JSON.stringify({ cleaned, skipped, remaining }, null, 2));

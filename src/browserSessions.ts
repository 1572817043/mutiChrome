import type { BrowserSessionSnapshot } from "./api";

export const STARTING_SESSION_GRACE_MS = 10000;

export function createStartingBrowserSession(
  profileId: string,
  checkedAt = Date.now()
): BrowserSessionSnapshot {
  return {
    profileId,
    status: "starting",
    running: false,
    pid: null,
    windowCount: null,
    windows: [],
    windowError: null,
    checkedAt
  };
}

export function mergeBrowserSessionSnapshots(
  current: Record<string, BrowserSessionSnapshot>,
  snapshots: BrowserSessionSnapshot[],
  checkedAt = Date.now(),
  startingGraceMs = STARTING_SESSION_GRACE_MS
): Record<string, BrowserSessionSnapshot> {
  return snapshots.reduce<Record<string, BrowserSessionSnapshot>>((sessionsById, snapshot) => {
    const currentSnapshot = current[snapshot.profileId];
    sessionsById[snapshot.profileId] = shouldKeepStartingSession(
      currentSnapshot,
      snapshot,
      checkedAt,
      startingGraceMs
    )
      ? currentSnapshot
      : snapshot;
    return sessionsById;
  }, {});
}

export function runningProfileIdsFromSessions(
  sessionsById: Record<string, BrowserSessionSnapshot>
): string[] {
  return Object.values(sessionsById)
    .filter(isSessionRunning)
    .map((snapshot) => snapshot.profileId);
}

export function runningProfileIdsFromSnapshots(
  snapshots: BrowserSessionSnapshot[]
): string[] {
  return snapshots
    .filter(isSessionRunning)
    .map((snapshot) => snapshot.profileId);
}

export function isSessionRunning(snapshot: BrowserSessionSnapshot): boolean {
  return snapshot.status === "running";
}

export function profileSessionStatus(
  snapshot: BrowserSessionSnapshot | undefined,
  runningFallback: boolean
) {
  if (snapshot) {
    return snapshot.status;
  }
  return runningFallback ? "running" : "stopped";
}

function shouldKeepStartingSession(
  current: BrowserSessionSnapshot | undefined,
  next: BrowserSessionSnapshot,
  checkedAt: number,
  startingGraceMs: number
): current is BrowserSessionSnapshot {
  return (
    current?.status === "starting" &&
    next.status === "stopped" &&
    checkedAt - current.checkedAt < startingGraceMs
  );
}

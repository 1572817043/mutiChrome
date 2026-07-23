import type { ChromeWindowInfo, WindowBounds } from "./api";

export type BrowserWindowRegistryStatus = "ready" | "missing" | "error";
export type WindowLayoutPreset = "grid";
export type WindowLayoutSkipReason = "missing-window" | "window-error";
export type WindowSyncSkipReason =
  | "missing-window"
  | "minimized-window"
  | "window-error";
export type WindowSyncSourceStatus =
  | "ready"
  | "missing-window"
  | "minimized-window"
  | "window-error";

export interface BrowserWindowRegistryInput {
  profileId: string;
  profileName: string;
  windows: ChromeWindowInfo[];
  windowError?: string | null;
}

export interface BrowserWindowRegistryEntry {
  profileId: string;
  profileName: string;
  status: BrowserWindowRegistryStatus;
  windowCount: number;
  primaryWindow: ChromeWindowInfo | null;
  hasMultipleWindows: boolean;
  minimized: boolean;
  windowError: string | null;
}

export interface ScreenWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowLayoutOptions {
  minWindowWidth?: number;
  minWindowHeight?: number;
}

export interface WindowLayoutPlacement {
  profileId: string;
  profileName: string;
  bounds: WindowBounds;
}

export interface WindowLayoutSkippedEntry {
  profileId: string;
  profileName: string;
  reason: WindowLayoutSkipReason;
}

export interface WindowLayoutPlan {
  preset: WindowLayoutPreset;
  requestedCount: number;
  tileableCount: number;
  capacity: number;
  capacityExceeded: boolean;
  placements: WindowLayoutPlacement[];
  skipped: WindowLayoutSkippedEntry[];
  multiWindowProfileCount: number;
}

export interface WindowSyncSkippedEntry {
  profileId: string;
  profileName: string;
  reason: WindowSyncSkipReason;
}

export interface WindowSyncPlan {
  sourceProfileId: string;
  sourceProfileName: string;
  sourceStatus: WindowSyncSourceStatus;
  sourceBounds: WindowBounds | null;
  sourceWindowError: string | null;
  placements: WindowLayoutPlacement[];
  skipped: WindowSyncSkippedEntry[];
  noWindowCount: number;
  minimizedCount: number;
  failedCount: number;
}

const DEFAULT_MIN_WINDOW_WIDTH = 320;
const DEFAULT_MIN_WINDOW_HEIGHT = 240;
const WINDOW_BOUNDS_TOLERANCE = 8;

export function buildPrimaryWindowRegistry(
  inputs: BrowserWindowRegistryInput[]
): BrowserWindowRegistryEntry[] {
  return inputs.map((input) => {
    const primaryWindow = input.windows[0] ?? null;
    const windowError = input.windowError ?? null;
    const status: BrowserWindowRegistryStatus = windowError
      ? "error"
      : primaryWindow
        ? "ready"
        : "missing";

    return {
      profileId: input.profileId,
      profileName: input.profileName,
      status,
      windowCount: input.windows.length,
      primaryWindow,
      hasMultipleWindows: input.windows.length > 1,
      minimized: Boolean(primaryWindow?.minimized),
      windowError
    };
  });
}

export function buildGridWindowLayoutPlan(
  registry: BrowserWindowRegistryEntry[],
  workArea: ScreenWorkArea,
  options: WindowLayoutOptions = {}
): WindowLayoutPlan {
  const tileableEntries = registry.filter((entry) => entry.status === "ready");
  const skipped = registry
    .filter((entry) => entry.status !== "ready")
    .map((entry): WindowLayoutSkippedEntry => ({
      profileId: entry.profileId,
      profileName: entry.profileName,
      reason: entry.status === "error" ? "window-error" : "missing-window"
    }));
  const capacity = maxTileableWindowCount(
    workArea.width,
    workArea.height,
    options.minWindowWidth,
    options.minWindowHeight
  );
  const capacityExceeded = tileableEntries.length > capacity;
  const bounds = capacityExceeded
    ? []
    : tileBoundsForCount(
        tileableEntries.length,
        workArea.width,
        workArea.height,
        workArea.x,
        workArea.y
      );

  return {
    preset: "grid",
    requestedCount: registry.length,
    tileableCount: tileableEntries.length,
    capacity,
    capacityExceeded,
    placements: capacityExceeded
      ? []
      : tileableEntries.map((entry, index) => ({
          profileId: entry.profileId,
          profileName: entry.profileName,
          bounds: bounds[index]
        })),
    skipped,
    multiWindowProfileCount: tileableEntries.filter(
      (entry) => entry.hasMultipleWindows
    ).length
  };
}

export function buildWindowLayoutSyncPlan(
  registry: BrowserWindowRegistryEntry[],
  sourceProfileId: string
): WindowSyncPlan {
  const sourceEntry = registry.find((entry) => entry.profileId === sourceProfileId);
  const sourceProfileName = sourceEntry?.profileName ?? sourceProfileId;
  const sourceStatus = sourceEntry
    ? syncStatusForRegistryEntry(sourceEntry)
    : "missing-window";
  const sourceBounds =
    sourceStatus === "ready" && sourceEntry?.primaryWindow
      ? boundsFromWindow(sourceEntry.primaryWindow)
      : null;
  const targetEntries = registry.filter((entry) => entry.profileId !== sourceProfileId);
  const skipped: WindowSyncSkippedEntry[] = [];
  const placements: WindowLayoutPlacement[] = [];
  let noWindowCount = 0;
  let minimizedCount = 0;
  let failedCount = 0;

  for (const entry of targetEntries) {
    const targetStatus = syncStatusForRegistryEntry(entry);
    if (targetStatus === "missing-window") {
      noWindowCount += 1;
      skipped.push(syncSkippedEntry(entry, "missing-window"));
      continue;
    }

    if (targetStatus === "minimized-window") {
      minimizedCount += 1;
      skipped.push(syncSkippedEntry(entry, "minimized-window"));
      continue;
    }

    if (targetStatus === "window-error") {
      failedCount += 1;
      skipped.push(syncSkippedEntry(entry, "window-error"));
      continue;
    }

    if (sourceBounds) {
      placements.push({
        profileId: entry.profileId,
        profileName: entry.profileName,
        bounds: sourceBounds
      });
    }
  }

  return {
    sourceProfileId,
    sourceProfileName,
    sourceStatus,
    sourceBounds,
    sourceWindowError: sourceEntry?.windowError ?? null,
    placements: sourceStatus === "ready" ? placements : [],
    skipped,
    noWindowCount,
    minimizedCount,
    failedCount
  };
}

export function maxTileableWindowCount(
  screenWidth: number,
  screenHeight: number,
  minWindowWidth = DEFAULT_MIN_WINDOW_WIDTH,
  minWindowHeight = DEFAULT_MIN_WINDOW_HEIGHT
): number {
  const columns = Math.max(1, Math.floor(screenWidth / minWindowWidth));
  const rows = Math.max(1, Math.floor(screenHeight / minWindowHeight));
  return columns * rows;
}

export function tileBoundsForCount(
  count: number,
  screenWidth: number,
  screenHeight: number,
  originX = 0,
  originY = 0
): WindowBounds[] {
  if (count <= 0) {
    return [];
  }

  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const tileWidth = Math.floor(screenWidth / columns);
  const tileHeight = Math.floor(screenHeight / rows);

  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: originX + column * tileWidth,
      y: originY + row * tileHeight,
      width: tileWidth,
      height: tileHeight
    };
  });
}

export function windowMatchesBounds(
  windowInfo: ChromeWindowInfo,
  bounds: WindowBounds
): boolean {
  return (
    Math.abs(windowInfo.x - bounds.x) <= WINDOW_BOUNDS_TOLERANCE &&
    Math.abs(windowInfo.y - bounds.y) <= WINDOW_BOUNDS_TOLERANCE &&
    Math.abs(windowInfo.width - bounds.width) <= WINDOW_BOUNDS_TOLERANCE &&
    Math.abs(windowInfo.height - bounds.height) <= WINDOW_BOUNDS_TOLERANCE
  );
}

function syncStatusForRegistryEntry(
  entry: BrowserWindowRegistryEntry
): WindowSyncSourceStatus {
  if (entry.status === "error") {
    return "window-error";
  }

  if (!entry.primaryWindow) {
    return "missing-window";
  }

  if (entry.minimized) {
    return "minimized-window";
  }

  return "ready";
}

function boundsFromWindow(windowInfo: ChromeWindowInfo): WindowBounds {
  return {
    x: windowInfo.x,
    y: windowInfo.y,
    width: windowInfo.width,
    height: windowInfo.height
  };
}

function syncSkippedEntry(
  entry: BrowserWindowRegistryEntry,
  reason: WindowSyncSkipReason
): WindowSyncSkippedEntry {
  return {
    profileId: entry.profileId,
    profileName: entry.profileName,
    reason
  };
}

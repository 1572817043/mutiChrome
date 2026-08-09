import type { ChromeWindowInfo, WindowBounds } from "./api";

export type BrowserWindowRegistryStatus = "ready" | "missing" | "error";
export type WindowLayoutPreset = "grid" | "two-columns" | "left-main";
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
  preset?: WindowLayoutPreset;
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
  return buildWindowLayoutPlan(registry, workArea, { ...options, preset: "grid" });
}

export function buildWindowLayoutPlan(
  registry: BrowserWindowRegistryEntry[],
  workArea: ScreenWorkArea,
  options: WindowLayoutOptions = {}
): WindowLayoutPlan {
  const preset = options.preset ?? "grid";
  const tileableEntries = registry.filter((entry) => entry.status === "ready");
  const skipped = registry
    .filter((entry) => entry.status !== "ready")
    .map((entry): WindowLayoutSkippedEntry => ({
      profileId: entry.profileId,
      profileName: entry.profileName,
      reason: entry.status === "error" ? "window-error" : "missing-window"
    }));
  const capacity = layoutCapacity(workArea, preset, options, tileableEntries.length);
  const capacityExceeded = tileableEntries.length > capacity;
  const bounds = capacityExceeded
    ? []
    : boundsForPreset(tileableEntries.length, workArea, preset);

  return {
    preset,
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

function layoutCapacity(
  workArea: ScreenWorkArea,
  preset: WindowLayoutPreset,
  options: WindowLayoutOptions,
  tileableCount: number
): number {
  const minWidth = options.minWindowWidth ?? DEFAULT_MIN_WINDOW_WIDTH;
  const minHeight = options.minWindowHeight ?? DEFAULT_MIN_WINDOW_HEIGHT;

  if (preset === "grid") {
    return maxTileableWindowCount(workArea.width, workArea.height, minWidth, minHeight);
  }

  if (preset === "two-columns") {
    if (workArea.width < minWidth || workArea.height < minHeight) {
      return 0;
    }
    if (tileableCount <= 1) {
      return 1;
    }
    const columns = Math.floor(workArea.width / minWidth);
    const rows = Math.floor(workArea.height / minHeight);
    return columns < 2 ? 0 : 2 * rows;
  }

  const mainWidth = Math.floor(workArea.width * 0.6);
  const sideWidth = workArea.width - mainWidth;
  if (
    workArea.height < minHeight ||
    mainWidth < minWidth ||
    sideWidth < minWidth
  ) {
    return mainWidth >= minWidth && workArea.height >= minHeight ? 1 : 0;
  }

  return 1 + Math.floor(workArea.height / minHeight);
}

function boundsForPreset(
  count: number,
  workArea: ScreenWorkArea,
  preset: WindowLayoutPreset
): WindowBounds[] {
  if (preset === "grid") {
    return tileBoundsForCount(
      count,
      workArea.width,
      workArea.height,
      workArea.x,
      workArea.y
    );
  }

  if (preset === "two-columns") {
    if (count <= 0) {
      return [];
    }
    if (count === 1) {
      return [{
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height
      }];
    }
    const columns = 2;
    const rows = Math.ceil(count / columns);
    const tileWidth = Math.floor(workArea.width / columns);
    const tileHeight = Math.floor(workArea.height / rows);
    return Array.from({ length: count }, (_, index) => ({
      x: workArea.x + (index % columns) * tileWidth,
      y: workArea.y + Math.floor(index / columns) * tileHeight,
      width: tileWidth,
      height: tileHeight
    }));
  }

  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [{
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height
    }];
  }

  const mainWidth = Math.floor(workArea.width * 0.6);
  const sideWidth = workArea.width - mainWidth;
  const sideCount = count - 1;
  const sideHeight = Math.floor(workArea.height / sideCount);
  return [
    {
      x: workArea.x,
      y: workArea.y,
      width: mainWidth,
      height: workArea.height
    },
    ...Array.from({ length: sideCount }, (_, index) => ({
      x: workArea.x + mainWidth,
      y: workArea.y + index * sideHeight,
      width: sideWidth,
      height: sideHeight
    }))
  ];
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

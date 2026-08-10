import type { ChromeWindowInfo, WindowBounds } from "../../api";
import {
  buildPrimaryWindowRegistry,
  buildWindowLayoutSyncPlan,
  windowMatchesBounds,
  type BrowserWindowRegistryInput,
  type WindowSyncPlan
} from "../../browserWindows";
import type { ChromeProfile } from "../../types";
import { errorMessage } from "../../shared/windowAutomationErrors";

export type WindowSyncResultEntryStatus = "synced" | "unchanged" | "failed";

export interface WindowSyncResultEntry {
  profileId: string;
  profileName: string;
  status: WindowSyncResultEntryStatus;
  error: unknown | null;
}

export interface WindowSyncControllerDependencies {
  setBounds: (profileId: string, bounds: WindowBounds) => Promise<void>;
  readWindows: (profileId: string) => Promise<ChromeWindowInfo[]>;
}

export interface WindowSyncControllerOptions {
  firstFailedError?: unknown;
}

export interface WindowSyncPlanReaderDependencies {
  readWindows: (profile: ChromeProfile, purpose: string) => Promise<ChromeWindowInfo[]>;
}

export interface WindowSyncControllerResult {
  syncedCount: number;
  unchangedCount: number;
  failedCount: number;
  firstFailedError: unknown | null;
  syncedProfileIds: string[];
  noWindowCount: number;
  minimizedCount: number;
  entries: WindowSyncResultEntry[];
}

export interface WindowSyncPreviewDetails {
  mode: "preview";
  plan: WindowSyncPlan;
}

export interface WindowSyncResultDetails {
  mode: "result";
  plan: WindowSyncPlan;
  result: WindowSyncControllerResult;
}

export type WindowSyncDetails =
  | WindowSyncPreviewDetails
  | WindowSyncResultDetails;

export async function readWindowSyncPlanForProfiles(
  profiles: ChromeProfile[],
  sourceProfile: ChromeProfile,
  dependencies: WindowSyncPlanReaderDependencies
): Promise<{ syncPlan: WindowSyncPlan; firstFailedError: unknown | null }> {
  const registryInputs: BrowserWindowRegistryInput[] = [];
  let firstFailedError: unknown | null = null;

  try {
    const sourceWindows = await dependencies.readWindows(sourceProfile, "读取主窗口");
    registryInputs.push({
      profileId: sourceProfile.id,
      profileName: sourceProfile.name,
      windows: sourceWindows
    });
  } catch (error) {
    firstFailedError = error;
    registryInputs.push({
      profileId: sourceProfile.id,
      profileName: sourceProfile.name,
      windows: [],
      windowError: errorMessage(error)
    });
  }

  let windowRegistry = buildPrimaryWindowRegistry(registryInputs);
  let syncPlan = buildWindowLayoutSyncPlan(windowRegistry, sourceProfile.id);
  if (syncPlan.sourceStatus !== "ready") {
    return { syncPlan, firstFailedError };
  }

  for (const profile of profiles) {
    if (profile.id === sourceProfile.id) {
      continue;
    }

    try {
      const windows = await dependencies.readWindows(profile, "检查同步窗口");
      registryInputs.push({
        profileId: profile.id,
        profileName: profile.name,
        windows
      });
    } catch (error) {
      firstFailedError ??= error;
      registryInputs.push({
        profileId: profile.id,
        profileName: profile.name,
        windows: [],
        windowError: errorMessage(error)
      });
    }
  }

  windowRegistry = buildPrimaryWindowRegistry(registryInputs);
  syncPlan = buildWindowLayoutSyncPlan(windowRegistry, sourceProfile.id);
  return { syncPlan, firstFailedError };
}

export function buildWindowSyncPreviewDetails(
  plan: WindowSyncPlan
): WindowSyncPreviewDetails {
  return { mode: "preview", plan };
}

export function createEmptyWindowSyncControllerResult(
  plan: WindowSyncPlan,
  firstFailedError: unknown | null = null
): WindowSyncControllerResult {
  return {
    syncedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    firstFailedError,
    syncedProfileIds: [],
    noWindowCount: plan.noWindowCount,
    minimizedCount: plan.minimizedCount,
    entries: []
  };
}

export async function executeWindowSyncPlan(
  plan: WindowSyncPlan,
  dependencies: WindowSyncControllerDependencies,
  options: WindowSyncControllerOptions = {}
): Promise<WindowSyncControllerResult> {
  let syncedCount = 0;
  let unchangedCount = 0;
  let failedCount = plan.failedCount;
  let firstFailedError: unknown | null = options.firstFailedError ?? null;
  const syncedProfileIds: string[] = [];
  const entries: WindowSyncResultEntry[] = [];

  for (const placement of plan.placements) {
    try {
      await dependencies.setBounds(placement.profileId, placement.bounds);
      const windows = await dependencies.readWindows(placement.profileId);
      if (!windows[0] || !windowMatchesBounds(windows[0], placement.bounds)) {
        unchangedCount += 1;
        entries.push({
          profileId: placement.profileId,
          profileName: placement.profileName,
          status: "unchanged",
          error: null
        });
        continue;
      }

      syncedCount += 1;
      syncedProfileIds.push(placement.profileId);
      entries.push({
        profileId: placement.profileId,
        profileName: placement.profileName,
        status: "synced",
        error: null
      });
    } catch (error) {
      failedCount += 1;
      if (firstFailedError === null) {
        firstFailedError = error;
      }
      entries.push({
        profileId: placement.profileId,
        profileName: placement.profileName,
        status: "failed",
        error
      });
    }
  }

  return {
    syncedCount,
    unchangedCount,
    failedCount,
    firstFailedError,
    syncedProfileIds,
    noWindowCount: plan.noWindowCount,
    minimizedCount: plan.minimizedCount,
    entries
  };
}

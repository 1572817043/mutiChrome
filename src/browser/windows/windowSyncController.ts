import type { ChromeWindowInfo, WindowBounds } from "../../api";
import {
  windowMatchesBounds,
  type WindowSyncPlan
} from "../../browserWindows";

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

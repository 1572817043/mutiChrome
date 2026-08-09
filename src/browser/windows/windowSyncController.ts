import type { ChromeWindowInfo, WindowBounds } from "../../api";
import {
  windowMatchesBounds,
  type WindowSyncPlan
} from "../../browserWindows";

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

  for (const placement of plan.placements) {
    try {
      await dependencies.setBounds(placement.profileId, placement.bounds);
      const windows = await dependencies.readWindows(placement.profileId);
      if (!windows[0] || !windowMatchesBounds(windows[0], placement.bounds)) {
        unchangedCount += 1;
        continue;
      }

      syncedCount += 1;
      syncedProfileIds.push(placement.profileId);
    } catch (error) {
      failedCount += 1;
      if (firstFailedError === null) {
        firstFailedError = error;
      }
    }
  }

  return {
    syncedCount,
    unchangedCount,
    failedCount,
    firstFailedError,
    syncedProfileIds,
    noWindowCount: plan.noWindowCount,
    minimizedCount: plan.minimizedCount
  };
}

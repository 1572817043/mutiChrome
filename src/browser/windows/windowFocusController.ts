import type { ChromeProfile } from "../../types";

export interface WindowFocusControllerDependencies {
  focusWindow: (profile: ChromeProfile) => Promise<void>;
  shouldContinue?: () => boolean;
}

export interface WindowFocusControllerResult {
  focusedCount: number;
  failedCount: number;
  firstFailedError: unknown | null;
  cancelled?: boolean;
}

export async function focusWindowsForProfilesInOrder(
  profiles: ChromeProfile[],
  dependencies: WindowFocusControllerDependencies
): Promise<WindowFocusControllerResult> {
  let focusedCount = 0;
  let failedCount = 0;
  let firstFailedError: unknown | null = null;

  for (const profile of profiles) {
    if (dependencies.shouldContinue && !dependencies.shouldContinue()) {
      return { focusedCount, failedCount, firstFailedError, cancelled: true };
    }
    try {
      await dependencies.focusWindow(profile);
      if (dependencies.shouldContinue && !dependencies.shouldContinue()) {
        return { focusedCount, failedCount, firstFailedError, cancelled: true };
      }
      focusedCount += 1;
    } catch (error) {
      if (dependencies.shouldContinue && !dependencies.shouldContinue()) {
        return { focusedCount, failedCount, firstFailedError, cancelled: true };
      }
      failedCount += 1;
      firstFailedError ??= error;
    }
  }

  return { focusedCount, failedCount, firstFailedError };
}

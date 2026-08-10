import type { ChromeProfile } from "../../types";

export interface WindowFocusControllerDependencies {
  focusWindow: (profile: ChromeProfile) => Promise<void>;
}

export interface WindowFocusControllerResult {
  focusedCount: number;
  failedCount: number;
  firstFailedError: unknown | null;
}

export async function focusWindowsForProfilesInOrder(
  profiles: ChromeProfile[],
  dependencies: WindowFocusControllerDependencies
): Promise<WindowFocusControllerResult> {
  let focusedCount = 0;
  let failedCount = 0;
  let firstFailedError: unknown | null = null;

  for (const profile of profiles) {
    try {
      await dependencies.focusWindow(profile);
      focusedCount += 1;
    } catch (error) {
      failedCount += 1;
      firstFailedError ??= error;
    }
  }

  return { focusedCount, failedCount, firstFailedError };
}

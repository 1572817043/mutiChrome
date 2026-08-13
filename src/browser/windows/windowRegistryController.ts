import type { ChromeWindowInfo } from "../../api";
import {
  buildPrimaryWindowRegistry,
  type BrowserWindowRegistryEntry,
  type BrowserWindowRegistryInput
} from "../../browserWindows";
import type { ChromeProfile } from "../../types";

export interface WindowRegistryReaderDependencies {
  readWindows: (profile: ChromeProfile, purpose: string) => Promise<ChromeWindowInfo[]>;
  shouldContinue?: () => boolean;
}

export interface InspectedWindows {
  profile: ChromeProfile;
  windows: ChromeWindowInfo[];
}

export interface WindowRegistryReadResult {
  entries: BrowserWindowRegistryEntry[];
  inspectedWindows: InspectedWindows[];
  cancelled?: boolean;
}

export async function readWindowRegistryForProfiles(
  profiles: ChromeProfile[],
  dependencies: WindowRegistryReaderDependencies
): Promise<WindowRegistryReadResult> {
  const inspectedWindows: InspectedWindows[] = [];

  for (const profile of profiles) {
    if (dependencies.shouldContinue && !dependencies.shouldContinue()) {
      return { entries: [], inspectedWindows: [], cancelled: true };
    }
    let windows: ChromeWindowInfo[];
    try {
      windows = await dependencies.readWindows(profile, "检查窗口");
    } catch (error) {
      if (dependencies.shouldContinue && !dependencies.shouldContinue()) {
        return { entries: [], inspectedWindows: [], cancelled: true };
      }
      throw error;
    }
    if (dependencies.shouldContinue && !dependencies.shouldContinue()) {
      return { entries: [], inspectedWindows: [], cancelled: true };
    }
    inspectedWindows.push({ profile, windows });
  }

  const registryInputs: BrowserWindowRegistryInput[] = inspectedWindows.map(
    ({ profile, windows }) => ({
      profileId: profile.id,
      profileName: profile.name,
      windows
    })
  );

  return {
    entries: buildPrimaryWindowRegistry(registryInputs),
    inspectedWindows
  };
}

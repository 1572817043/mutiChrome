import type { ChromeWindowInfo } from "../../api";
import {
  buildPrimaryWindowRegistry,
  type BrowserWindowRegistryEntry,
  type BrowserWindowRegistryInput
} from "../../browserWindows";
import type { ChromeProfile } from "../../types";

export interface WindowRegistryReaderDependencies {
  readWindows: (profile: ChromeProfile, purpose: string) => Promise<ChromeWindowInfo[]>;
}

export interface InspectedWindows {
  profile: ChromeProfile;
  windows: ChromeWindowInfo[];
}

export interface WindowRegistryReadResult {
  entries: BrowserWindowRegistryEntry[];
  inspectedWindows: InspectedWindows[];
}

export async function readWindowRegistryForProfiles(
  profiles: ChromeProfile[],
  dependencies: WindowRegistryReaderDependencies
): Promise<WindowRegistryReadResult> {
  const inspectedWindows: InspectedWindows[] = [];

  for (const profile of profiles) {
    const windows = await dependencies.readWindows(profile, "检查窗口");
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

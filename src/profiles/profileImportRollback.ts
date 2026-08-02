import type { ChromeProfile } from "../types";

interface RollbackImportedProfilesOptions {
  targetRootPath: string;
  profiles: ChromeProfile[];
  deleteProfileData: (rootPath: string, profileId: string) => Promise<void>;
}

export async function rollbackImportedProfiles({
  targetRootPath,
  profiles,
  deleteProfileData
}: RollbackImportedProfilesOptions): Promise<string[]> {
  const failures: string[] = [];
  for (const profile of profiles) {
    try {
      await deleteProfileData(targetRootPath, profile.id);
    } catch {
      failures.push(profile.id);
    }
  }
  return failures;
}

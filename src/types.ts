export type ProfileStatus = "active" | "needs_check" | "archived";
export type AppTheme = "light" | "dark";
export type ProfileAccentColor =
  | "forest"
  | "teal"
  | "blue"
  | "sage"
  | "violet"
  | "clay"
  | "amber"
  | "rose"
  | "cyan"
  | "indigo"
  | "olive"
  | "slate";

export interface AccountPlatform {
  id: string;
  platform: string;
  loginUrl: string;
  username: string;
  notes: string;
}

export interface ProfileImportSource {
  profileUid: string;
  sourcePath: string;
  sourceFolderName: string;
  importedAt: string;
}

export interface ChromeProfile {
  id: string;
  name: string;
  tags: string[];
  notes: string;
  status: ProfileStatus;
  accountPlatforms: AccountPlatform[];
  accentColor?: ProfileAccentColor;
  importSource?: ProfileImportSource;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface ProfileSettings {
  browserPath: string;
  favoriteUrls: string[];
  recentUrls: string[];
  urlLibrary: UrlLibraryItem[];
  theme: AppTheme;
}

export interface UrlLibraryItem {
  id: string;
  name: string;
  url: string;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectUrl {
  id: string;
  name: string;
  url: string;
  notes: string;
}

export interface AirdropProject {
  id: string;
  name: string;
  url: string;
  urls: ProjectUrl[];
  notes: string;
  profileIds: string[];
  intervalSeconds: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface ProfileDocument {
  version: 1;
  settings: ProfileSettings;
  profiles: ChromeProfile[];
  projects: AirdropProject[];
}

export type RootHealthSeverity = "warning" | "error";

export interface RootHealthSummary {
  profileCount: number;
  warningCount: number;
  errorCount: number;
}

export interface RootHealthIssue {
  severity: RootHealthSeverity;
  code: string;
  title: string;
  detail: string;
  path: string | null;
  profileId: string | null;
}

export interface RootHealthReport {
  rootPath: string;
  summary: RootHealthSummary;
  issues: RootHealthIssue[];
}

export interface RootRepairAction {
  code: string;
  title: string;
  detail: string;
  path: string | null;
  profileId: string | null;
}

export interface RootRepairResult {
  repairedCount: number;
  actions: RootRepairAction[];
  health: RootHealthReport;
}

export interface ProfileBackupResult {
  path: string;
  profileCount: number;
}

export interface FullProfileBackupPreview {
  destinationDir: string;
  profileCount: number;
  profileIds: string[];
  totalBytes: number;
}

export interface FullProfileBackupResult {
  path: string;
  profileCount: number;
  profileIds: string[];
  totalBytes: number;
}

export interface FullProfileRestorePreview {
  path: string;
  profileCount: number;
  profileIds: string[];
  newProfileIds: string[];
  overwriteProfileIds: string[];
  totalBytes: number;
}

export type ProfileImportConfidence = "ready" | "suspicious" | "skipped";

export interface ProfileImportCandidate {
  path: string;
  folderName: string;
  suggestedName: string;
  suggestedTags: string[];
  suggestedNotes: string;
  sizeBytes: number;
  confidence: ProfileImportConfidence;
  evidence: string[];
  skippedReason: string | null;
  profileUid: string | null;
  duplicateProfileId: string | null;
  duplicateProfileName: string | null;
  duplicateReason: string | null;
}

export interface ProfileMarker {
  schemaVersion: 1;
  app: "MultiChrome";
  profileUid: string;
  profileId: string;
  name: string;
  sourcePath: string;
  sourceFolderName: string;
  importedAt: string;
}

import type {
  AccountPlatform,
  ChromeProfile,
  ProfileAccentColor,
  ProfileImportSource,
  ProfileStatus
} from "../types";

interface CreateProfileInput {
  name: string;
  tags?: string[];
  notes?: string;
  accountPlatforms?: AccountPlatform[];
  accentColor?: ProfileAccentColor;
  importSource?: ProfileImportSource;
}

interface UpdateProfileInput {
  name?: string;
  tags?: string[];
  notes?: string;
  status?: ProfileStatus;
  accountPlatforms?: AccountPlatform[];
  accentColor?: ProfileAccentColor;
  importSource?: ProfileImportSource;
  lastOpenedAt?: string | null;
}

const ACCOUNT_ID_PREFIX = "account-";
const ACCOUNT_PLATFORM_ID_PREFIX = "platform-";
export const PROFILE_ACCENT_COLORS: ProfileAccentColor[] = [
  "forest",
  "teal",
  "blue",
  "sage",
  "violet",
  "clay",
  "amber",
  "rose",
  "cyan",
  "indigo",
  "olive",
  "slate"
];

export function nextProfileId(profiles: ChromeProfile[]): string {
  const max = profiles.reduce((currentMax, profile) => {
    if (!profile.id.startsWith(ACCOUNT_ID_PREFIX)) {
      return currentMax;
    }

    const numberPart = profile.id.slice(ACCOUNT_ID_PREFIX.length);
    const parsed = Number.parseInt(numberPart, 10);
    if (!Number.isFinite(parsed)) {
      return currentMax;
    }

    return Math.max(currentMax, parsed);
  }, 0);

  return `${ACCOUNT_ID_PREFIX}${String(max + 1).padStart(3, "0")}`;
}

export function createProfile(
  input: CreateProfileInput,
  existingProfiles: ChromeProfile[],
  now: string
): ChromeProfile {
  const id = nextProfileId(existingProfiles);

  return {
    id,
    name: cleanRequiredName(input.name),
    tags: cleanTags(input.tags ?? []),
    notes: cleanText(input.notes ?? ""),
    status: "active",
    accountPlatforms: normalizeAccountPlatforms(input.accountPlatforms ?? []),
    accentColor: input.accentColor ?? defaultAccentColor(id),
    importSource: normalizeImportSource(input.importSource),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null
  };
}

export function updateProfile(
  profile: ChromeProfile,
  input: UpdateProfileInput,
  now: string
): ChromeProfile {
  return {
    ...profile,
    name:
      input.name === undefined ? profile.name : cleanRequiredName(input.name),
    tags: input.tags === undefined ? profile.tags : cleanTags(input.tags),
    notes: input.notes === undefined ? profile.notes : cleanText(input.notes),
    status: input.status ?? profile.status,
    accountPlatforms:
      input.accountPlatforms === undefined
        ? profile.accountPlatforms
        : normalizeAccountPlatforms(input.accountPlatforms),
    accentColor: input.accentColor ?? profile.accentColor,
    importSource:
      input.importSource === undefined
        ? profile.importSource
        : normalizeImportSource(input.importSource),
    updatedAt: now,
    lastOpenedAt:
      input.lastOpenedAt === undefined
        ? profile.lastOpenedAt
        : input.lastOpenedAt
  };
}

export function duplicateProfile(
  source: ChromeProfile,
  existingProfiles: ChromeProfile[],
  now: string
): ChromeProfile {
  const id = nextProfileId(existingProfiles);

  return {
    id,
    name: `${source.name} 副本`,
    tags: [...source.tags],
    notes: source.notes,
    status: "active",
    accountPlatforms: normalizeAccountPlatforms(source.accountPlatforms).map(
      (accountPlatform, index) => ({
        ...accountPlatform,
        id: `${ACCOUNT_PLATFORM_ID_PREFIX}${String(index + 1).padStart(3, "0")}`
      })
    ),
    accentColor: defaultAccentColor(id),
    importSource: undefined,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null
  };
}

export function defaultAccentColor(profileId: string): ProfileAccentColor {
  const match = profileId.match(/(\d+)$/);
  const number = Number(match?.[1] ?? 1);
  const index = Number.isFinite(number) ? Math.max(number - 1, 0) : 0;
  return PROFILE_ACCENT_COLORS[index % PROFILE_ACCENT_COLORS.length];
}

export function removeProfile(
  profiles: ChromeProfile[],
  profileId: string
): { profiles: ChromeProfile[]; selectedId: string | null } {
  const removedIndex = profiles.findIndex((profile) => profile.id === profileId);
  const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
  const fallbackIndex = Math.min(Math.max(removedIndex, 0), nextProfiles.length - 1);

  return {
    profiles: nextProfiles,
    selectedId: nextProfiles[fallbackIndex]?.id ?? null
  };
}

export function nextAccountPlatformId(accountPlatforms: AccountPlatform[]): string {
  const max = accountPlatforms.reduce((currentMax, accountPlatform) => {
    if (!accountPlatform.id.startsWith(ACCOUNT_PLATFORM_ID_PREFIX)) {
      return currentMax;
    }

    const numberPart = accountPlatform.id.slice(ACCOUNT_PLATFORM_ID_PREFIX.length);
    const parsed = Number.parseInt(numberPart, 10);
    if (!Number.isFinite(parsed)) {
      return currentMax;
    }

    return Math.max(currentMax, parsed);
  }, 0);

  return `${ACCOUNT_PLATFORM_ID_PREFIX}${String(max + 1).padStart(3, "0")}`;
}

export function createAccountPlatform(
  accountPlatforms: AccountPlatform[]
): AccountPlatform {
  return {
    id: nextAccountPlatformId(accountPlatforms),
    platform: "",
    loginUrl: "",
    username: "",
    notes: ""
  };
}

export function updateAccountPlatform(
  accountPlatforms: AccountPlatform[],
  accountPlatformId: string,
  patch: Partial<AccountPlatform>
): AccountPlatform[] {
  return normalizeAccountPlatforms(
    accountPlatforms.map((accountPlatform) =>
      accountPlatform.id === accountPlatformId
        ? { ...accountPlatform, ...patch }
        : accountPlatform
    )
  );
}

export function removeAccountPlatform(
  accountPlatforms: AccountPlatform[],
  accountPlatformId: string
): AccountPlatform[] {
  return accountPlatforms.filter(
    (accountPlatform) => accountPlatform.id !== accountPlatformId
  );
}

export function normalizeAccountPlatforms(
  accountPlatforms: AccountPlatform[]
): AccountPlatform[] {
  return accountPlatforms.map((accountPlatform) => ({
    id: accountPlatform.id,
    platform: cleanText(accountPlatform.platform),
    loginUrl: cleanUrlText(accountPlatform.loginUrl),
    username: cleanText(accountPlatform.username),
    notes: cleanText(accountPlatform.notes)
  }));
}

function normalizeImportSource(
  importSource: ProfileImportSource | undefined
): ProfileImportSource | undefined {
  if (!importSource) {
    return undefined;
  }

  const profileUid = cleanText(importSource.profileUid);
  const sourcePath = importSource.sourcePath.trim();
  const sourceFolderName = cleanText(importSource.sourceFolderName);
  const importedAt = importSource.importedAt.trim();
  if (!profileUid || !sourcePath || !sourceFolderName || !importedAt) {
    return undefined;
  }

  return {
    profileUid,
    sourcePath,
    sourceFolderName,
    importedAt
  };
}

function cleanRequiredName(value: string): string {
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : "未命名账号";
}

function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const cleaned = cleanText(tag);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    result.push(cleaned);
  }

  return result;
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function cleanUrlText(value: string): string {
  return value.trim();
}

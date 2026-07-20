import {
  ArrowDown,
  ArrowUp,
  Chrome,
  Copy,
  Download,
  ExternalLink,
  FolderKanban,
  FolderOpen,
  LayoutGrid,
  List,
  Moon,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Tags,
  Trash2,
  Upload,
  UserPlus,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DEFAULT_BROWSER_PATH,
  formatBytes,
  normalizeSettings,
  profileApi,
  profilePath,
  type ChromeWindowInfo,
  type ChromeStatus,
  type RootStatus,
  type WindowBounds
} from "./api";
import {
  createAccountPlatform,
  createProfile,
  defaultAccentColor,
  duplicateProfile,
  PROFILE_ACCENT_COLORS,
  removeAccountPlatform,
  removeProfile,
  updateAccountPlatform,
  updateProfile
} from "./domain/profileModel";
import type {
  AccountPlatform,
  AirdropProject,
  AppTheme,
  ChromeProfile,
  FullProfileBackupPreview,
  FullProfileBackupResult,
  FullProfileRestorePreview,
  ProfileBackupResult,
  ProfileAccentColor,
  ProjectUrl,
  ProfileImportCandidate,
  ProfileMarker,
  ProfileSettings,
  RootHealthReport,
  RootRepairResult,
  UrlLibraryItem
} from "./types";

type DeleteMode = "record" | "data";
type CardDensity = "standard" | "compact";
type ActiveView = "accounts" | "projects" | "url-library";
type FullBackupScope = "all" | "selected";
type FullBackupWorking = "preview" | "create" | "restore-preview" | "restore";
type UrlLibraryDraft = Pick<UrlLibraryItem, "name" | "url" | "notes"> & {
  tags: string;
};

const DEFAULT_PROFILE_LAUNCH_URL = "chrome://newtab/";
const DEFAULT_BULK_OPEN_INTERVAL_SECONDS = "3";
const MIN_TILED_WINDOW_WIDTH = 320;
const MIN_TILED_WINDOW_HEIGHT = 240;
const WINDOW_BOUNDS_TOLERANCE = 8;
const RUNNING_STATUS_POLL_MS = 5000;

const ACCENT_DETAILS: Record<ProfileAccentColor, { label: string; hex: string }> = {
  forest: { label: "松绿", hex: "#1f7048" },
  teal: { label: "青绿", hex: "#279a8d" },
  blue: { label: "深蓝", hex: "#2f7ec8" },
  sage: { label: "灰绿", hex: "#6b7c73" },
  violet: { label: "紫藤", hex: "#7f66ad" },
  clay: { label: "陶土", hex: "#a15f4a" },
  amber: { label: "琥珀", hex: "#b7791f" },
  rose: { label: "玫瑰", hex: "#b64f65" },
  cyan: { label: "青蓝", hex: "#16859b" },
  indigo: { label: "靛蓝", hex: "#4f67b0" },
  olive: { label: "橄榄", hex: "#6f7b2f" },
  slate: { label: "石板", hex: "#53616f" }
};

const ACCOUNT_PLATFORM_TEMPLATES: Array<{
  label: string;
  platform: string;
  loginUrl: string;
}> = [
  { label: "X", platform: "X", loginUrl: "https://x.com/i/flow/login" },
  { label: "Discord", platform: "Discord", loginUrl: "https://discord.com/login" },
  { label: "Telegram", platform: "Telegram", loginUrl: "https://web.telegram.org/" },
  { label: "Gmail", platform: "Gmail", loginUrl: "https://accounts.google.com/" },
  { label: "Galxe", platform: "Galxe", loginUrl: "https://galxe.com" },
  { label: "Zealy", platform: "Zealy", loginUrl: "https://zealy.io" }
];

interface PendingDelete {
  profile: ChromeProfile;
  mode: DeleteMode;
}

function App() {
  const [rootPath, setRootPath] = useState("");
  const [rootStatus, setRootStatus] = useState<RootStatus | null>(null);
  const [chromeStatus, setChromeStatus] = useState<ChromeStatus | null>(null);
  const [settings, setSettings] = useState<ProfileSettings>({
    browserPath: DEFAULT_BROWSER_PATH,
    favoriteUrls: [],
    recentUrls: [],
    urlLibrary: [],
    theme: "light"
  });
  const [browserPathDraft, setBrowserPathDraft] = useState(DEFAULT_BROWSER_PATH);
  const [themeDraft, setThemeDraft] = useState<AppTheme>("light");
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [projects, setProjects] = useState<AirdropProject[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>("accounts");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProfileDraft, setEditingProfileDraft] = useState<ChromeProfile | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectDraft, setEditingProjectDraft] = useState<AirdropProject | null>(null);
  const [newProfileDraft, setNewProfileDraft] = useState<ChromeProfile | null>(null);
  const [batchProfileDialogOpen, setBatchProfileDialogOpen] = useState(false);
  const [batchProfileDraft, setBatchProfileDraft] = useState("");
  const [newProjectDraft, setNewProjectDraft] = useState<AirdropProject | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [pendingProjectDeleteId, setPendingProjectDeleteId] = useState<string | null>(null);
  const [urlLibraryQuery, setUrlLibraryQuery] = useState("");
  const [urlLibraryDraft, setUrlLibraryDraft] = useState<UrlLibraryDraft>(
    createUrlLibraryDraft()
  );
  const [editingUrlLibraryId, setEditingUrlLibraryId] = useState<string | null>(null);
  const [urlLibraryEditorOpen, setUrlLibraryEditorOpen] = useState(false);
  const [pendingUrlDeleteId, setPendingUrlDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [profileSizes, setProfileSizes] = useState<Record<string, number | null>>({});
  const [runningProfileIds, setRunningProfileIds] = useState<string[]>([]);
  const [importPath, setImportPath] = useState("");
  const [importCandidates, setImportCandidates] = useState<ProfileImportCandidate[]>([]);
  const [selectedImportPaths, setSelectedImportPaths] = useState<string[]>([]);
  const [importScanning, setImportScanning] = useState(false);
  const [importingProfiles, setImportingProfiles] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<ChromeProfile[] | null>(null);
  const [batchDeleteWorking, setBatchDeleteWorking] = useState<DeleteMode | null>(null);
  const [cardDensity, setCardDensity] = useState<CardDensity>("standard");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTag, setBulkTag] = useState("");
  const [bulkUrl, setBulkUrl] = useState("");
  const [bulkOpenIntervalSeconds, setBulkOpenIntervalSeconds] = useState(
    DEFAULT_BULK_OPEN_INTERVAL_SECONDS
  );
  const [bulkOpenRunning, setBulkOpenRunning] = useState(false);
  const [windowInspecting, setWindowInspecting] = useState(false);
  const [windowTiling, setWindowTiling] = useState(false);
  const [windowSyncing, setWindowSyncing] = useState(false);
  const [layoutSourceProfileId, setLayoutSourceProfileId] = useState("");
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [healthReport, setHealthReport] = useState<RootHealthReport | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthRepairing, setHealthRepairing] = useState(false);
  const [orphanRegisteringId, setOrphanRegisteringId] = useState<string | null>(null);
  const [repairResult, setRepairResult] = useState<RootRepairResult | null>(null);
  const [backupResult, setBackupResult] = useState<ProfileBackupResult | null>(null);
  const [backupPathDraft, setBackupPathDraft] = useState("");
  const [backupWorking, setBackupWorking] = useState<"create" | "restore" | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [fullBackupScope, setFullBackupScope] = useState<FullBackupScope>("all");
  const [fullBackupPreview, setFullBackupPreview] =
    useState<FullProfileBackupPreview | null>(null);
  const [fullBackupResult, setFullBackupResult] =
    useState<FullProfileBackupResult | null>(null);
  const [fullBackupPathDraft, setFullBackupPathDraft] = useState("");
  const [fullRestorePreview, setFullRestorePreview] =
    useState<FullProfileRestorePreview | null>(null);
  const [fullBackupWorking, setFullBackupWorking] = useState<FullBackupWorking | null>(null);
  const [fullRestoreConfirmOpen, setFullRestoreConfirmOpen] = useState(false);
  const [message, setMessage] = useState("正在初始化...");
  const launchingProfileIdsRef = useRef(new Set<string>());
  const bulkOpenCancelledRef = useRef(false);
  const projectOpenCancelledRef = useRef(false);
  const bulkOpenDelayResolveRef = useRef<(() => void) | null>(null);

  const editingProfile =
    profiles.find((profile) => profile.id === editingId) ?? null;
  const editingProject =
    projects.find((project) => project.id === editingProjectId) ?? null;
  const selectedSize = editingProfile
    ? profileSizes[editingProfile.id] ?? null
    : null;

  const visibleProfiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return profiles.filter((profile) => {
      const matchesQuery =
        !normalizedQuery ||
        [profile.name, profile.id, profile.notes, ...profile.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      return matchesQuery;
    });
  }, [profiles, query]);

  const totalProfiles = profiles.length;
  const selectedProfiles = useMemo(
    () => profiles.filter((profile) => selectedIds.includes(profile.id)),
    [profiles, selectedIds]
  );
  const runningSelectedProfiles = useMemo(
    () => selectedProfiles.filter((profile) => runningProfileIds.includes(profile.id)),
    [runningProfileIds, selectedProfiles]
  );
  const resolvedLayoutSourceProfileId = useMemo(() => {
    if (
      layoutSourceProfileId &&
      runningSelectedProfiles.some((profile) => profile.id === layoutSourceProfileId)
    ) {
      return layoutSourceProfileId;
    }

    return runningSelectedProfiles[0]?.id ?? "";
  }, [layoutSourceProfileId, runningSelectedProfiles]);
  const selectedImportCount = useMemo(
    () =>
      importCandidates.filter(
        (candidate) =>
          isImportCandidateSelectable(candidate) && selectedImportPaths.includes(candidate.path)
      ).length,
    [importCandidates, selectedImportPaths]
  );
  const visibleUrlLibraryItems = useMemo(() => {
    const normalizedQuery = urlLibraryQuery.trim().toLowerCase();
    const urlLibrary = settings.urlLibrary ?? [];
    if (!normalizedQuery) {
      return urlLibrary;
    }

    return urlLibrary.filter((item) =>
      [item.name, item.url, item.notes, ...item.tags]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [settings.urlLibrary, urlLibraryQuery]);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settingsOpen ? themeDraft : settings.theme;
  }, [settings.theme, settingsOpen, themeDraft]);

  useEffect(() => {
    if (!rootPath || activeView !== "accounts") {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;

    async function refreshRunningStatus() {
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      try {
        const runningIds = await profileApi.listRunningProfiles(rootPath);
        if (!cancelled) {
          setRunningProfileIds((current) =>
            sameStringList(current, runningIds) ? current : runningIds
          );
        }
      } catch {
        if (!cancelled) {
          setRunningProfileIds([]);
        }
      } finally {
        refreshInFlight = false;
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void refreshRunningStatus();
      }
    }

    const intervalId = window.setInterval(refreshWhenVisible, RUNNING_STATUS_POLL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [activeView, rootPath]);

  useEffect(() => {
    if (!editingProfile || !rootPath) {
      return;
    }

    void refreshSelectedSize(editingProfile);
  }, [rootPath, editingProfile?.id]);

  useEffect(() => {
    const hasOpenDialog = Boolean(
      settingsOpen ||
        pendingUrlDeleteId ||
        urlLibraryEditorOpen ||
        newProjectDraft ||
        editingProjectId ||
        batchProfileDialogOpen ||
        newProfileDraft ||
        editingId
    );
    if (!hasOpenDialog) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      closeActiveDialog();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [
    settingsOpen,
    fullRestoreConfirmOpen,
    pendingUrlDeleteId,
    urlLibraryEditorOpen,
    newProjectDraft,
    editingProjectId,
    batchProfileDialogOpen,
    newProfileDraft,
    editingId,
    settings.browserPath
  ]);

  async function boot() {
    try {
      const defaultPath = await profileApi.defaultRootPath();
      setRootPath(defaultPath);
      await loadRoot(defaultPath);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function resetFullBackupState() {
    setFullBackupScope("all");
    setFullBackupPreview(null);
    setFullBackupResult(null);
    setFullBackupPathDraft("");
    setFullRestorePreview(null);
    setFullBackupWorking(null);
    setFullRestoreConfirmOpen(false);
  }

  async function loadRoot(path: string) {
    setMessage("正在检查配置根目录...");
    setHealthReport(null);
    setRepairResult(null);
    setBackupResult(null);
    setRestoreConfirmOpen(false);
    resetFullBackupState();
    const status = await profileApi.initProfileRoot(path);
    const document = await profileApi.loadProfiles(path);
    const loadedSettings = normalizeSettings(document.settings);
    const chrome = await profileApi.detectChrome(loadedSettings.browserPath);
    setRootStatus(status);
    setSettings(loadedSettings);
    setBrowserPathDraft(loadedSettings.browserPath);
    setThemeDraft(loadedSettings.theme);
    setChromeStatus(chrome);
    setProfiles(document.profiles);
    setProjects(document.projects);
    await refreshRunningProfiles(path);
    setEditingId(null);
    setEditingProfileDraft(null);
    setEditingProjectId(null);
    setEditingProjectDraft(null);
    setNewProfileDraft(null);
    setBatchProfileDialogOpen(false);
    setBatchProfileDraft("");
    setNewProjectDraft(null);
    setPendingProjectDeleteId(null);
    setUrlLibraryQuery("");
    setUrlLibraryDraft(createUrlLibraryDraft());
    setEditingUrlLibraryId(null);
    setUrlLibraryEditorOpen(false);
    setPendingUrlDeleteId(null);
    setPendingDelete(null);
    setPendingBatchDelete(null);
    setBatchDeleteWorking(null);
    setSelectedIds([]);
    setBulkTag("");
    setBulkUrl("");
    setProjectQuery("");
    setBulkOpenRunning(false);
    setWindowInspecting(false);
    setWindowTiling(false);
    setOpeningProjectId(null);
    bulkOpenCancelledRef.current = false;
    projectOpenCancelledRef.current = false;
    bulkOpenDelayResolveRef.current = null;
    launchingProfileIdsRef.current.clear();
    setProfileSizes({});
    setImportPath("");
    setImportCandidates([]);
    setSelectedImportPaths([]);
    setImportScanning(false);
    setImportingProfiles(false);
    setMessage(status.writable ? "根目录正常" : "根目录不可写");
  }

  async function refreshRunningProfiles(path = rootPath) {
    if (!path) {
      setRunningProfileIds([]);
      return;
    }

    try {
      setRunningProfileIds(await profileApi.listRunningProfiles(path));
    } catch {
      setRunningProfileIds([]);
    }
  }

  function updateRootPathDraft(value: string) {
    setRootPath(value);
    setHealthReport(null);
    setRepairResult(null);
    setBackupResult(null);
    setRestoreConfirmOpen(false);
    setFullBackupPreview(null);
    setFullBackupResult(null);
    setFullRestorePreview(null);
    setFullRestoreConfirmOpen(false);
  }

  async function persist(
    nextProfiles: ChromeProfile[],
    nextMessage: string,
    nextSettings = settings,
    nextProjects = projects
  ) {
    const sanitizedSettings = normalizeSettings(nextSettings);
    const existingProfileIds = new Set(nextProfiles.map((profile) => profile.id));
    const sanitizedProjects = nextProjects.map((project) => ({
      ...project,
      profileIds: project.profileIds.filter((profileId) => existingProfileIds.has(profileId))
    }));
    await profileApi.saveProfiles(rootPath, {
      version: 1,
      settings: sanitizedSettings,
      profiles: nextProfiles,
      projects: sanitizedProjects
    });
    setProfiles(nextProfiles);
    setProjects(sanitizedProjects);
    setSettings(sanitizedSettings);
    if (sanitizedSettings.browserPath !== settings.browserPath) {
      setBrowserPathDraft(sanitizedSettings.browserPath);
    }
    setRootStatus((current) =>
      current ? { ...current, profileCount: nextProfiles.length } : current
    );
    setSelectedIds((current) =>
      current.filter((id) => nextProfiles.some((profile) => profile.id === id))
    );
    setMessage(nextMessage);
  }

  async function createNewProfile() {
    const now = new Date().toISOString();
    const profile = createProfile(
      {
        name: `账号 ${profiles.length + 1}`,
        tags: [],
        notes: ""
      },
      profiles,
      now
    );
    setPendingDelete(null);
    setEditingId(null);
    setEditingProfileDraft(null);
    setEditingProjectId(null);
    setEditingProjectDraft(null);
    setNewProjectDraft(null);
    setBatchProfileDialogOpen(false);
    setNewProfileDraft(profile);
  }

  function openBatchProfileDialog() {
    setPendingDelete(null);
    setEditingId(null);
    setEditingProfileDraft(null);
    setEditingProjectId(null);
    setEditingProjectDraft(null);
    setNewProfileDraft(null);
    setNewProjectDraft(null);
    setBatchProfileDialogOpen(true);
  }

  function closeBatchProfileDialog() {
    setBatchProfileDialogOpen(false);
    setBatchProfileDraft("");
  }

  async function saveBatchProfileDraft() {
    const drafts = parseBatchProfileLines(batchProfileDraft);
    if (drafts.length === 0) {
      setMessage("请先填写账号名称");
      return;
    }

    const now = new Date().toISOString();
    const createdProfiles = drafts.reduce<ChromeProfile[]>((created, draft) => {
      const profile = createProfile(draft, [...profiles, ...created], now);
      return [...created, profile];
    }, []);

    await persist(
      [...profiles, ...createdProfiles],
      `已批量创建 ${createdProfiles.length} 个账号`
    );
    closeBatchProfileDialog();
  }

  async function updateNewProfileDraft(patch: Partial<ChromeProfile>) {
    const now = new Date().toISOString();
    setNewProfileDraft((current) =>
      current ? { ...current, ...patch, updatedAt: now } : current
    );
  }

  async function saveNewProfileDraft() {
    if (!newProfileDraft) {
      return;
    }

    const now = new Date().toISOString();
    const profile = updateProfile(
      newProfileDraft,
      {
        name: newProfileDraft.name,
        tags: newProfileDraft.tags,
        notes: newProfileDraft.notes,
        accountPlatforms: newProfileDraft.accountPlatforms,
        accentColor: newProfileDraft.accentColor
      },
      now
    );
    await persist([...profiles, profile], `已创建 ${profile.name}`);
    setNewProfileDraft(null);
  }

  async function updateProfileById(
    profileId: string,
    patch: Partial<ChromeProfile>,
    nextMessage: string
  ) {
    const now = new Date().toISOString();
    const nextProfiles = profiles.map((profile) =>
      profile.id === profileId ? updateProfile(profile, patch, now) : profile
    );
    await persist(nextProfiles, nextMessage);
  }

  async function updateEditingProfileDraft(patch: Partial<ChromeProfile>) {
    const now = new Date().toISOString();
    setEditingProfileDraft((current) =>
      current ? { ...current, ...patch, updatedAt: now } : current
    );
  }

  async function saveEditingProfileDraft() {
    if (!editingProfile || !editingProfileDraft) {
      return;
    }

    const now = new Date().toISOString();
    const savedProfile = updateProfile(
      editingProfile,
      {
        name: editingProfileDraft.name,
        tags: editingProfileDraft.tags,
        notes: editingProfileDraft.notes,
        accountPlatforms: editingProfileDraft.accountPlatforms,
        accentColor: editingProfileDraft.accentColor
      },
      now
    );
    const nextProfiles = profiles.map((profile) =>
      profile.id === savedProfile.id ? savedProfile : profile
    );
    await persist(nextProfiles, "账号信息已保存");
    setPendingDelete(null);
    setEditingId(null);
    setEditingProfileDraft(null);
  }

  async function openProfile(profile: ChromeProfile) {
    if (launchingProfileIdsRef.current.has(profile.id)) {
      setMessage(`${profile.name} 正在启动，请稍等`);
      return;
    }

    launchingProfileIdsRef.current.add(profile.id);

    try {
      if (!chromeStatus?.available) {
        setMessage("未检测到浏览器，请先设置浏览器路径");
        return;
      }
      await profileApi.openProfile(
        rootPath,
        profile.id,
        settings.browserPath,
        DEFAULT_PROFILE_LAUNCH_URL
      );
      setRunningProfileIds((current) =>
        current.includes(profile.id) ? current : [...current, profile.id]
      );
      await updateProfileById(
        profile.id,
        { lastOpenedAt: new Date().toISOString() },
        `已启动 ${profile.name}`
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      launchingProfileIdsRef.current.delete(profile.id);
    }
  }

  async function focusProfileWindow(profile: ChromeProfile) {
    try {
      await profileApi.focusProfileWindow(rootPath, profile.id);
      setMessage(`已切换到 ${profile.name}`);
      await refreshRunningProfiles();
    } catch (error) {
      setMessage(windowAutomationErrorMessage(error));
      await refreshRunningProfiles();
    }
  }

  async function openAccountPlatform(
    profile: ChromeProfile,
    accountPlatform: AccountPlatform
  ) {
    const launchUrl = normalizeLaunchUrl(accountPlatform.loginUrl);
    const platformLabel = accountPlatform.platform || "未命名平台";
    if (!launchUrl) {
      setMessage("请先设置登录网址");
      return;
    }

    try {
      if (!chromeStatus?.available) {
        setMessage("未检测到浏览器，请先设置浏览器路径");
        return;
      }
      await profileApi.openProfile(rootPath, profile.id, settings.browserPath, launchUrl);
      await updateProfileById(
        profile.id,
        { lastOpenedAt: new Date().toISOString() },
        `已打开 ${platformLabel}`
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function copyAccountPlatformUsername(accountPlatform: AccountPlatform) {
    if (!accountPlatform.username) {
      setMessage("这个平台还没有填写用户名");
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        setMessage("当前环境不能复制到剪贴板");
        return;
      }
      await navigator.clipboard.writeText(accountPlatform.username);
      setMessage("用户名已复制");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function copyProjectUrlToClipboard(projectUrl: ProjectUrl) {
    const launchUrl = normalizeLaunchUrl(projectUrl.url);
    if (!launchUrl) {
      setMessage("这条网址为空");
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        setMessage("当前环境不能复制到剪贴板");
        return;
      }
      await navigator.clipboard.writeText(launchUrl);
      setMessage("网址已复制");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function revealEditingProfile() {
    if (!editingProfile) {
      return;
    }

    try {
      await profileApi.revealPath(profilePath(rootPath, editingProfile.id));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function refreshSelectedSize(profile: ChromeProfile) {
    try {
      const size = await profileApi.profileDirectorySize(
        profilePath(rootPath, profile.id)
      );
      setProfileSizes((current) => ({ ...current, [profile.id]: size }));
    } catch {
      setProfileSizes((current) => ({ ...current, [profile.id]: null }));
    }
  }

  async function saveSettingsDraft() {
    const nextSettings = normalizeSettings({
      ...settings,
      browserPath: browserPathDraft,
      theme: themeDraft
    });
    await persist(profiles, "设置已保存", nextSettings);
    setChromeStatus(await profileApi.detectChrome(nextSettings.browserPath));
  }

  function openSettingsDialog() {
    setBrowserPathDraft(settings.browserPath);
    setThemeDraft(settings.theme);
    setSettingsOpen(true);
  }

  function closeSettingsDialog() {
    setBrowserPathDraft(settings.browserPath);
    setThemeDraft(settings.theme);
    setRestoreConfirmOpen(false);
    setFullRestoreConfirmOpen(false);
    setSettingsOpen(false);
  }

  function closeActiveDialog() {
    if (fullRestoreConfirmOpen) {
      setFullRestoreConfirmOpen(false);
      return;
    }
    if (pendingBatchDelete) {
      setPendingBatchDelete(null);
      return;
    }
    if (pendingDelete) {
      setPendingDelete(null);
      return;
    }
    if (pendingUrlDeleteId) {
      setPendingUrlDeleteId(null);
      return;
    }
    if (urlLibraryEditorOpen) {
      cancelUrlLibraryEdit();
      return;
    }
    if (settingsOpen) {
      closeSettingsDialog();
      return;
    }
    if (newProjectDraft) {
      setNewProjectDraft(null);
      return;
    }
    if (editingProjectId) {
      setPendingProjectDeleteId(null);
      setEditingProjectId(null);
      setEditingProjectDraft(null);
      return;
    }
    if (batchProfileDialogOpen) {
      closeBatchProfileDialog();
      return;
    }
    if (newProfileDraft) {
      setNewProfileDraft(null);
      return;
    }
    if (editingId) {
      closeEditor();
    }
  }

  function openEditor(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    setPendingDelete(null);
    setNewProfileDraft(null);
    setBatchProfileDialogOpen(false);
    setNewProjectDraft(null);
    setEditingProjectId(null);
    setEditingProjectDraft(null);
    setEditingProfileDraft(cloneProfileForDraft(profile));
    setEditingId(profileId);
  }

  function closeEditor() {
    setPendingDelete(null);
    setEditingId(null);
    setEditingProfileDraft(null);
  }

  function requestDeleteEditingProfile(mode: DeleteMode) {
    if (!editingProfile) {
      return;
    }

    setPendingDelete({ profile: editingProfile, mode });
  }

  function requestDeleteSelectedProfiles() {
    if (selectedProfiles.length === 0) {
      return;
    }

    setPendingBatchDelete(selectedProfiles);
  }

  async function confirmPendingDelete() {
    if (!pendingDelete) {
      return;
    }

    try {
      if (pendingDelete.mode === "data") {
        await profileApi.deleteProfileData(rootPath, pendingDelete.profile.id);
      }
      const result = removeProfile(profiles, pendingDelete.profile.id);
      await persist(
        result.profiles,
        pendingDelete.mode === "data" ? "账号和文件夹已删除" : "账号记录已删除"
      );
      setEditingId(null);
      setEditingProfileDraft(null);
      setProfileSizes((current) => {
        const next = { ...current };
        delete next[pendingDelete.profile.id];
        return next;
      });
      setPendingDelete(null);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function confirmPendingBatchDelete(mode: DeleteMode) {
    if (!pendingBatchDelete || pendingBatchDelete.length === 0) {
      return;
    }

    const deleteIds = new Set(pendingBatchDelete.map((profile) => profile.id));
    setBatchDeleteWorking(mode);
    try {
      if (mode === "data") {
        for (const profile of pendingBatchDelete) {
          await profileApi.deleteProfileData(rootPath, profile.id);
        }
      }

      const nextProfiles = profiles.filter((profile) => !deleteIds.has(profile.id));
      await persist(
        nextProfiles,
        mode === "data"
          ? `已删除 ${pendingBatchDelete.length} 个账号和文件夹`
          : `已删除 ${pendingBatchDelete.length} 个账号记录`
      );
      setProfileSizes((current) => {
        const next = { ...current };
        deleteIds.forEach((profileId) => {
          delete next[profileId];
        });
        return next;
      });
      setSelectedIds([]);
      setPendingBatchDelete(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBatchDeleteWorking(null);
    }
  }

  async function duplicateEditingProfile() {
    if (!editingProfile) {
      return;
    }

    try {
      const now = new Date().toISOString();
      const duplicated = duplicateProfile(editingProfile, profiles, now);
      await profileApi.copyProfileData(rootPath, editingProfile.id, duplicated.id);
      const nextProfiles = [...profiles, duplicated];
      await persist(nextProfiles, `已复制 ${duplicated.name}`);
      setEditingId(duplicated.id);
      setEditingProfileDraft(cloneProfileForDraft(duplicated));
      await refreshSelectedSize(duplicated);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function scanImportCandidates() {
    const sourcePath = importPath.trim();
    if (!sourcePath) {
      setMessage("请先填写要扫描的来源目录");
      return;
    }

    setImportScanning(true);
    setImportCandidates([]);
    setSelectedImportPaths([]);
    try {
      const candidates = await profileApi.scanProfileImportCandidates(rootPath, sourcePath);
      setImportCandidates(candidates);
      setSelectedImportPaths(
        candidates
          .filter((candidate) => candidate.confidence === "ready" && !candidate.duplicateProfileId)
          .map((candidate) => candidate.path)
      );
      const readyCount = candidates.filter(
        (candidate) => candidate.confidence === "ready" && !candidate.duplicateProfileId
      ).length;
      const suspiciousCount = candidates.filter(
        (candidate) => candidate.confidence === "suspicious" && !candidate.duplicateProfileId
      ).length;
      const duplicateCount = candidates.filter((candidate) => candidate.duplicateProfileId).length;
      setMessage(`可导入 ${readyCount} · 可疑 ${suspiciousCount} · 已导入 ${duplicateCount}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setImportScanning(false);
    }
  }

  function toggleImportCandidate(path: string) {
    setSelectedImportPaths((current) =>
      current.includes(path)
        ? current.filter((selectedPath) => selectedPath !== path)
        : [...current, path]
    );
  }

  async function importSelectedCandidates() {
    const selectedCandidates = importCandidates.filter(
      (candidate) =>
        isImportCandidateSelectable(candidate) && selectedImportPaths.includes(candidate.path)
    );
    if (selectedCandidates.length === 0) {
      setMessage("请先选择要导入的候选目录");
      return;
    }

    const now = new Date().toISOString();
    const createdProfiles: ChromeProfile[] = [];
    setImportingProfiles(true);
    try {
      for (const candidate of selectedCandidates) {
        const profileUid = createProfileUid();
        const profile = createProfile(
          {
            name: candidate.suggestedName,
            tags: candidate.suggestedTags,
            notes: candidate.suggestedNotes.trim() || `来源：${candidate.path}`,
            importSource: {
              profileUid,
              sourcePath: candidate.path,
              sourceFolderName: candidate.folderName,
              importedAt: now
            }
          },
          [...profiles, ...createdProfiles],
          now
        );
        const marker: ProfileMarker = {
          schemaVersion: 1,
          app: "MultiChrome",
          profileUid,
          profileId: profile.id,
          name: profile.name,
          sourcePath: candidate.path,
          sourceFolderName: candidate.folderName,
          importedAt: now
        };
        await profileApi.importProfileData(rootPath, candidate.path, profile.id, marker);
        createdProfiles.push(profile);
      }

      await persist(
        [...profiles, ...createdProfiles],
        `已批量导入 ${createdProfiles.length} 个账号`
      );
      setImportPath("");
      setImportCandidates([]);
      setSelectedImportPaths([]);
      setShowImport(false);
      if (createdProfiles[0]) {
        setEditingId(createdProfiles[0].id);
        setEditingProfileDraft(cloneProfileForDraft(createdProfiles[0]));
      }
    } catch (error) {
      for (const profile of createdProfiles) {
        try {
          await profileApi.deleteProfileData(rootPath, profile.id);
        } catch {
          // 回滚失败不覆盖原始导入错误，避免用户看不到真正原因。
        }
      }
      setMessage(errorMessage(error));
    } finally {
      setImportingProfiles(false);
    }
  }

  async function createNewProject() {
    const now = new Date().toISOString();
    const project = createProject(projects, selectedIds, now);
    setActiveView("projects");
    setEditingProjectId(null);
    setEditingProjectDraft(null);
    setNewProfileDraft(null);
    setNewProjectDraft(project);
  }

  async function updateNewProjectDraft(patch: Partial<AirdropProject>) {
    const now = new Date().toISOString();
    setNewProjectDraft((current) =>
      current ? updateProject(current, patch, now) : current
    );
  }

  async function saveNewProjectDraft(patch: Partial<AirdropProject> = {}) {
    if (!newProjectDraft) {
      return;
    }

    const now = new Date().toISOString();
    const project = updateProject(newProjectDraft, patch, now);
    await persist(profiles, `已创建 ${project.name}`, settings, [...projects, project]);
    setNewProjectDraft(null);
  }

  async function updateEditingProject(patch: Partial<AirdropProject>) {
    const now = new Date().toISOString();
    setEditingProjectDraft((current) =>
      current ? updateProject(current, patch, now) : current
    );
  }

  async function saveEditingProjectDraft(patch: Partial<AirdropProject> = {}) {
    if (!editingProject || !editingProjectDraft) {
      return;
    }

    const now = new Date().toISOString();
    const projectDraft = updateProject(editingProjectDraft, patch, now);
    const savedProject = updateProject(
      editingProject,
      {
        name: projectDraft.name,
        url: projectDraft.url,
        urls: projectDraft.urls,
        notes: projectDraft.notes,
        profileIds: projectDraft.profileIds,
        intervalSeconds: projectDraft.intervalSeconds
      },
      now
    );
    const nextProjects = projects.map((project) =>
      project.id === savedProject.id ? savedProject : project
    );
    await persist(profiles, "项目信息已保存", settings, nextProjects);
    setEditingProjectId(null);
    setEditingProjectDraft(null);
    setPendingProjectDeleteId(null);
  }

  async function duplicateProjectById(projectId: string) {
    const source = projects.find((project) => project.id === projectId);
    if (!source) {
      return;
    }

    const now = new Date().toISOString();
    const duplicated = duplicateProject(source, projects, now);
    await persist(profiles, `已复制项目 ${duplicated.name}`, settings, [
      ...projects,
      duplicated
    ]);
  }

  function requestDeleteEditingProject() {
    if (!editingProject) {
      return;
    }

    setPendingProjectDeleteId(editingProject.id);
  }

  async function confirmDeleteEditingProject() {
    if (!editingProject || pendingProjectDeleteId !== editingProject.id) {
      return;
    }

    const nextProjects = projects.filter((project) => project.id !== editingProject.id);
    await persist(profiles, `已删除项目 ${editingProject.name}`, settings, nextProjects);
    setEditingProjectId(null);
    setEditingProjectDraft(null);
    setPendingProjectDeleteId(null);
  }

  function stopOpeningProject() {
    if (!openingProjectId) {
      return;
    }

    projectOpenCancelledRef.current = true;
    bulkOpenDelayResolveRef.current?.();
    bulkOpenDelayResolveRef.current = null;
    setMessage("正在停止项目打开...");
  }

  async function openProject(project: AirdropProject, projectUrlId?: string) {
    if (openingProjectId) {
      setMessage("已有项目正在打开");
      return;
    }

    const launchUrls = projectUrlId
      ? projectOpenUrls(project).filter((projectUrl) => projectUrl.id === projectUrlId)
      : projectOpenUrls(project);
    if (launchUrls.length === 0) {
      setMessage("请先设置项目网址");
      return;
    }
    if (!chromeStatus?.available) {
      setMessage("未检测到浏览器，请先设置浏览器路径");
      return;
    }

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const queuedProfiles = project.profileIds
      .map((profileId) => profileById.get(profileId))
      .filter((profile): profile is ChromeProfile => Boolean(profile));
    if (queuedProfiles.length === 0) {
      setMessage("请先给项目绑定账号");
      return;
    }

    const intervalMilliseconds =
      normalizeBulkOpenIntervalSeconds(String(project.intervalSeconds)) * 1000;
    const openedIds = new Set<string>();
    let failedCount = 0;

    projectOpenCancelledRef.current = false;
    setOpeningProjectId(project.id);
    try {
      for (const [index, profile] of queuedProfiles.entries()) {
        if (projectOpenCancelledRef.current) {
          break;
        }

        setMessage(`正在打开项目 ${project.name} ${index + 1} / ${queuedProfiles.length}`);
        try {
          for (const projectUrl of launchUrls) {
            await profileApi.openProfile(
              rootPath,
              profile.id,
              settings.browserPath,
              projectUrl.url
            );
          }
          openedIds.add(profile.id);
        } catch {
          failedCount += 1;
        }

        if (
          index < queuedProfiles.length - 1 &&
          !projectOpenCancelledRef.current
        ) {
          await waitForBulkOpenInterval(intervalMilliseconds);
        }
      }

      const now = new Date().toISOString();
      const stopped = projectOpenCancelledRef.current;
      const nextProfiles = profiles.map((profile) =>
        openedIds.has(profile.id)
          ? updateProfile(profile, { lastOpenedAt: now }, now)
          : profile
      );
      const nextProjects = projects.map((currentProject) =>
        currentProject.id === project.id
          ? updateProject(currentProject, { lastOpenedAt: now }, now)
          : currentProject
      );
      const nextSettings = normalizeSettings({
        ...settings,
        recentUrls: [
          ...launchUrls.map((projectUrl) => projectUrl.url),
          ...settings.recentUrls
        ]
      });
      const urlLabel =
        launchUrls.length === 1 && projectUrlId ? `，${launchUrls[0].name}` : "";
      const urlCountLabel = launchUrls.length > 1 ? `，${launchUrls.length} 个网址` : "";
      const finalMessage =
        stopped
          ? `已停止项目 ${project.name}，已打开 ${openedIds.size} / ${queuedProfiles.length} 个账号`
          : failedCount > 0
          ? `已打开项目 ${project.name}：${openedIds.size} 个账号${urlCountLabel}${urlLabel}，${failedCount} 个失败`
          : `已打开项目 ${project.name}：${openedIds.size} 个账号${urlCountLabel}${urlLabel}`;
      await persist(nextProfiles, finalMessage, nextSettings, nextProjects);
    } finally {
      projectOpenCancelledRef.current = false;
      bulkOpenDelayResolveRef.current = null;
      setOpeningProjectId(null);
    }
  }

  async function applyRootPath() {
    try {
      await loadRoot(rootPath);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function runRootHealthCheck() {
    if (!rootPath.trim()) {
      setMessage("请先填写配置根目录");
      return;
    }

    setHealthChecking(true);
    try {
      const report = await profileApi.checkProfileRootHealth(rootPath);
      setHealthReport(report);
      setRepairResult(null);
      const { errorCount, warningCount } = report.summary;
      if (errorCount > 0) {
        setMessage(`健康检查发现 ${errorCount} 个错误`);
      } else if (warningCount > 0) {
        setMessage(`健康检查发现 ${warningCount} 个提醒`);
      } else {
        setMessage("目录健康检查通过");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setHealthChecking(false);
    }
  }

  async function repairRootHealth() {
    if (!rootPath.trim()) {
      setMessage("请先填写配置根目录");
      return;
    }

    setHealthRepairing(true);
    try {
      const result = await profileApi.repairProfileRootHealth(rootPath);
      setRepairResult(result);
      setHealthReport(result.health);
      if (result.repairedCount > 0) {
        setMessage(`已修复 ${result.repairedCount} 个问题`);
      } else {
        setMessage("没有可自动修复的问题");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setHealthRepairing(false);
    }
  }

  async function registerOrphanProfile(profileId: string) {
    if (!rootPath.trim()) {
      setMessage("请先填写配置根目录");
      return;
    }
    if (profiles.some((profile) => profile.id === profileId)) {
      setMessage(`${profileId} 已经登记`);
      return;
    }

    const now = new Date().toISOString();
    const profile: ChromeProfile = {
      id: profileId,
      name: profileId,
      tags: [],
      notes: "从已有 Profile 目录登记",
      status: "active",
      accountPlatforms: [],
      accentColor: defaultAccentColor(profileId),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null
    };

    setOrphanRegisteringId(profileId);
    try {
      await persist([...profiles, profile], `已登记 ${profileId}`);
      const report = await profileApi.checkProfileRootHealth(rootPath);
      setHealthReport(report);
      setRepairResult(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setOrphanRegisteringId(null);
    }
  }

  async function createBackup() {
    if (!rootPath.trim()) {
      setMessage("请先填写配置根目录");
      return;
    }

    setBackupWorking("create");
    try {
      const backup = await profileApi.createProfilesBackup(rootPath);
      setBackupResult(backup);
      setBackupPathDraft(backup.path);
      setRestoreConfirmOpen(false);
      setMessage(`已创建备份：${backup.profileCount} 个账号`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBackupWorking(null);
    }
  }

  function requestRestoreBackup() {
    const backupPath = backupPathDraft.trim();
    if (!backupPath) {
      setMessage("请先填写备份文件路径");
      return;
    }

    setRestoreConfirmOpen(true);
  }

  async function restoreBackup() {
    const backupPath = backupPathDraft.trim();
    setBackupWorking("restore");
    try {
      const document = await profileApi.restoreProfilesBackup(rootPath, backupPath);
      const restoredSettings = normalizeSettings(document.settings);
      const status = await profileApi.initProfileRoot(rootPath);
      const chrome = await profileApi.detectChrome(restoredSettings.browserPath);
      setProfiles(document.profiles);
      setProjects(document.projects);
      setSettings(restoredSettings);
      setBrowserPathDraft(restoredSettings.browserPath);
      setThemeDraft(restoredSettings.theme);
      setRootStatus(status);
      setChromeStatus(chrome);
      setEditingId(null);
      setEditingProfileDraft(null);
      setEditingProjectId(null);
      setEditingProjectDraft(null);
      setNewProfileDraft(null);
      setNewProjectDraft(null);
      setPendingProjectDeleteId(null);
      setPendingDelete(null);
      setSelectedIds([]);
      setBulkTag("");
      setBulkUrl("");
      setProjectQuery("");
      setOpeningProjectId(null);
      setProfileSizes({});
      setHealthReport(null);
      setRepairResult(null);
      setBackupResult(null);
      setRestoreConfirmOpen(false);
      launchingProfileIdsRef.current.clear();
      projectOpenCancelledRef.current = false;
      setMessage(`已从备份恢复 ${document.profiles.length} 个账号`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBackupWorking(null);
    }
  }

  function selectedFullBackupProfileIds() {
    if (fullBackupScope === "all") {
      return [];
    }

    return selectedIds;
  }

  function updateFullBackupScope(scope: FullBackupScope) {
    setFullBackupScope(scope);
    setFullBackupPreview(null);
    setFullBackupResult(null);
  }

  async function previewFullBackup() {
    if (!rootPath.trim()) {
      setMessage("请先填写配置根目录");
      return;
    }
    if (fullBackupScope === "selected" && selectedIds.length === 0) {
      setMessage("请先选择要完整备份的账号");
      return;
    }

    setFullBackupWorking("preview");
    setFullBackupResult(null);
    try {
      const preview = await profileApi.previewFullProfileBackup(
        rootPath,
        selectedFullBackupProfileIds()
      );
      setFullBackupPreview(preview);
      setMessage(`已预览完整备份：${preview.profileCount} 个账号`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setFullBackupWorking(null);
    }
  }

  async function createFullBackup() {
    if (!rootPath.trim()) {
      setMessage("请先填写配置根目录");
      return;
    }
    if (fullBackupScope === "selected" && selectedIds.length === 0) {
      setMessage("请先选择要完整备份的账号");
      return;
    }

    setFullBackupWorking("create");
    try {
      const backup = await profileApi.createFullProfileBackup(
        rootPath,
        selectedFullBackupProfileIds()
      );
      setFullBackupResult(backup);
      setFullBackupPathDraft(backup.path);
      setFullRestorePreview(null);
      setFullRestoreConfirmOpen(false);
      setMessage(`完整备份已创建：${backup.profileCount} 个账号`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setFullBackupWorking(null);
    }
  }

  async function previewFullRestore() {
    const backupPath = fullBackupPathDraft.trim();
    if (!backupPath) {
      setMessage("请先填写完整备份目录路径");
      return;
    }

    setFullBackupWorking("restore-preview");
    setFullRestorePreview(null);
    setFullRestoreConfirmOpen(false);
    try {
      const preview = await profileApi.previewFullProfileRestore(rootPath, backupPath);
      setFullRestorePreview(preview);
      setMessage(`已扫描完整备份：${preview.profileCount} 个账号`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setFullBackupWorking(null);
    }
  }

  function requestFullRestore() {
    if (!fullRestorePreview) {
      setMessage("请先扫描完整备份");
      return;
    }

    setFullRestoreConfirmOpen(true);
  }

  async function restoreFullBackup() {
    if (!fullRestorePreview) {
      return;
    }

    setFullBackupWorking("restore");
    try {
      const document = await profileApi.restoreFullProfileBackup(
        rootPath,
        fullRestorePreview.path,
        true
      );
      const restoredSettings = normalizeSettings(document.settings);
      const status = await profileApi.initProfileRoot(rootPath);
      const chrome = await profileApi.detectChrome(restoredSettings.browserPath);
      setProfiles(document.profiles);
      setProjects(document.projects);
      setSettings(restoredSettings);
      setBrowserPathDraft(restoredSettings.browserPath);
      setThemeDraft(restoredSettings.theme);
      setRootStatus(status);
      setChromeStatus(chrome);
      setEditingId(null);
      setEditingProfileDraft(null);
      setEditingProjectId(null);
      setEditingProjectDraft(null);
      setNewProfileDraft(null);
      setNewProjectDraft(null);
      setPendingProjectDeleteId(null);
      setPendingDelete(null);
      setSelectedIds([]);
      setBulkTag("");
      setBulkUrl("");
      setProjectQuery("");
      setOpeningProjectId(null);
      setProfileSizes({});
      setHealthReport(null);
      setRepairResult(null);
      setFullRestorePreview(null);
      setFullRestoreConfirmOpen(false);
      launchingProfileIdsRef.current.clear();
      projectOpenCancelledRef.current = false;
      setMessage(`完整备份已恢复：${document.profiles.length} 个账号`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setFullBackupWorking(null);
    }
  }

  async function revealRootDirectory() {
    if (!rootPath.trim()) {
      setMessage("请先填写配置根目录");
      return;
    }

    try {
      await profileApi.revealPath(rootPath);
      setMessage("已打开数据目录");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function revealBackupsDirectory() {
    if (!rootPath.trim()) {
      setMessage("请先填写配置根目录");
      return;
    }

    try {
      await profileApi.revealProfileBackupsDir(rootPath);
      setMessage("已打开备份目录");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function toggleCardDensity() {
    setCardDensity((current) => (current === "standard" ? "compact" : "standard"));
  }

  function toggleProfileSelection(profileId: string, selected: boolean) {
    setSelectedIds((current) => {
      if (selected) {
        return current.includes(profileId) ? current : [...current, profileId];
      }
      return current.filter((id) => id !== profileId);
    });
  }

  function selectVisibleProfiles() {
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleProfiles.forEach((profile) => next.add(profile.id));
      return [...next];
    });
  }

  function clearSelection() {
    setSelectedIds([]);
    setBulkTag("");
  }

  async function appendBulkTags() {
    const tags = bulkTag
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (selectedProfiles.length === 0) {
      return;
    }
    if (tags.length === 0) {
      setMessage("请先填写要追加的标签");
      return;
    }

    const now = new Date().toISOString();
    const selected = new Set(selectedIds);
    const nextProfiles = profiles.map((profile) =>
      selected.has(profile.id)
        ? updateProfile(profile, { tags: [...profile.tags, ...tags] }, now)
        : profile
    );
    await persist(nextProfiles, `已给 ${selectedProfiles.length} 个账号追加标签`);
    setBulkTag("");
  }

  async function addFavoriteUrl() {
    const launchUrl = normalizeLaunchUrl(bulkUrl);
    if (!launchUrl) {
      setMessage("请先填写要收藏的网址");
      return;
    }

    if ((settings.urlLibrary ?? []).some((item) => item.url === launchUrl)) {
      setMessage("常用网址已存在");
      return;
    }

    const now = new Date().toISOString();
    const item = createUrlLibraryItem(
      {
        name: displayUrlLabel(launchUrl),
        url: launchUrl,
        tags: [],
        notes: ""
      },
      settings.urlLibrary ?? [],
      now
    );
    const nextSettings = normalizeSettings({
      ...settings,
      urlLibrary: [item, ...(settings.urlLibrary ?? [])]
    });
    await persist(profiles, "已添加常用网址", nextSettings);
  }

  async function removeFavoriteUrl(url: string) {
    const launchUrl = normalizeLaunchUrl(url);
    const nextSettings = normalizeSettings({
      ...settings,
      favoriteUrls: settings.favoriteUrls.filter((item) => item !== launchUrl),
      urlLibrary: (settings.urlLibrary ?? []).filter((item) => item.url !== launchUrl)
    });
    await persist(profiles, "已删除常用网址", nextSettings);
  }

  function startEditingUrlLibraryItem(item: UrlLibraryItem) {
    setEditingUrlLibraryId(item.id);
    setUrlLibraryDraft(createUrlLibraryDraft(item));
    setPendingUrlDeleteId(null);
    setUrlLibraryEditorOpen(true);
  }

  function startCreatingUrlLibraryItem() {
    setEditingUrlLibraryId(null);
    setUrlLibraryDraft(createUrlLibraryDraft());
    setPendingUrlDeleteId(null);
    setUrlLibraryEditorOpen(true);
  }

  function cancelUrlLibraryEdit() {
    setEditingUrlLibraryId(null);
    setPendingUrlDeleteId(null);
    setUrlLibraryDraft(createUrlLibraryDraft());
    setUrlLibraryEditorOpen(false);
  }

  async function saveUrlLibraryDraft() {
    const launchUrl = normalizeLaunchUrl(urlLibraryDraft.url);
    if (!launchUrl) {
      setMessage("请先填写网址");
      return;
    }

    const now = new Date().toISOString();
    const currentLibrary = settings.urlLibrary ?? [];
    const duplicate = currentLibrary.find(
      (item) => item.url === launchUrl && item.id !== editingUrlLibraryId
    );
    if (duplicate) {
      setMessage("网址已存在");
      return;
    }

    const patch = {
      name: urlLibraryDraft.name.trim() || displayUrlLabel(launchUrl),
      url: launchUrl,
      tags: parseUrlTags(urlLibraryDraft.tags),
      notes: urlLibraryDraft.notes.trim()
    };
    const nextLibrary = editingUrlLibraryId
      ? currentLibrary.map((item) =>
          item.id === editingUrlLibraryId
            ? {
                ...item,
                ...patch,
                updatedAt: now
              }
            : item
        )
      : [
          createUrlLibraryItem(patch, currentLibrary, now),
          ...currentLibrary
        ];
    const nextSettings = normalizeSettings({
      ...settings,
      urlLibrary: nextLibrary
    });

    await persist(profiles, "已保存网址", nextSettings);
    setEditingUrlLibraryId(null);
    setPendingUrlDeleteId(null);
    setUrlLibraryDraft(createUrlLibraryDraft());
    setUrlLibraryEditorOpen(false);
  }

  async function copyUrlFromLibrary(url: string) {
    const launchUrl = normalizeLaunchUrl(url);
    if (!launchUrl) {
      setMessage("这条网址为空");
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        setMessage("当前环境不能复制到剪贴板");
        return;
      }
      await navigator.clipboard.writeText(launchUrl);
      setMessage("网址已复制");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function fillBulkUrlFromLibrary(url: string) {
    const launchUrl = normalizeLaunchUrl(url);
    if (!launchUrl) {
      setMessage("这条网址为空");
      return;
    }

    setBulkUrl(launchUrl);
    setActiveView("accounts");
    setMessage("已填入批量打开网址");
  }

  function requestDeleteUrlLibraryItem(itemId: string) {
    setPendingUrlDeleteId(itemId);
  }

  async function confirmDeleteUrlLibraryItem() {
    if (!pendingUrlDeleteId) {
      return;
    }

    const item = (settings.urlLibrary ?? []).find(
      (libraryItem) => libraryItem.id === pendingUrlDeleteId
    );
    if (!item) {
      setPendingUrlDeleteId(null);
      return;
    }

    const nextSettings = normalizeSettings({
      ...settings,
      favoriteUrls: settings.favoriteUrls.filter((url) => url !== item.url),
      urlLibrary: (settings.urlLibrary ?? []).filter(
        (libraryItem) => libraryItem.id !== pendingUrlDeleteId
      )
    });
    await persist(profiles, "已删除网址", nextSettings);
    if (editingUrlLibraryId === pendingUrlDeleteId) {
      setEditingUrlLibraryId(null);
      setUrlLibraryDraft(createUrlLibraryDraft());
    }
    setPendingUrlDeleteId(null);
  }

  async function inspectWindowsForSelectedProfiles() {
    const runningSelectedProfiles = selectedProfiles.filter((profile) =>
      runningProfileIds.includes(profile.id)
    );

    if (runningSelectedProfiles.length === 0) {
      setMessage("选中的账号没有运行窗口");
      await refreshRunningProfiles();
      return;
    }

    setWindowInspecting(true);
    try {
      const summaries: string[] = [];
      for (const profile of runningSelectedProfiles) {
        const windows = await profileApi.listProfileWindows(rootPath, profile.id);
        summaries.push(formatWindowInspectionSummary(profile.name, windows));
      }
      setMessage(`窗口检查：${summaries.join("；")}`);
      await refreshRunningProfiles();
    } catch (error) {
      setMessage(windowAutomationErrorMessage(error));
      await refreshRunningProfiles();
    } finally {
      setWindowInspecting(false);
    }
  }

  async function tileWindowsForSelectedProfiles() {
    const runningSelectedProfiles = selectedProfiles.filter((profile) =>
      runningProfileIds.includes(profile.id)
    );

    if (runningSelectedProfiles.length === 0) {
      setMessage("选中的账号没有运行窗口");
      await refreshRunningProfiles();
      return;
    }

    setWindowTiling(true);
    try {
      const tileableProfiles: ChromeProfile[] = [];
      let noWindowCount = 0;
      let multiWindowProfileCount = 0;
      let failedCount = 0;
      let firstFailedError: unknown = null;

      for (const profile of runningSelectedProfiles) {
        try {
          const windows = await profileApi.listProfileWindows(rootPath, profile.id);
          if (windows.length > 0) {
            tileableProfiles.push(profile);
            if (windows.length > 1) {
              multiWindowProfileCount += 1;
            }
          } else {
            noWindowCount += 1;
          }
        } catch (error) {
          failedCount += 1;
          firstFailedError ??= error;
        }
      }

      if (tileableProfiles.length === 0) {
        setMessage(
          firstFailedError
            ? windowAutomationErrorMessage(firstFailedError)
            : "选中的运行账号没有可平铺窗口"
        );
        await refreshRunningProfiles();
        return;
      }

      const screenWidth = availableScreenWidth();
      const screenHeight = availableScreenHeight();
      const maxTileableCount = maxTileableWindowCount(screenWidth, screenHeight);
      if (tileableProfiles.length > maxTileableCount) {
        setMessage(
          `当前屏幕最多适合平铺 ${maxTileableCount} 个窗口；已选运行窗口 ${tileableProfiles.length} 个，请减少选择或分批平铺`
        );
        await refreshRunningProfiles();
        return;
      }

      const bounds = tileBoundsForCount(
        tileableProfiles.length,
        screenWidth,
        screenHeight,
        availableScreenLeft(),
        availableScreenTop()
      );
      let tiledCount = 0;
      let unchangedCount = 0;
      let firstTiledProfileId: string | null = null;

      for (const [index, profile] of tileableProfiles.entries()) {
        try {
          const targetBounds = bounds[index];
          await profileApi.setProfileWindowBounds(rootPath, profile.id, targetBounds);
          const updatedWindows = await profileApi.listProfileWindows(rootPath, profile.id);
          if (
            !updatedWindows[0] ||
            !windowMatchesBounds(updatedWindows[0], targetBounds)
          ) {
            unchangedCount += 1;
            continue;
          }
          tiledCount += 1;
          firstTiledProfileId ??= profile.id;
        } catch (error) {
          failedCount += 1;
          firstFailedError ??= error;
        }
      }

      if (tiledCount > 0) {
        const messageParts = [`已平铺 ${tiledCount} 个窗口`];
        if (noWindowCount > 0) {
          messageParts.push(`${noWindowCount} 个没有可平铺窗口`);
        }
        if (multiWindowProfileCount > 0) {
          messageParts.push(
            `${multiWindowProfileCount} 个账号存在多个窗口，仅平铺首个窗口`
          );
        }
        if (unchangedCount > 0) {
          messageParts.push(`${unchangedCount} 个未生效`);
        }
        if (failedCount > 0) {
          messageParts.push(`${failedCount} 个失败`);
        }
        let successMessage = messageParts.join("，");
        if (firstTiledProfileId) {
          try {
            await profileApi.focusProfileWindow(rootPath, firstTiledProfileId);
          } catch (error) {
            successMessage = `${successMessage}，但未能拉到前台：${errorMessage(error)}`;
          }
        }
        setMessage(successMessage);
      } else {
        if (unchangedCount > 0) {
          const messageParts = [`平铺窗口未生效：${unchangedCount} 个未生效`];
          if (failedCount > 0) {
            messageParts.push(`${failedCount} 个失败`);
          }
          setMessage(messageParts.join("，"));
        } else {
          setMessage(
            firstFailedError
              ? windowAutomationErrorMessage(firstFailedError)
              : `平铺窗口失败：${failedCount} 个账号未处理`
          );
        }
      }
      await refreshRunningProfiles();
    } finally {
      setWindowTiling(false);
    }
  }

  async function syncLayoutForSelectedProfiles() {
    if (runningSelectedProfiles.length < 2) {
      setMessage("至少选择 2 个运行账号才能同步布局");
      await refreshRunningProfiles();
      return;
    }

    const sourceProfile =
      runningSelectedProfiles.find(
        (profile) => profile.id === resolvedLayoutSourceProfileId
      ) ?? runningSelectedProfiles[0];

    if (!sourceProfile) {
      setMessage("请选择一个运行账号作为主账号");
      await refreshRunningProfiles();
      return;
    }

    setWindowSyncing(true);
    try {
      const sourceWindows = await profileApi.listProfileWindows(
        rootPath,
        sourceProfile.id
      );
      const sourceWindow = sourceWindows[0];
      if (!sourceWindow) {
        setMessage("主账号没有可同步窗口");
        await refreshRunningProfiles();
        return;
      }
      if (sourceWindow.minimized) {
        setMessage("主账号窗口已最小化，请先恢复窗口再同步布局");
        await refreshRunningProfiles();
        return;
      }

      const sourceBounds: WindowBounds = {
        x: sourceWindow.x,
        y: sourceWindow.y,
        width: sourceWindow.width,
        height: sourceWindow.height
      };
      let syncedCount = 0;
      let noWindowCount = 0;
      let minimizedCount = 0;
      let unchangedCount = 0;
      let failedCount = 0;
      let firstFailedError: unknown = null;

      for (const profile of runningSelectedProfiles) {
        if (profile.id === sourceProfile.id) {
          continue;
        }

        try {
          const windows = await profileApi.listProfileWindows(rootPath, profile.id);
          if (windows.length === 0) {
            noWindowCount += 1;
            continue;
          }
          if (windows[0].minimized) {
            minimizedCount += 1;
            continue;
          }
          await profileApi.setProfileWindowBounds(rootPath, profile.id, sourceBounds);
          const updatedWindows = await profileApi.listProfileWindows(rootPath, profile.id);
          if (
            !updatedWindows[0] ||
            !windowMatchesBounds(updatedWindows[0], sourceBounds)
          ) {
            unchangedCount += 1;
            continue;
          }
          syncedCount += 1;
        } catch (error) {
          failedCount += 1;
          firstFailedError ??= error;
        }
      }

      if (syncedCount > 0) {
        const messageParts = [`已同步布局到 ${syncedCount} 个账号`];
        if (noWindowCount > 0) {
          messageParts.push(`${noWindowCount} 个没有可同步窗口`);
        }
        if (minimizedCount > 0) {
          messageParts.push(`${minimizedCount} 个窗口已最小化`);
        }
        if (unchangedCount > 0) {
          messageParts.push(`${unchangedCount} 个未生效`);
        }
        if (failedCount > 0) {
          messageParts.push(`${failedCount} 个失败`);
        }
        let successMessage = messageParts.join("，");
        try {
          await profileApi.focusProfileWindow(rootPath, sourceProfile.id);
        } catch (error) {
          successMessage = `${successMessage}，但未能拉到前台：${errorMessage(error)}`;
        }
        setMessage(successMessage);
      } else if (firstFailedError) {
        setMessage(windowAutomationErrorMessage(firstFailedError));
      } else {
        const messageParts = [
          unchangedCount > 0 ? "没有窗口实际同步" : "没有可同步的目标窗口"
        ];
        if (noWindowCount > 0) {
          messageParts.push(`${noWindowCount} 个没有可同步窗口`);
        }
        if (minimizedCount > 0) {
          messageParts.push(`${minimizedCount} 个窗口已最小化`);
        }
        if (unchangedCount > 0) {
          messageParts.push(`${unchangedCount} 个未生效`);
        }
        setMessage(messageParts.join("，"));
      }
      await refreshRunningProfiles();
    } catch (error) {
      setMessage(windowAutomationErrorMessage(error));
      await refreshRunningProfiles();
    } finally {
      setWindowSyncing(false);
    }
  }

  function stopBulkOpenQueue() {
    if (!bulkOpenRunning) {
      return;
    }

    bulkOpenCancelledRef.current = true;
    bulkOpenDelayResolveRef.current?.();
    bulkOpenDelayResolveRef.current = null;
    setMessage("正在停止批量打开...");
  }

  function waitForBulkOpenInterval(milliseconds: number) {
    return new Promise<void>((resolve) => {
      let resolved = false;
      let finish: () => void;
      finish = () => {
        if (resolved) {
          return;
        }

        resolved = true;
        if (bulkOpenDelayResolveRef.current === finish) {
          bulkOpenDelayResolveRef.current = null;
        }
        resolve();
      };

      bulkOpenDelayResolveRef.current = finish;
      window.setTimeout(finish, milliseconds);
    });
  }

  async function openUrlForSelectedProfiles(urlOverride?: string) {
    if (selectedProfiles.length === 0) {
      setMessage("请先选择账号");
      return;
    }
    if (bulkOpenRunning) {
      setMessage("批量打开正在进行");
      return;
    }

    const launchUrl = normalizeLaunchUrl(urlOverride ?? bulkUrl);
    if (!launchUrl) {
      setMessage("请先填写要打开的网址");
      return;
    }
    if (!chromeStatus?.available) {
      setMessage("未检测到浏览器，请先设置浏览器路径");
      return;
    }

    const intervalMilliseconds =
      normalizeBulkOpenIntervalSeconds(bulkOpenIntervalSeconds) * 1000;
    const queuedProfiles = [...selectedProfiles];
    const openedIds = new Set<string>();
    let failedCount = 0;

    bulkOpenCancelledRef.current = false;
    setBulkOpenRunning(true);

    try {
      for (const [index, profile] of queuedProfiles.entries()) {
        if (bulkOpenCancelledRef.current) {
          break;
        }

        setMessage(`正在打开 ${index + 1} / ${queuedProfiles.length}：${profile.name}`);
        try {
          await profileApi.openProfile(
            rootPath,
            profile.id,
            settings.browserPath,
            launchUrl
          );
          openedIds.add(profile.id);
        } catch {
          failedCount += 1;
        }

        if (
          index < queuedProfiles.length - 1 &&
          !bulkOpenCancelledRef.current
        ) {
          await waitForBulkOpenInterval(intervalMilliseconds);
        }
      }

      const stopped = bulkOpenCancelledRef.current;
      const finalMessage = stopped
        ? `已停止，已打开 ${openedIds.size} / ${queuedProfiles.length} 个账号`
        : failedCount > 0
          ? `已为 ${openedIds.size} 个账号打开网址，${failedCount} 个失败`
          : `已为 ${openedIds.size} 个账号打开网址`;

      if (openedIds.size > 0) {
        const now = new Date().toISOString();
        const nextProfiles = profiles.map((profile) =>
          openedIds.has(profile.id)
            ? updateProfile(profile, { lastOpenedAt: now }, now)
            : profile
        );
        const nextSettings = normalizeSettings({
          ...settings,
          recentUrls: [launchUrl, ...settings.recentUrls]
        });
        await persist(nextProfiles, finalMessage, nextSettings);
        return;
      }

      setMessage(stopped ? finalMessage : `打开网址失败：${failedCount} 个账号未打开`);
    } finally {
      bulkOpenCancelledRef.current = false;
      bulkOpenDelayResolveRef.current = null;
      setBulkOpenRunning(false);
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={(view) => {
          setActiveView(view);
          setEditingId(null);
          setEditingProfileDraft(null);
          setEditingProjectId(null);
          setEditingProjectDraft(null);
          setEditingUrlLibraryId(null);
          setUrlLibraryDraft(createUrlLibraryDraft());
          setUrlLibraryEditorOpen(false);
          setPendingUrlDeleteId(null);
          setPendingDelete(null);
        }}
        onOpenSettings={openSettingsDialog}
      />

      <main className={`main-area ${cardDensity === "compact" ? "compact-density" : ""}`}>
        {activeView === "accounts" ? (
          <>
        <section className="launcher-header">
          <div className="header-actions">
            <button
              className="secondary-button"
              type="button"
              aria-pressed={cardDensity === "compact"}
              aria-label={cardDensity === "compact" ? "切换标准视图" : "切换紧凑视图"}
              onClick={toggleCardDensity}
            >
              {cardDensity === "compact" ? <LayoutGrid size={16} /> : <List size={16} />}
              {cardDensity === "compact" ? "标准视图" : "紧凑视图"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowImport((current) => !current)}
            >
              <Download size={16} />
              导入
            </button>
            <button className="secondary-button" type="button" onClick={openBatchProfileDialog}>
              <UserPlus size={16} />
              批量新建账号
            </button>
            <button className="primary-button" type="button" onClick={createNewProfile}>
              <Plus size={16} />
              新建账号
            </button>
          </div>
        </section>

        <section className="launcher-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              aria-label="搜索账号"
              placeholder="搜索名称、标签、备注"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="toolbar-controls" role="group" aria-label="选择操作">
            <button
              className="secondary-button compact"
              type="button"
              disabled={visibleProfiles.length === 0}
              onClick={selectVisibleProfiles}
            >
              全选当前
            </button>
            <span className="profile-count">{totalProfiles} 个账号</span>
          </div>
        </section>

        {selectedProfiles.length > 0 ? (
          <BulkActionBar
            selectedCount={selectedProfiles.length}
            bulkTag={bulkTag}
            bulkUrl={bulkUrl}
            bulkOpenIntervalSeconds={bulkOpenIntervalSeconds}
            bulkOpenRunning={bulkOpenRunning}
            windowInspecting={windowInspecting}
            windowTiling={windowTiling}
            windowSyncing={windowSyncing}
            selectedProfiles={selectedProfiles}
            runningProfileIds={runningProfileIds}
            layoutSourceProfileId={resolvedLayoutSourceProfileId}
            favoriteUrls={settings.favoriteUrls}
            recentUrls={settings.recentUrls}
            onBulkTagChange={setBulkTag}
            onBulkUrlChange={setBulkUrl}
            onBulkOpenIntervalChange={setBulkOpenIntervalSeconds}
            onLayoutSourceProfileChange={setLayoutSourceProfileId}
            onAppendTags={() => void appendBulkTags()}
            onAddFavoriteUrl={() => void addFavoriteUrl()}
            onRemoveFavoriteUrl={(url) => void removeFavoriteUrl(url)}
            onOpenUrl={() => void openUrlForSelectedProfiles()}
            onInspectWindows={() => void inspectWindowsForSelectedProfiles()}
            onTileWindows={() => void tileWindowsForSelectedProfiles()}
            onSyncLayout={() => void syncLayoutForSelectedProfiles()}
            onStopOpenQueue={stopBulkOpenQueue}
            onRequestDelete={requestDeleteSelectedProfiles}
            onClear={clearSelection}
          />
        ) : null}

        {showImport ? (
          <section className="import-strip">
            <div className="path-input">
              <FolderOpen size={16} />
              <input
                aria-label="导入来源目录"
                placeholder="粘贴旧 MultiChrome 根目录、profiles 目录或整理好的来源目录"
                value={importPath}
                onChange={(event) => {
                  setImportPath(event.target.value);
                  setImportCandidates([]);
                  setSelectedImportPaths([]);
                }}
              />
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={importScanning || importingProfiles}
              onClick={() => void scanImportCandidates()}
            >
              {importScanning ? "扫描中" : "扫描导入目录"}
            </button>

            {importCandidates.length > 0 ? (
              <div className="import-candidates" role="region" aria-label="导入候选">
                <div className="import-candidates-header">
                  <strong>导入候选</strong>
                  <span>
                    默认只勾选可信目录；可疑目录需要手动勾选，跳过项不会导入。
                  </span>
                </div>
                <div className="import-candidate-list">
                  {importCandidates.map((candidate) => {
                    const disabled = !isImportCandidateSelectable(candidate);
                    const checked =
                      !disabled && selectedImportPaths.includes(candidate.path);
                    const candidateStatus = importCandidateStatusText(candidate);
                    return (
                      <label
                        key={candidate.path}
                        className={`import-candidate-row ${candidate.confidence}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`选择导入 ${candidate.suggestedName}`}
                          disabled={disabled || importingProfiles}
                          checked={checked}
                          onChange={() => toggleImportCandidate(candidate.path)}
                        />
                        <span className="import-candidate-main">
                          <strong>{candidate.suggestedName}</strong>
                          <small>{candidate.path}</small>
                          <em>
                            {candidate.duplicateProfileName
                              ? `已导入：${candidate.duplicateProfileName}`
                              : candidate.evidence.length > 0
                              ? candidate.evidence.join(" / ")
                              : candidate.skippedReason || "未发现可导入依据"}
                          </em>
                        </span>
                        <span className="import-candidate-meta">
                          <small>{candidateStatus}</small>
                          <small>{formatBytes(candidate.sizeBytes)}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="import-candidate-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={importingProfiles}
                    onClick={() => {
                      setImportCandidates([]);
                      setSelectedImportPaths([]);
                    }}
                  >
                    清空预览
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={selectedImportCount === 0 || importingProfiles}
                    onClick={() => void importSelectedCandidates()}
                  >
                    {importingProfiles ? "导入中" : `导入选中 ${selectedImportCount} 个`}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className={`profile-grid ${cardDensity}`} aria-label="账号列表">
          {visibleProfiles.length === 0 ? (
            <div className="empty-state">
              <div>
                <h3>还没有匹配的账号</h3>
                <p>新建账号后会在数据目录下生成独立 Chrome profile 文件夹。</p>
                <code>{rootPath}/profiles/account-001</code>
              </div>
              <button className="primary-button" type="button" onClick={createNewProfile}>
                <Plus size={16} />
                创建第一个账号
              </button>
            </div>
          ) : (
            visibleProfiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                density={cardDensity}
                selected={selectedIds.includes(profile.id)}
                running={runningProfileIds.includes(profile.id)}
                onLaunch={() => void openProfile(profile)}
                onFocusWindow={() => void focusProfileWindow(profile)}
                onEdit={() => openEditor(profile.id)}
                onToggleSelection={(selected) => toggleProfileSelection(profile.id, selected)}
              />
            ))
          )}
        </section>
          </>
        ) : activeView === "projects" ? (
          <ProjectsView
            projects={projects}
            profiles={profiles}
            openingProjectId={openingProjectId}
            projectQuery={projectQuery}
            onProjectQueryChange={setProjectQuery}
            onCreateProject={() => void createNewProject()}
            onOpenProject={(project, projectUrlId) => void openProject(project, projectUrlId)}
            onStopProject={stopOpeningProject}
            onEditProject={(projectId) => {
              const project = projects.find((item) => item.id === projectId);
              if (!project) {
                return;
              }
              setNewProjectDraft(null);
              setPendingProjectDeleteId(null);
              setEditingProjectId(projectId);
              setEditingProjectDraft(cloneProjectForDraft(project));
            }}
          />
        ) : (
          <UrlLibraryView
            items={settings.urlLibrary ?? []}
            visibleItems={visibleUrlLibraryItems}
            recentUrls={settings.recentUrls}
            query={urlLibraryQuery}
            selectedCount={selectedProfiles.length}
            onQueryChange={setUrlLibraryQuery}
            onCreate={startCreatingUrlLibraryItem}
            onEdit={startEditingUrlLibraryItem}
            onFillBulkUrl={fillBulkUrlFromLibrary}
            onOpenWithSelected={(url) => void openUrlForSelectedProfiles(url)}
            onCopy={(url) => void copyUrlFromLibrary(url)}
            onDelete={requestDeleteUrlLibraryItem}
          />
        )}

        <p className="message-line" role="status">
          {message}
        </p>
      </main>

      {editingProfile && editingProfileDraft ? (
        <EditProfileDialog
          mode="edit"
          profile={editingProfileDraft}
          rootPath={rootPath}
          selectedSize={selectedSize}
          onChange={updateEditingProfileDraft}
          onSave={saveEditingProfileDraft}
          onReveal={revealEditingProfile}
          onDuplicate={duplicateEditingProfile}
          onOpenAccountPlatform={(accountPlatform) =>
            void openAccountPlatform(editingProfile, accountPlatform)
          }
          onCopyAccountPlatformUsername={(accountPlatform) =>
            void copyAccountPlatformUsername(accountPlatform)
          }
          onDeleteRecord={() => requestDeleteEditingProfile("record")}
          onDeleteWithData={() => requestDeleteEditingProfile("data")}
          onClose={closeEditor}
        />
      ) : null}

      {pendingDelete ? (
        <DeleteConfirmDialog
          pendingDelete={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmPendingDelete}
        />
      ) : null}

      {pendingBatchDelete ? (
        <BatchDeleteConfirmDialog
          profiles={pendingBatchDelete}
          working={batchDeleteWorking}
          onCancel={() => setPendingBatchDelete(null)}
          onConfirm={confirmPendingBatchDelete}
        />
      ) : null}

      {urlLibraryEditorOpen ? (
        <UrlLibraryEditDialog
          title={editingUrlLibraryId ? "编辑网址" : "新建网址"}
          draft={urlLibraryDraft}
          onChange={(patch) =>
            setUrlLibraryDraft((current) => ({ ...current, ...patch }))
          }
          onSave={() => void saveUrlLibraryDraft()}
          onClose={cancelUrlLibraryEdit}
        />
      ) : null}

      {pendingUrlDeleteId ? (
        <UrlLibraryDeleteConfirmDialog
          item={
            (settings.urlLibrary ?? []).find((item) => item.id === pendingUrlDeleteId) ??
            null
          }
          onCancel={() => setPendingUrlDeleteId(null)}
          onConfirm={() => void confirmDeleteUrlLibraryItem()}
        />
      ) : null}

      {newProfileDraft ? (
        <EditProfileDialog
          mode="create"
          profile={newProfileDraft}
          rootPath={rootPath}
          selectedSize={null}
          onChange={updateNewProfileDraft}
          onSave={saveNewProfileDraft}
          onClose={() => setNewProfileDraft(null)}
        />
      ) : null}

      {batchProfileDialogOpen ? (
        <BatchCreateProfilesDialog
          value={batchProfileDraft}
          onChange={setBatchProfileDraft}
          onSave={() => void saveBatchProfileDraft()}
          onClose={closeBatchProfileDialog}
        />
      ) : null}

      {editingProject && editingProjectDraft ? (
        <EditProjectDialog
          mode="edit"
          project={editingProjectDraft}
          profiles={profiles}
          onChange={updateEditingProject}
          onSave={saveEditingProjectDraft}
          onCopyUrl={copyProjectUrlToClipboard}
          pendingDelete={pendingProjectDeleteId === editingProject.id}
          onDuplicate={() => void duplicateProjectById(editingProject.id)}
          onRequestDelete={requestDeleteEditingProject}
          onCancelDelete={() => setPendingProjectDeleteId(null)}
          onConfirmDelete={confirmDeleteEditingProject}
          onClose={() => {
            setPendingProjectDeleteId(null);
            setEditingProjectId(null);
            setEditingProjectDraft(null);
          }}
        />
      ) : null}

      {newProjectDraft ? (
        <EditProjectDialog
          mode="create"
          project={newProjectDraft}
          profiles={profiles}
          onChange={updateNewProjectDraft}
          onSave={saveNewProjectDraft}
          onCopyUrl={copyProjectUrlToClipboard}
          onClose={() => setNewProjectDraft(null)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          rootPath={rootPath}
          rootStatus={rootStatus}
          chromeStatus={chromeStatus}
          healthReport={healthReport}
          healthChecking={healthChecking}
          healthRepairing={healthRepairing}
          orphanRegisteringId={orphanRegisteringId}
          repairResult={repairResult}
          backupResult={backupResult}
          backupPathDraft={backupPathDraft}
          backupWorking={backupWorking}
          restoreConfirmOpen={restoreConfirmOpen}
          fullBackupScope={fullBackupScope}
          fullBackupPreview={fullBackupPreview}
          fullBackupResult={fullBackupResult}
          fullBackupPathDraft={fullBackupPathDraft}
          fullRestorePreview={fullRestorePreview}
          fullBackupWorking={fullBackupWorking}
          selectedProfileCount={selectedIds.length}
          browserPathDraft={browserPathDraft}
          themeDraft={themeDraft}
          onRootPathChange={updateRootPathDraft}
          onBrowserPathChange={setBrowserPathDraft}
          onThemeChange={setThemeDraft}
          onApplyRootPath={applyRootPath}
          onSaveSettings={saveSettingsDraft}
          onHealthCheck={runRootHealthCheck}
          onRepairHealth={repairRootHealth}
          onRegisterOrphanProfile={registerOrphanProfile}
          onCreateBackup={createBackup}
          onRequestRestoreBackup={requestRestoreBackup}
          onConfirmRestoreBackup={restoreBackup}
          onCancelRestoreBackup={() => setRestoreConfirmOpen(false)}
          onFullBackupScopeChange={updateFullBackupScope}
          onPreviewFullBackup={previewFullBackup}
          onCreateFullBackup={createFullBackup}
          onPreviewFullRestore={previewFullRestore}
          onRequestFullRestore={requestFullRestore}
          onRevealRootDirectory={revealRootDirectory}
          onRevealBackupsDirectory={revealBackupsDirectory}
          onBackupPathChange={setBackupPathDraft}
          onFullBackupPathChange={(value) => {
            setFullBackupPathDraft(value);
            setFullRestorePreview(null);
            setFullRestoreConfirmOpen(false);
          }}
          onClose={closeSettingsDialog}
        />
      ) : null}

      {fullRestoreConfirmOpen && fullRestorePreview ? (
        <FullRestoreConfirmDialog
          preview={fullRestorePreview}
          working={fullBackupWorking === "restore"}
          onCancel={() => setFullRestoreConfirmOpen(false)}
          onConfirm={restoreFullBackup}
        />
      ) : null}
    </div>
  );
}

interface SidebarProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  onOpenSettings: () => void;
}

function Sidebar({ activeView, onNavigate, onOpenSettings }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <span className="brand-mark">M</span>
        <div>
          <strong>MultiChrome</strong>
          <small>Profiles</small>
        </div>
      </div>

      <nav className="nav-list" aria-label="主导航">
        <button
          className={`nav-item ${activeView === "accounts" ? "active" : ""}`}
          type="button"
          onClick={() => onNavigate("accounts")}
        >
          <Chrome size={17} />
          账号
        </button>
        <button
          className={`nav-item ${activeView === "projects" ? "active" : ""}`}
          type="button"
          onClick={() => onNavigate("projects")}
        >
          <FolderKanban size={17} />
          项目
        </button>
        <button
          className={`nav-item ${activeView === "url-library" ? "active" : ""}`}
          type="button"
          onClick={() => onNavigate("url-library")}
        >
          <Tags size={17} />
          网址库
        </button>
        <button className="nav-item muted" type="button" disabled>
          任务
        </button>
      </nav>

      <button className="settings-entry" type="button" onClick={onOpenSettings}>
        <Settings size={17} />
        设置
      </button>
    </aside>
  );
}

interface UrlLibraryViewProps {
  items: UrlLibraryItem[];
  visibleItems: UrlLibraryItem[];
  recentUrls: string[];
  query: string;
  selectedCount: number;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
  onEdit: (item: UrlLibraryItem) => void;
  onFillBulkUrl: (url: string) => void;
  onOpenWithSelected: (url: string) => void;
  onCopy: (url: string) => void;
  onDelete: (itemId: string) => void;
}

function UrlLibraryView({
  items,
  visibleItems,
  recentUrls,
  query,
  selectedCount,
  onQueryChange,
  onCreate,
  onEdit,
  onFillBulkUrl,
  onOpenWithSelected,
  onCopy,
  onDelete
}: UrlLibraryViewProps) {
  const knownUrls = useMemo(() => new Set(items.map((item) => item.url)), [items]);
  const visibleRecentUrls = recentUrls.filter((url) => !knownUrls.has(url));

  return (
    <>
      <section className="launcher-header url-library-header">
        <div className="url-library-title">
          <h1>网址库</h1>
          <span>{items.length} 个常用网址</span>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="搜索网址"
            placeholder="搜索网址名称、标签、备注"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <div className="header-actions">
          <button className="primary-button" type="button" onClick={onCreate}>
            <Plus size={16} />
            新建网址
          </button>
        </div>
      </section>

      <section className="url-library-table-panel" aria-label="常用网址列表">
        {items.length === 0 ? (
          <div className="empty-state url-library-empty">
            <div>
              <h3>还没有常用网址</h3>
              <p>把每天会用到的任务页、项目页或登录页存在这里。</p>
            </div>
            <button className="primary-button" type="button" onClick={onCreate}>
              <Plus size={16} />
              创建第一个网址
            </button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="empty-state url-library-empty">
            <div>
              <h3>没有匹配的网址</h3>
            </div>
          </div>
        ) : (
          <div className="url-library-table-wrap">
            <table className="url-library-table" aria-label="网址库表格">
              <thead>
                <tr>
                  <th scope="col">名称</th>
                  <th scope="col">URL</th>
                  <th scope="col">标签</th>
                  <th scope="col">备注</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <UrlLibraryTableRow
                    key={item.id}
                    item={item}
                    selectedCount={selectedCount}
                    onEdit={() => onEdit(item)}
                    onFillBulkUrl={() => onFillBulkUrl(item.url)}
                    onOpenWithSelected={() => onOpenWithSelected(item.url)}
                    onCopy={() => onCopy(item.url)}
                    onDelete={() => onDelete(item.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {visibleRecentUrls.length > 0 ? (
        <section className="url-library-recent" aria-label="最近打开的网址">
          <strong>最近打开</strong>
          <div className="url-library-recent-list">
            {visibleRecentUrls.map((url) => {
              const label = displayUrlLabel(url);
              return (
                <div className="url-library-recent-row" key={url}>
                  <span>{label}</span>
                  <div>
                    <button
                      className="secondary-button compact"
                      type="button"
                      aria-label={`填入批量打开 ${label}`}
                      onClick={() => onFillBulkUrl(url)}
                    >
                      填入
                    </button>
                    <button
                      className="secondary-button compact"
                      type="button"
                      aria-label={`用选中账号打开 ${label}`}
                      onClick={() => onOpenWithSelected(url)}
                    >
                      打开
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}

interface UrlLibraryTableRowProps {
  item: UrlLibraryItem;
  selectedCount: number;
  onEdit: () => void;
  onFillBulkUrl: () => void;
  onOpenWithSelected: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

function UrlLibraryTableRow({
  item,
  selectedCount,
  onEdit,
  onFillBulkUrl,
  onOpenWithSelected,
  onCopy,
  onDelete
}: UrlLibraryTableRowProps) {
  const label = item.name || displayUrlLabel(item.url);

  return (
    <tr>
      <td className="url-library-name-cell">
        <strong>{label}</strong>
      </td>
      <td className="url-library-url-cell">
        <code title={item.url}>{item.url}</code>
      </td>
      <td>
        <div className="url-library-table-tags">
          {item.tags.length > 0 ? (
            item.tags.map((tag) => <span key={tag}>{tag}</span>)
          ) : (
            <span className="muted-cell">未设置</span>
          )}
        </div>
      </td>
      <td className="url-library-notes-cell">
        {item.notes ? <p>{item.notes}</p> : <span className="muted-cell">无备注</span>}
      </td>
      <td className="url-library-actions-cell">
        <div className="url-library-row-actions">
          <button
            className="secondary-button compact"
            type="button"
            aria-label={`填入批量打开 ${label}`}
            onClick={onFillBulkUrl}
          >
            填入
          </button>
          <button
            className="primary-button compact"
            type="button"
            aria-label={`用选中账号打开 ${label}`}
            title={selectedCount > 0 ? undefined : "先选择账号"}
            onClick={onOpenWithSelected}
          >
            <Play size={14} />
            打开
          </button>
          <button
            className="secondary-button compact icon-only"
            type="button"
            aria-label={`复制网址 ${label}`}
            onClick={onCopy}
          >
            <Copy size={14} />
          </button>
          <button
            className="secondary-button compact icon-only"
            type="button"
            aria-label={`编辑网址 ${label}`}
            onClick={onEdit}
          >
            <Pencil size={14} />
          </button>
          <button
            className="secondary-button compact icon-only danger"
            type="button"
            aria-label={`删除网址 ${label}`}
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

interface UrlLibraryEditDialogProps {
  title: string;
  draft: UrlLibraryDraft;
  onChange: (patch: Partial<UrlLibraryDraft>) => void;
  onSave: () => void;
  onClose: () => void;
}

function UrlLibraryEditDialog({
  title,
  draft,
  onChange,
  onSave,
  onClose
}: UrlLibraryEditDialogProps) {
  const titleId = "url-library-edit-title";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="modal-card url-library-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>保存后才会写入网址库。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body url-library-edit-body">
          <label className="field" htmlFor="url-library-name">
            <span>网址名称</span>
            <input
              id="url-library-name"
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </label>
          <label className="field" htmlFor="url-library-url">
            <span>网址 URL</span>
            <input
              id="url-library-url"
              value={draft.url}
              onChange={(event) => onChange({ url: event.target.value })}
            />
          </label>
          <label className="field" htmlFor="url-library-tags">
            <span>网址标签</span>
            <input
              id="url-library-tags"
              placeholder="多个标签用逗号分隔"
              value={draft.tags}
              onChange={(event) => onChange({ tags: event.target.value })}
            />
          </label>
          <label className="field" htmlFor="url-library-notes">
            <span>网址备注</span>
            <textarea
              id="url-library-notes"
              value={draft.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
            />
          </label>
        </div>
        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit">
            保存网址
          </button>
        </div>
      </form>
    </div>
  );
}

interface UrlLibraryDeleteConfirmDialogProps {
  item: UrlLibraryItem | null;
  onCancel: () => void;
  onConfirm: () => void;
}

function UrlLibraryDeleteConfirmDialog({
  item,
  onCancel,
  onConfirm
}: UrlLibraryDeleteConfirmDialogProps) {
  if (!item) {
    return null;
  }

  const titleId = "url-library-delete-title";
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="modal-card delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>确认删除网址</h2>
            <p>{item.name || displayUrlLabel(item.url)}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <p>这条常用网址会从网址库和批量打开常用项里移除。</p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button danger" type="button" onClick={onConfirm}>
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}

interface ProjectsViewProps {
  projects: AirdropProject[];
  profiles: ChromeProfile[];
  openingProjectId: string | null;
  projectQuery: string;
  onProjectQueryChange: (value: string) => void;
  onCreateProject: () => void;
  onOpenProject: (project: AirdropProject, projectUrlId?: string) => void;
  onStopProject: () => void;
  onEditProject: (projectId: string) => void;
}

function ProjectsView({
  projects,
  profiles,
  openingProjectId,
  projectQuery,
  onProjectQueryChange,
  onCreateProject,
  onOpenProject,
  onStopProject,
  onEditProject
}: ProjectsViewProps) {
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  );
  const visibleProjects = useMemo(() => {
    const normalizedQuery = projectQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return projects;
    }

    return projects.filter((project) =>
      [
        project.name,
        project.url,
        project.notes,
        project.id,
        ...projectDisplayUrls(project).flatMap((projectUrl) => [
          projectUrl.name,
          projectUrl.url,
          projectUrl.notes
        ])
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [projects, projectQuery]);

  return (
    <>
      <section className="launcher-header">
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="搜索项目"
            placeholder="搜索项目名称、网址、备注"
            value={projectQuery}
            onChange={(event) => onProjectQueryChange(event.target.value)}
          />
        </label>
        <div className="header-actions">
          <button className="primary-button" type="button" onClick={onCreateProject}>
            <Plus size={16} />
            新建项目
          </button>
        </div>
      </section>

      <section className="project-grid" aria-label="项目列表">
        {projects.length === 0 ? (
          <div className="empty-state">
            <div>
              <h3>还没有项目</h3>
              <p>项目用于保存一个入口网址和一批账号，适合每天打卡或重复活动入口。</p>
            </div>
            <button className="primary-button" type="button" onClick={onCreateProject}>
              <Plus size={16} />
              创建第一个项目
            </button>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="empty-state">
            <div>
              <h3>没有匹配的项目</h3>
              <p>换个名称、网址或备注关键词再试。</p>
            </div>
          </div>
        ) : (
          visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              profiles={project.profileIds
                .map((profileId) => profileById.get(profileId))
                .filter((profile): profile is ChromeProfile => Boolean(profile))}
              opening={openingProjectId === project.id}
              disabled={openingProjectId !== null && openingProjectId !== project.id}
              onOpen={(projectUrlId) => onOpenProject(project, projectUrlId)}
              onStop={onStopProject}
              onEdit={() => onEditProject(project.id)}
            />
          ))
        )}
      </section>
    </>
  );
}

interface ProjectCardProps {
  project: AirdropProject;
  profiles: ChromeProfile[];
  opening: boolean;
  disabled: boolean;
  onOpen: (projectUrlId?: string) => void;
  onStop: () => void;
  onEdit: () => void;
}

function ProjectCard({
  project,
  profiles,
  opening,
  disabled,
  onOpen,
  onStop,
  onEdit
}: ProjectCardProps) {
  const [openTarget, setOpenTarget] = useState("all");
  const projectUrls = projectDisplayUrls(project);
  const urlCountLabel = projectUrls.length === 0 ? "未设置网址" : `${projectUrls.length} 个网址`;
  return (
    <article className="project-card">
      <div className="project-card-main">
        <strong>{project.name}</strong>
        <code>{urlCountLabel}</code>
      </div>
      <div className="project-meta-row">
        <span>{profiles.length} 个账号</span>
        <span>间隔 {normalizeBulkOpenIntervalSeconds(String(project.intervalSeconds))} 秒</span>
      </div>
      {projectUrls.length > 1 ? (
        <label className="project-url-select">
          <span>打开范围</span>
          <select
            aria-label={`${project.name} 打开网址`}
            value={openTarget}
            onChange={(event) => setOpenTarget(event.target.value)}
            disabled={opening || disabled}
          >
            <option value="all">全部网址</option>
            {projectUrls.map((projectUrl) => (
              <option key={projectUrl.id} value={projectUrl.id}>
                {projectUrl.name || displayUrlLabel(projectUrl.url)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="project-card-actions">
        <button
          className="primary-button compact"
          type="button"
          aria-label={`打开项目 ${project.name}`}
          disabled={opening || disabled}
          onClick={() => onOpen(openTarget === "all" ? undefined : openTarget)}
        >
          <Play size={14} />
          {opening ? "打开中" : projectUrls.length > 1 ? "打开" : "开始打开"}
        </button>
        {opening ? (
          <button
            className="secondary-button compact danger"
            type="button"
            aria-label={`停止项目 ${project.name}`}
            onClick={onStop}
          >
            <X size={14} />
            停止
          </button>
        ) : null}
        <button
          className="secondary-button compact"
          type="button"
          aria-label={`编辑项目 ${project.name}`}
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil size={14} />
          编辑
        </button>
      </div>
    </article>
  );
}

interface EditProjectDialogProps {
  project: AirdropProject;
  profiles: ChromeProfile[];
  mode?: "edit" | "create";
  pendingDelete?: boolean;
  onChange: (patch: Partial<AirdropProject>) => Promise<void>;
  onSave?: (patch: Partial<AirdropProject>) => Promise<void>;
  onCopyUrl?: (projectUrl: ProjectUrl) => Promise<void>;
  onDuplicate?: () => void;
  onRequestDelete?: () => void;
  onCancelDelete?: () => void;
  onConfirmDelete?: () => Promise<void>;
  onClose: () => void;
}

function EditProjectDialog({
  project,
  profiles,
  mode = "edit",
  pendingDelete = false,
  onChange,
  onSave,
  onCopyUrl,
  onDuplicate,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onClose
}: EditProjectDialogProps) {
  const titleId = "edit-project-title";
  const creating = mode === "create";
  const [intervalDraft, setIntervalDraft] = useState(String(project.intervalSeconds));
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const [urlImportDraft, setUrlImportDraft] = useState("");
  const projectUrls = projectEditableUrls(project);

  useEffect(() => {
    setIntervalDraft(String(project.intervalSeconds));
    setUrlImportOpen(false);
    setUrlImportDraft("");
  }, [project.id]);

  function toggleProfile(profileId: string, checked: boolean) {
    const nextIds = checked
      ? [...project.profileIds, profileId]
      : project.profileIds.filter((id) => id !== profileId);
    void onChange({ profileIds: [...new Set(nextIds)] });
  }

  function commitInterval() {
    const nextInterval = normalizeBulkOpenIntervalSeconds(intervalDraft);
    setIntervalDraft(String(nextInterval));
    void onChange({ intervalSeconds: nextInterval });
  }

  function changeProjectUrl(projectUrlId: string, patch: Partial<ProjectUrl>) {
    const nextUrls = projectUrls.map((projectUrl) =>
      projectUrl.id === projectUrlId ? { ...projectUrl, ...patch } : projectUrl
    );
    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
  }

  function normalizeProjectUrl(projectUrlId: string) {
    const nextUrls = projectUrls.map((projectUrl) =>
      projectUrl.id === projectUrlId
        ? { ...projectUrl, url: normalizeLaunchUrl(projectUrl.url) }
        : projectUrl
    );
    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
  }

  function addProjectUrl() {
    const nextUrls = [...projectUrls, createProjectUrl(projectUrls)];
    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
  }

  function moveProjectUrl(projectUrlId: string, offset: -1 | 1) {
    const currentIndex = projectUrls.findIndex((projectUrl) => projectUrl.id === projectUrlId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= projectUrls.length) {
      return;
    }

    const nextUrls = [...projectUrls];
    const [movedUrl] = nextUrls.splice(currentIndex, 1);
    nextUrls.splice(nextIndex, 0, movedUrl);
    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
  }

  function applyProjectUrlImport() {
    const nextUrls = parseProjectUrlImportLines(urlImportDraft);
    if (nextUrls.length === 0) {
      return;
    }

    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
    setUrlImportDraft("");
    setUrlImportOpen(false);
  }

  function removeProjectUrl(projectUrlId: string) {
    const nextUrls = projectUrls.filter((projectUrl) => projectUrl.id !== projectUrlId);
    const safeNextUrls =
      nextUrls.length > 0 ? nextUrls : [createProjectUrl([], { id: "url-001", name: "主入口" })];
    void onChange({
      urls: safeNextUrls,
      url: primaryProjectUrl(safeNextUrls)
    });
  }

  function finalProjectPatch(): Partial<AirdropProject> {
    const nextUrls = normalizeEditableProjectUrls(projectUrls);
    const nextInterval = normalizeBulkOpenIntervalSeconds(intervalDraft);
    setIntervalDraft(String(nextInterval));
    return {
      url: primaryProjectUrl(nextUrls),
      urls: nextUrls,
      intervalSeconds: nextInterval
    };
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-card edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{creating ? "新建项目" : `编辑项目 ${project.name}`}</h2>
            <p>
              {creating
                ? "保存后才会创建项目记录"
                : primaryProjectUrl(projectUrls)
                  ? `${projectUrls.length} 个网址`
                  : project.id}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={creating ? "取消新建项目" : "关闭项目编辑"}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="project-name">项目名称</label>
            <input
              id="project-name"
              aria-label="项目名称"
              value={project.name}
              onChange={(event) => void onChange({ name: event.target.value })}
            />
          </div>

          <div className="field">
            <div className="field-heading-row">
              <span className="field-label">项目网址</span>
              <div className="field-actions">
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => setUrlImportOpen((current) => !current)}
                >
                  <Upload size={14} />
                  批量导入网址
                </button>
                <button className="secondary-button compact" type="button" onClick={addProjectUrl}>
                  <Plus size={14} />
                  添加网址
                </button>
              </div>
            </div>
            {urlImportOpen ? (
              <div className="project-url-import">
                <label>
                  <span>批量网址</span>
                  <textarea
                    aria-label="批量网址文本"
                    rows={5}
                    value={urlImportDraft}
                    placeholder="Galxe https://galxe.com/quest 每日任务"
                    onChange={(event) => setUrlImportDraft(event.target.value)}
                  />
                </label>
                <div className="project-url-import-actions">
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => {
                      setUrlImportDraft("");
                      setUrlImportOpen(false);
                    }}
                  >
                    取消导入
                  </button>
                  <button
                    className="primary-button compact"
                    type="button"
                    onClick={applyProjectUrlImport}
                  >
                    应用导入网址
                  </button>
                </div>
              </div>
            ) : null}
            <div className="project-url-list">
              {projectUrls.map((projectUrl, index) => (
                <div className="project-url-item" key={projectUrl.id}>
                  <div className="project-url-item-header">
                    <strong>网址 {index + 1}</strong>
                    <div className="project-url-actions">
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`复制网址 ${projectUrl.name || index + 1}`}
                        onClick={() => void onCopyUrl?.(projectUrl)}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`上移网址 ${projectUrl.name || index + 1}`}
                        disabled={index === 0}
                        onClick={() => moveProjectUrl(projectUrl.id, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`下移网址 ${projectUrl.name || index + 1}`}
                        disabled={index === projectUrls.length - 1}
                        onClick={() => moveProjectUrl(projectUrl.id, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                    {projectUrls.length > 1 ? (
                      <button
                        className="icon-button compact danger"
                        type="button"
                        aria-label={`删除网址 ${projectUrl.name || index + 1}`}
                        onClick={() => removeProjectUrl(projectUrl.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                    </div>
                  </div>
                  <div className="project-url-fields">
                    <label>
                      <span>名称</span>
                      <input
                        aria-label={`网址名称 ${index + 1}`}
                        value={projectUrl.name}
                        onChange={(event) =>
                          changeProjectUrl(projectUrl.id, { name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>网址</span>
                      <input
                        aria-label={index === 0 ? "项目网址" : `项目网址 ${index + 1}`}
                        value={projectUrl.url}
                        onBlur={() => normalizeProjectUrl(projectUrl.id)}
                        onChange={(event) =>
                          changeProjectUrl(projectUrl.id, { url: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="project-url-note">
                    <span>网址备注</span>
                    <textarea
                      aria-label={`网址备注 ${index + 1}`}
                      rows={2}
                      value={projectUrl.notes}
                      onChange={(event) =>
                        changeProjectUrl(projectUrl.id, { notes: event.target.value })
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="project-interval">打开间隔</label>
            <input
              id="project-interval"
              aria-label="项目打开间隔秒"
              type="text"
              inputMode="numeric"
              min="1"
              max="60"
              step="1"
              value={intervalDraft}
              onBlur={commitInterval}
              onChange={(event) => {
                const nextValue = event.target.value;
                setIntervalDraft(nextValue);
                if (nextValue.trim()) {
                  void onChange({
                    intervalSeconds: normalizeBulkOpenIntervalSeconds(nextValue)
                  });
                }
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="project-notes">备注</label>
            <textarea
              id="project-notes"
              rows={3}
              value={project.notes}
              onChange={(event) => void onChange({ notes: event.target.value })}
            />
          </div>

          <div className="field">
            <span className="field-label">绑定账号</span>
            <div className="project-profile-picker">
              {profiles.map((profile) => {
                const selected = project.profileIds.includes(profile.id);
                return (
                  <button
                    key={profile.id}
                    className={`project-profile-option ${selected ? "selected" : ""}`}
                    type="button"
                    aria-label={`绑定账号 ${profile.name} ${profile.id}`}
                    aria-pressed={selected}
                    onClick={() => toggleProfile(profile.id, !selected)}
                  >
                    <span>{profile.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {!creating && onDuplicate ? (
            <div className="project-edit-actions">
              <span className="field-label">项目操作</span>
              <button className="secondary-button" type="button" onClick={onDuplicate}>
                <Copy size={16} />
                复制项目
              </button>
            </div>
          ) : null}

          {!creating ? (
            <div className="danger-zone">
              <div>
                <strong>危险操作</strong>
                <p>删除入口只放在这里，避免在项目卡片上误触。</p>
              </div>
              <div className="danger-actions">
                <button
                  className="primary-button danger"
                  type="button"
                  onClick={onRequestDelete}
                >
                  <Trash2 size={16} />
                  删除项目
                </button>
              </div>
            </div>
          ) : null}

          {!creating && pendingDelete && onCancelDelete && onConfirmDelete ? (
            <ProjectDeleteConfirmPanel
              project={project}
              onCancel={onCancelDelete}
              onConfirm={onConfirmDelete}
            />
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void onSave?.(finalProjectPatch())}
          >
            保存项目
          </button>
        </div>
      </section>
    </div>
  );
}

interface BatchProfileDraft {
  name: string;
  tags: string[];
  notes: string;
}

interface BatchCreateProfilesDialogProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

function BatchCreateProfilesDialog({
  value,
  onChange,
  onSave,
  onClose
}: BatchCreateProfilesDialogProps) {
  const titleId = "batch-profile-title";
  const drafts = parseBatchProfileLines(value);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-card edit-modal batch-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>批量新建账号</h2>
            <p>{drafts.length > 0 ? `${drafts.length} 个账号待创建` : "保存后才会创建账号记录"}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="取消批量新建"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="batch-profile-text">账号文本</label>
            <textarea
              id="batch-profile-text"
              aria-label="批量账号文本"
              rows={9}
              value={value}
              placeholder="测试号一, galxe x, Google 已登录"
              onChange={(event) => onChange(event.target.value)}
            />
          </div>

          {drafts.length > 0 ? (
            <div className="batch-profile-preview" aria-label="批量账号预览">
              {drafts.slice(0, 5).map((draft, index) => (
                <div key={`${draft.name}-${index}`} className="batch-profile-preview-row">
                  <strong>{draft.name}</strong>
                  <span>{draft.tags.length > 0 ? draft.tags.join(", ") : "无标签"}</span>
                  <small>{draft.notes || "无备注"}</small>
                </div>
              ))}
              {drafts.length > 5 ? <small className="muted-line">另有 {drafts.length - 5} 个账号</small> : null}
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={drafts.length === 0}
            onClick={onSave}
          >
            创建 {drafts.length} 个账号
          </button>
        </div>
      </section>
    </div>
  );
}

interface BulkActionBarProps {
  selectedCount: number;
  bulkTag: string;
  bulkUrl: string;
  bulkOpenIntervalSeconds: string;
  bulkOpenRunning: boolean;
  windowInspecting: boolean;
  windowTiling: boolean;
  windowSyncing: boolean;
  selectedProfiles: ChromeProfile[];
  runningProfileIds: string[];
  layoutSourceProfileId: string;
  favoriteUrls: string[];
  recentUrls: string[];
  onBulkTagChange: (value: string) => void;
  onBulkUrlChange: (value: string) => void;
  onBulkOpenIntervalChange: (value: string) => void;
  onLayoutSourceProfileChange: (value: string) => void;
  onAppendTags: () => void;
  onAddFavoriteUrl: () => void;
  onRemoveFavoriteUrl: (url: string) => void;
  onOpenUrl: () => void;
  onInspectWindows: () => void;
  onTileWindows: () => void;
  onSyncLayout: () => void;
  onStopOpenQueue: () => void;
  onRequestDelete: () => void;
  onClear: () => void;
}

function BulkActionBar({
  selectedCount,
  bulkTag,
  bulkUrl,
  bulkOpenIntervalSeconds,
  bulkOpenRunning,
  windowInspecting,
  windowTiling,
  windowSyncing,
  selectedProfiles,
  runningProfileIds,
  layoutSourceProfileId,
  favoriteUrls,
  recentUrls,
  onBulkTagChange,
  onBulkUrlChange,
  onBulkOpenIntervalChange,
  onLayoutSourceProfileChange,
  onAppendTags,
  onAddFavoriteUrl,
  onRemoveFavoriteUrl,
  onOpenUrl,
  onInspectWindows,
  onTileWindows,
  onSyncLayout,
  onStopOpenQueue,
  onRequestDelete,
  onClear
}: BulkActionBarProps) {
  const visibleRecentUrls = recentUrls.filter((url) => !favoriteUrls.includes(url));
  const runningSelectedProfiles = selectedProfiles.filter((profile) =>
    runningProfileIds.includes(profile.id)
  );
  const windowActionDisabled =
    bulkOpenRunning || windowInspecting || windowTiling || windowSyncing;

  return (
    <section className="bulk-action-bar" aria-label="批量操作">
      <strong>已选择 {selectedCount} 个账号</strong>
      <div className="bulk-url-form">
        <input
          aria-label="批量打开网址"
          placeholder="输入网址"
          value={bulkUrl}
          disabled={bulkOpenRunning}
          onChange={(event) => onBulkUrlChange(event.target.value)}
        />
        <label className="bulk-interval-control">
          <span>间隔</span>
          <input
            aria-label="批量打开间隔秒"
            type="number"
            min="1"
            max="60"
            step="1"
            value={bulkOpenIntervalSeconds}
            disabled={bulkOpenRunning}
            onChange={(event) => onBulkOpenIntervalChange(event.target.value)}
          />
          <span>秒</span>
        </label>
        <button
          className="primary-button compact"
          type="button"
          disabled={bulkOpenRunning}
          onClick={onOpenUrl}
        >
          {bulkOpenRunning ? "打开中" : "打开网址"}
        </button>
        {bulkOpenRunning ? (
          <button
            className="secondary-button compact danger"
            type="button"
            onClick={onStopOpenQueue}
          >
            停止
          </button>
        ) : null}
        <button
          className="secondary-button compact"
          type="button"
          disabled={bulkOpenRunning}
          onClick={onAddFavoriteUrl}
        >
          设为常用
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={windowActionDisabled}
          onClick={onInspectWindows}
        >
          <List size={15} />
          {windowInspecting ? "检查中" : "检查窗口"}
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={windowActionDisabled}
          onClick={onTileWindows}
        >
          <LayoutGrid size={15} />
          {windowTiling ? "平铺中" : "平铺窗口"}
        </button>
        <label className="bulk-source-control">
          <span>主账号</span>
          <select
            aria-label="布局同步主账号"
            value={layoutSourceProfileId}
            disabled={windowActionDisabled || runningSelectedProfiles.length === 0}
            onChange={(event) => onLayoutSourceProfileChange(event.target.value)}
          >
            {runningSelectedProfiles.length === 0 ? (
              <option value="">无运行账号</option>
            ) : (
              runningSelectedProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          className="secondary-button compact"
          type="button"
          disabled={windowActionDisabled}
          onClick={onSyncLayout}
        >
          {windowSyncing ? "同步中" : "同步布局"}
        </button>
      </div>
      {favoriteUrls.length > 0 || visibleRecentUrls.length > 0 ? (
        <div className="url-shortcut-panel">
          {favoriteUrls.length > 0 ? (
            <UrlShortcutGroup
              label="常用"
              urls={favoriteUrls}
              actionLabel="使用常用网址"
              onPick={onBulkUrlChange}
              onRemove={onRemoveFavoriteUrl}
            />
          ) : null}
          {visibleRecentUrls.length > 0 ? (
            <UrlShortcutGroup
              label="最近"
              urls={visibleRecentUrls}
              actionLabel="使用最近网址"
              onPick={onBulkUrlChange}
            />
          ) : null}
        </div>
      ) : null}
      <div className="bulk-tag-form">
        <input
          aria-label="批量追加标签"
          placeholder="追加标签，逗号分隔"
          value={bulkTag}
          onChange={(event) => onBulkTagChange(event.target.value)}
        />
        <button className="primary-button compact" type="button" onClick={onAppendTags}>
          追加标签
        </button>
      </div>
      <button className="secondary-button compact" type="button" onClick={onClear}>
        取消选择
      </button>
      <button
        className="secondary-button compact danger"
        type="button"
        disabled={bulkOpenRunning}
        onClick={onRequestDelete}
      >
        删除选中
      </button>
    </section>
  );
}

interface UrlShortcutGroupProps {
  label: string;
  urls: string[];
  actionLabel: string;
  onPick: (url: string) => void;
  onRemove?: (url: string) => void;
}

function UrlShortcutGroup({
  label,
  urls,
  actionLabel,
  onPick,
  onRemove
}: UrlShortcutGroupProps) {
  return (
    <div className="url-shortcut-group">
      <span>{label}</span>
      <div className="url-shortcut-list">
        {urls.map((url) => {
          const displayLabel = displayUrlLabel(url);
          return (
            <span className="url-shortcut-chip" key={url}>
              <button
                className="url-shortcut-button"
                type="button"
                aria-label={`${actionLabel} ${displayLabel}`}
                onClick={() => onPick(url)}
              >
                {displayLabel}
              </button>
              {onRemove ? (
                <button
                  className="url-shortcut-remove"
                  type="button"
                  aria-label={`删除常用网址 ${displayLabel}`}
                  onClick={() => onRemove(url)}
                >
                  <X size={12} />
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface ProfileCardProps {
  profile: ChromeProfile;
  density: CardDensity;
  selected: boolean;
  running: boolean;
  onLaunch: () => void;
  onFocusWindow: () => void;
  onEdit: () => void;
  onToggleSelection: (selected: boolean) => void;
}

function ProfileCard({
  profile,
  density,
  selected,
  running,
  onLaunch,
  onFocusWindow,
  onEdit,
  onToggleSelection
}: ProfileCardProps) {
  const accent = accentDetailsForProfile(profile);
  const cardStyle = { "--profile-accent": accent.hex } as CSSProperties;

  return (
    <article
      className={`profile-card-shell ${selected ? "selected" : ""}`}
      style={cardStyle}
    >
      <label className="profile-select-control">
        <input
          type="checkbox"
          aria-label={`选择 ${profile.name}`}
          checked={selected}
          onChange={(event) => onToggleSelection(event.target.checked)}
        />
      </label>
      <button
        className={`profile-card ${density}`}
        type="button"
        aria-label={`启动 ${profile.name}`}
        onClick={onLaunch}
      >
        <span className="profile-avatar" aria-label={`颜色 ${accent.label}`}>
          {profileIndexLabel(profile.id)}
        </span>
        <span className="profile-card-main">
          <strong>{profile.name}</strong>
          <small>{profile.notes || profile.id}</small>
          <span className="tag-list">
            {profile.tags.length > 0 ? (
              profile.tags.slice(0, 2).map((tag) => (
                <span key={tag}>{tag}</span>
              ))
            ) : (
              <small>未设置标签</small>
            )}
          </span>
        </span>
        {running ? (
          <span className="profile-card-side">
            <span className="profile-running-badge">运行中</span>
          </span>
        ) : null}
      </button>
      <button
        className="profile-focus-button"
        type="button"
        aria-label={`切换到 ${profile.name}`}
        onClick={onFocusWindow}
        hidden={!running}
      >
        <ExternalLink size={14} />
      </button>
      <button
        className="profile-edit-button"
        type="button"
        aria-label={`编辑 ${profile.name}`}
        onClick={onEdit}
      >
        <Pencil size={15} />
      </button>
    </article>
  );
}

interface EditProfileDialogProps {
  profile: ChromeProfile;
  rootPath: string;
  selectedSize: number | null;
  mode?: "edit" | "create";
  onChange: (patch: Partial<ChromeProfile>) => Promise<void>;
  onReveal?: () => Promise<void>;
  onDuplicate?: () => Promise<void>;
  onOpenAccountPlatform?: (accountPlatform: AccountPlatform) => void;
  onCopyAccountPlatformUsername?: (accountPlatform: AccountPlatform) => void;
  onDeleteRecord?: () => void;
  onDeleteWithData?: () => void;
  onSave?: () => Promise<void>;
  onClose: () => void;
}

function EditProfileDialog({
  profile,
  rootPath,
  selectedSize,
  mode = "edit",
  onChange,
  onReveal,
  onDuplicate,
  onOpenAccountPlatform,
  onCopyAccountPlatformUsername,
  onDeleteRecord,
  onDeleteWithData,
  onSave,
  onClose
}: EditProfileDialogProps) {
  const titleId = "edit-profile-title";
  const creating = mode === "create";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-card edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{creating ? "新建账号" : `编辑 ${profile.name}`}</h2>
            <p>{creating ? "保存后才会创建配置目录和账号记录" : profile.notes || profile.id}</p>
          </div>
          <div className="modal-header-actions">
            <button
              className="icon-button"
              type="button"
              aria-label={creating ? "取消新建账号" : "关闭编辑"}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="profile-name">名称</label>
            <input
              id="profile-name"
              value={profile.name}
              onChange={(event) => void onChange({ name: event.target.value })}
            />
          </div>

          <div className="field">
            <span className="field-label">颜色</span>
            <AccentColorPicker profile={profile} onChange={onChange} />
          </div>

          <div className="field">
            <label htmlFor="profile-tags">
              <Tags size={14} />
              标签
            </label>
            <input
              id="profile-tags"
              value={profile.tags.join(", ")}
              onChange={(event) =>
                void onChange({
                  tags: event.target.value.split(",").map((tag) => tag.trim())
                })
              }
            />
          </div>

          <div className="field">
            <label htmlFor="profile-notes">备注</label>
            <textarea
              id="profile-notes"
              rows={3}
              value={profile.notes}
              onChange={(event) => void onChange({ notes: event.target.value })}
            />
          </div>

          <AccountPlatformEditor
            accountPlatforms={profile.accountPlatforms}
            onChange={(accountPlatforms) => void onChange({ accountPlatforms })}
            onOpen={creating ? undefined : onOpenAccountPlatform}
            onCopyUsername={creating ? undefined : onCopyAccountPlatformUsername}
          />

          {!creating ? (
            <>
              <div className="field">
                <span className="field-label">配置文件夹</span>
                <div className="path-row">
                  <code>{profilePath(rootPath, profile.id)}</code>
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => void onReveal?.()}
                  >
                    <FolderOpen size={15} />
                    打开文件夹
                  </button>
                </div>
                <small className="muted-line">目录大小：{formatBytes(selectedSize)}</small>
              </div>

              <div className="action-grid">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void onDuplicate?.()}
                >
                  <Copy size={16} />
                  复制账号
                </button>
              </div>

              <div className="danger-zone">
                <div>
                  <strong>危险操作</strong>
                  <p>删除入口只放在这里，避免在账号卡片上误触。</p>
                </div>
                <div className="danger-actions">
                  <button
                    className="secondary-button danger"
                    type="button"
                    onClick={onDeleteRecord}
                  >
                    <Trash2 size={16} />
                    只删除记录
                  </button>
                  <button
                    className="primary-button danger"
                    type="button"
                    onClick={onDeleteWithData}
                  >
                    <Trash2 size={16} />
                    删除记录和文件夹
                  </button>
                </div>
              </div>
            </>
          ) : null}

        </div>

        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void onSave?.()}
          >
            保存账号
          </button>
        </div>
      </section>
    </div>
  );
}

interface AccountPlatformEditorProps {
  accountPlatforms: AccountPlatform[];
  onChange: (accountPlatforms: AccountPlatform[]) => void;
  onOpen?: (accountPlatform: AccountPlatform) => void;
  onCopyUsername?: (accountPlatform: AccountPlatform) => void;
}

function AccountPlatformEditor({
  accountPlatforms,
  onChange,
  onOpen,
  onCopyUsername
}: AccountPlatformEditorProps) {
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  function addAccountPlatform() {
    const accountPlatform = createAccountPlatform(accountPlatforms);
    setExpandedIds((current) => [...current, accountPlatform.id]);
    onChange([...accountPlatforms, accountPlatform]);
  }

  function patchAccountPlatform(
    accountPlatformId: string,
    patch: Partial<AccountPlatform>
  ) {
    onChange(updateAccountPlatform(accountPlatforms, accountPlatformId, patch));
  }

  function deleteAccountPlatform(accountPlatformId: string) {
    setExpandedIds((current) => current.filter((id) => id !== accountPlatformId));
    onChange(removeAccountPlatform(accountPlatforms, accountPlatformId));
  }

  function applyAccountPlatformTemplate(
    accountPlatformId: string,
    template: (typeof ACCOUNT_PLATFORM_TEMPLATES)[number]
  ) {
    patchAccountPlatform(accountPlatformId, {
      platform: template.platform,
      loginUrl: template.loginUrl
    });
  }

  function toggleAccountPlatform(accountPlatformId: string) {
    setExpandedIds((current) =>
      current.includes(accountPlatformId)
        ? current.filter((id) => id !== accountPlatformId)
        : [...current, accountPlatformId]
    );
  }

  return (
    <section className="account-platform-section" aria-label="账号平台">
      <div className="account-platform-header">
        <span className="field-label">账号平台</span>
        <button
          className="secondary-button compact"
          type="button"
          onClick={addAccountPlatform}
        >
          <Plus size={15} />
          添加账号平台
        </button>
      </div>

      {accountPlatforms.length === 0 ? (
        <p className="empty-inline">还没有保存平台登录资料。</p>
      ) : (
        <div className="account-platform-list">
          {accountPlatforms.map((accountPlatform) => {
            const label = accountPlatform.platform || "未命名平台";
            const expanded = expandedIds.includes(accountPlatform.id);
            return (
              <article
                className={`account-platform-card ${expanded ? "expanded" : ""}`}
                key={accountPlatform.id}
              >
                <div className="account-platform-summary">
                  <div className="account-platform-title">
                    <strong>{label}</strong>
                    <span>
                      {accountPlatform.username ||
                        displayUrlLabel(accountPlatform.loginUrl) ||
                        "未填写用户名"}
                    </span>
                  </div>
                  {accountPlatform.notes ? <p>{accountPlatform.notes}</p> : null}
                  <div className="account-platform-actions">
                    {onOpen && accountPlatform.loginUrl ? (
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`打开账号平台 ${label}`}
                        onClick={() => onOpen(accountPlatform)}
                      >
                        <ExternalLink size={15} />
                      </button>
                    ) : null}
                    {onCopyUsername && accountPlatform.username ? (
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`复制用户名 ${label}`}
                        onClick={() => onCopyUsername(accountPlatform)}
                      >
                        <Copy size={15} />
                      </button>
                    ) : null}
                    <button
                      className="icon-button compact"
                      type="button"
                      aria-label={
                        expanded ? `收起账号平台 ${label}` : `编辑账号平台 ${label}`
                      }
                      onClick={() => toggleAccountPlatform(accountPlatform.id)}
                    >
                      {expanded ? <X size={15} /> : <Pencil size={15} />}
                    </button>
                    <button
                      className="icon-button compact danger"
                      type="button"
                      aria-label={`删除账号平台 ${label}`}
                      onClick={() => deleteAccountPlatform(accountPlatform.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="account-platform-expanded">
                    <div className="platform-template-row">
                      <span>常用</span>
                      {ACCOUNT_PLATFORM_TEMPLATES.map((template) => (
                        <button
                          className="platform-template-button"
                          type="button"
                          aria-label={`套用 ${template.label} 模板`}
                          key={template.label}
                          onClick={() =>
                            applyAccountPlatformTemplate(accountPlatform.id, template)
                          }
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                    <div className="account-platform-grid">
                      <div className="field">
                        <label htmlFor={`platform-name-${accountPlatform.id}`}>平台名称</label>
                        <input
                          id={`platform-name-${accountPlatform.id}`}
                          value={accountPlatform.platform}
                          placeholder="X / Galxe / Discord"
                          onChange={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              platform: event.target.value
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`platform-url-${accountPlatform.id}`}>登录网址</label>
                        <input
                          id={`platform-url-${accountPlatform.id}`}
                          value={accountPlatform.loginUrl}
                          placeholder="https://example.com/login"
                          onChange={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              loginUrl: event.target.value
                            })
                          }
                          onBlur={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              loginUrl: normalizeLaunchUrl(event.target.value)
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`platform-username-${accountPlatform.id}`}>
                          平台用户名
                        </label>
                        <input
                          id={`platform-username-${accountPlatform.id}`}
                          value={accountPlatform.username}
                          placeholder="用户名 / 邮箱"
                          onChange={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              username: event.target.value
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`platform-notes-${accountPlatform.id}`}>平台备注</label>
                        <textarea
                          id={`platform-notes-${accountPlatform.id}`}
                          rows={2}
                          value={accountPlatform.notes}
                          placeholder="用途、登录状态、注意事项"
                          onChange={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              notes: event.target.value
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface AccentColorPickerProps {
  profile: ChromeProfile;
  onChange: (patch: Partial<ChromeProfile>) => Promise<void>;
}

function AccentColorPicker({ profile, onChange }: AccentColorPickerProps) {
  const currentColor = resolveAccentColor(profile);

  return (
    <div className="color-swatch-row">
      {PROFILE_ACCENT_COLORS.map((color) => {
        const accent = ACCENT_DETAILS[color];
        return (
          <button
            key={color}
            className={`color-swatch-button ${currentColor === color ? "active" : ""}`}
            type="button"
            aria-label={`选择颜色 ${accent.label}`}
            onClick={() => void onChange({ accentColor: color })}
          >
            <span
              className="color-swatch"
              style={{ "--profile-accent": accent.hex } as CSSProperties}
            />
            {accent.label}
          </button>
        );
      })}
    </div>
  );
}

interface SettingsDialogProps {
  rootPath: string;
  rootStatus: RootStatus | null;
  chromeStatus: ChromeStatus | null;
  healthReport: RootHealthReport | null;
  healthChecking: boolean;
  healthRepairing: boolean;
  orphanRegisteringId: string | null;
  repairResult: RootRepairResult | null;
  backupResult: ProfileBackupResult | null;
  backupPathDraft: string;
  backupWorking: "create" | "restore" | null;
  restoreConfirmOpen: boolean;
  fullBackupScope: FullBackupScope;
  fullBackupPreview: FullProfileBackupPreview | null;
  fullBackupResult: FullProfileBackupResult | null;
  fullBackupPathDraft: string;
  fullRestorePreview: FullProfileRestorePreview | null;
  fullBackupWorking: FullBackupWorking | null;
  selectedProfileCount: number;
  browserPathDraft: string;
  themeDraft: AppTheme;
  onRootPathChange: (value: string) => void;
  onBrowserPathChange: (value: string) => void;
  onThemeChange: (value: AppTheme) => void;
  onApplyRootPath: () => Promise<void>;
  onSaveSettings: () => Promise<void>;
  onHealthCheck: () => Promise<void>;
  onRepairHealth: () => Promise<void>;
  onRegisterOrphanProfile: (profileId: string) => Promise<void>;
  onCreateBackup: () => Promise<void>;
  onRequestRestoreBackup: () => void;
  onConfirmRestoreBackup: () => Promise<void>;
  onCancelRestoreBackup: () => void;
  onFullBackupScopeChange: (scope: FullBackupScope) => void;
  onPreviewFullBackup: () => Promise<void>;
  onCreateFullBackup: () => Promise<void>;
  onPreviewFullRestore: () => Promise<void>;
  onRequestFullRestore: () => void;
  onRevealRootDirectory: () => Promise<void>;
  onRevealBackupsDirectory: () => Promise<void>;
  onBackupPathChange: (value: string) => void;
  onFullBackupPathChange: (value: string) => void;
  onClose: () => void;
}

function SettingsDialog({
  rootPath,
  rootStatus,
  chromeStatus,
  healthReport,
  healthChecking,
  healthRepairing,
  orphanRegisteringId,
  repairResult,
  backupResult,
  backupPathDraft,
  backupWorking,
  restoreConfirmOpen,
  fullBackupScope,
  fullBackupPreview,
  fullBackupResult,
  fullBackupPathDraft,
  fullRestorePreview,
  fullBackupWorking,
  selectedProfileCount,
  browserPathDraft,
  themeDraft,
  onRootPathChange,
  onBrowserPathChange,
  onThemeChange,
  onApplyRootPath,
  onSaveSettings,
  onHealthCheck,
  onRepairHealth,
  onRegisterOrphanProfile,
  onCreateBackup,
  onRequestRestoreBackup,
  onConfirmRestoreBackup,
  onCancelRestoreBackup,
  onFullBackupScopeChange,
  onPreviewFullBackup,
  onCreateFullBackup,
  onPreviewFullRestore,
  onRequestFullRestore,
  onRevealRootDirectory,
  onRevealBackupsDirectory,
  onBackupPathChange,
  onFullBackupPathChange,
  onClose
}: SettingsDialogProps) {
  const titleId = "settings-title";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-card settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>设置</h2>
            <p>数据目录与浏览器路径</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭设置" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="field">
          <label htmlFor="root-path">配置根目录</label>
          <div className="path-row">
            <input
              id="root-path"
              value={rootPath}
              onChange={(event) => onRootPathChange(event.target.value)}
            />
            <button className="secondary-button compact" type="button" onClick={onApplyRootPath}>
              检测
            </button>
          </div>
          <div className="settings-inline-actions">
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => void onRevealRootDirectory()}
            >
              <FolderOpen size={15} />
              打开数据目录
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => void onRevealBackupsDirectory()}
            >
              <FolderOpen size={15} />
              打开备份目录
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="browser-path">Chrome 路径</label>
          <div className="path-row">
            <input
              id="browser-path"
              value={browserPathDraft}
              onChange={(event) => onBrowserPathChange(event.target.value)}
            />
            <button className="secondary-button compact" type="button" onClick={onSaveSettings}>
              检测
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field-label">外观</span>
          <div className="theme-toggle" role="group" aria-label="外观主题">
            <button
              className={themeDraft === "light" ? "active" : ""}
              type="button"
              aria-pressed={themeDraft === "light"}
              onClick={() => onThemeChange("light")}
            >
              <Sun size={15} />
              白天
            </button>
            <button
              className={themeDraft === "dark" ? "active" : ""}
              type="button"
              aria-pressed={themeDraft === "dark"}
              onClick={() => onThemeChange("dark")}
            >
              <Moon size={15} />
              夜晚
            </button>
          </div>
        </div>

        <div className="settings-status">
          <span className={`status-badge ${rootStatus?.writable ? "active" : "needs_check"}`}>
            {rootStatus?.writable ? "根目录正常" : "根目录待检测"}
          </span>
          <span className={`status-badge ${chromeStatus?.available ? "active" : "needs_check"}`}>
            {chromeStatus?.available ? "浏览器正常" : "浏览器待检测"}
          </span>
        </div>

        <div className="settings-health">
          <div className="settings-health-header">
            <div>
              <strong>目录健康</strong>
              <p>检查索引、Profile 文件夹和未登记目录。</p>
            </div>
            <div className="settings-health-actions">
              <button
                className="secondary-button compact"
                type="button"
                disabled={healthChecking}
                onClick={() => void onHealthCheck()}
              >
                <ShieldCheck size={15} />
                {healthChecking ? "检查中" : "健康检查"}
              </button>
              <button
                className="secondary-button compact"
                type="button"
                disabled={healthRepairing}
                onClick={() => void onRepairHealth()}
              >
                <Wrench size={15} />
                {healthRepairing ? "修复中" : "修复可自动处理项"}
              </button>
            </div>
          </div>
          {healthReport ? (
            <HealthReportPanel
              report={healthReport}
              registeringOrphanId={orphanRegisteringId}
              onRegisterOrphan={onRegisterOrphanProfile}
            />
          ) : (
            <p className="health-empty">尚未运行健康检查。</p>
          )}
          {repairResult ? <RepairResultPanel result={repairResult} /> : null}
        </div>

        <div className="settings-backup">
          <div className="settings-health-header">
            <div>
              <strong>数据备份</strong>
              <p>备份账号索引和设置，不包含 Chrome profile 文件夹。</p>
            </div>
            <button
              className="secondary-button compact"
              type="button"
              disabled={backupWorking !== null}
              onClick={() => void onCreateBackup()}
            >
              <Download size={15} />
              {backupWorking === "create" ? "备份中" : "创建备份"}
            </button>
          </div>
          <div className="backup-restore-row">
            <input
              aria-label="备份文件路径"
              placeholder="粘贴备份 JSON 路径"
              value={backupPathDraft}
              onChange={(event) => onBackupPathChange(event.target.value)}
            />
            <button
              className="secondary-button compact"
              type="button"
              disabled={backupWorking !== null}
              onClick={onRequestRestoreBackup}
            >
              <Upload size={15} />
              {backupWorking === "restore" ? "恢复中" : "从备份恢复"}
            </button>
          </div>
          {restoreConfirmOpen ? (
            <div className="confirm-panel compact-confirm">
              <div>
                <strong>确认从备份恢复</strong>
                <p>会覆盖当前账号索引和设置，不会删除已有 Chrome profile 文件夹。</p>
              </div>
              <div className="confirm-actions">
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={onCancelRestoreBackup}
                >
                  取消
                </button>
                <button
                  className="primary-button compact"
                  type="button"
                  disabled={backupWorking !== null}
                  onClick={() => void onConfirmRestoreBackup()}
                >
                  确认恢复
                </button>
              </div>
            </div>
          ) : null}
          {backupResult ? (
            <div className="backup-result">
              <span>{backupResult.profileCount} 个账号</span>
              <code>{backupResult.path}</code>
            </div>
          ) : (
            <p className="health-empty">尚未创建本轮备份。</p>
          )}
        </div>

        <div className="settings-backup full-backup-section">
          <div className="settings-health-header">
            <div>
              <strong>完整备份</strong>
              <p>备份账号索引、设置和 Chrome profile 文件夹。</p>
            </div>
          </div>

          <div className="full-backup-controls">
            <div className="theme-toggle" role="group" aria-label="完整备份范围">
              <button
                className={fullBackupScope === "all" ? "active" : ""}
                type="button"
                aria-pressed={fullBackupScope === "all"}
                onClick={() => onFullBackupScopeChange("all")}
              >
                全部账号
              </button>
              <button
                className={fullBackupScope === "selected" ? "active" : ""}
                type="button"
                aria-pressed={fullBackupScope === "selected"}
                onClick={() => onFullBackupScopeChange("selected")}
              >
                选中账号
              </button>
            </div>
            <span className="profile-count">{selectedProfileCount} 个已选</span>
            <button
              className="secondary-button compact"
              type="button"
              disabled={fullBackupWorking !== null}
              onClick={() => void onPreviewFullBackup()}
            >
              {fullBackupWorking === "preview" ? "预览中" : "预览完整备份"}
            </button>
            <button
              className="primary-button compact"
              type="button"
              disabled={fullBackupWorking !== null}
              onClick={() => void onCreateFullBackup()}
            >
              {fullBackupWorking === "create" ? "备份中" : "创建完整备份"}
            </button>
          </div>

          {fullBackupPreview ? (
            <div className="backup-result">
              <div className="backup-summary-row">
                <span>{fullBackupPreview.profileCount} 个账号</span>
                <span>预计 {formatBytes(fullBackupPreview.totalBytes)}</span>
              </div>
              <code>{fullBackupPreview.destinationDir}</code>
            </div>
          ) : (
            <p className="health-empty">预览后可以确认本次会备份哪些 profile 文件夹。</p>
          )}

          {fullBackupResult ? (
            <div className="backup-result">
              <div className="backup-summary-row">
                <span>{fullBackupResult.profileCount} 个账号</span>
                <span>{formatBytes(fullBackupResult.totalBytes)}</span>
              </div>
              <code>{fullBackupResult.path}</code>
            </div>
          ) : null}

          <div className="backup-restore-row">
            <input
              aria-label="完整备份目录路径"
              placeholder="粘贴完整备份目录路径"
              value={fullBackupPathDraft}
              onChange={(event) => onFullBackupPathChange(event.target.value)}
            />
            <button
              className="secondary-button compact"
              type="button"
              disabled={fullBackupWorking !== null}
              onClick={() => void onPreviewFullRestore()}
            >
              {fullBackupWorking === "restore-preview" ? "扫描中" : "扫描完整备份"}
            </button>
          </div>

          {fullRestorePreview ? (
            <div className="backup-result full-restore-preview">
              <div className="backup-summary-row">
                <span>{fullRestorePreview.profileCount} 个账号</span>
                <span>新增 {fullRestorePreview.newProfileIds.length} 个</span>
                <span>覆盖 {fullRestorePreview.overwriteProfileIds.length} 个</span>
                <span>{formatBytes(fullRestorePreview.totalBytes)}</span>
              </div>
              <code>{fullRestorePreview.path}</code>
              <button
                className="primary-button danger compact"
                type="button"
                disabled={fullBackupWorking !== null}
                onClick={onRequestFullRestore}
              >
                恢复完整备份
              </button>
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="primary-button" type="button" onClick={onSaveSettings}>
            保存设置
          </button>
        </div>
      </section>
    </div>
  );
}

interface HealthReportPanelProps {
  report: RootHealthReport;
  registeringOrphanId: string | null;
  onRegisterOrphan: (profileId: string) => Promise<void>;
}

interface RepairResultPanelProps {
  result: RootRepairResult;
}

function RepairResultPanel({ result }: RepairResultPanelProps) {
  return (
    <div className="repair-result" aria-label="自动修复结果">
      <strong>自动修复结果</strong>
      {result.actions.length === 0 ? (
        <p className="health-empty">没有可自动修复的问题。</p>
      ) : (
        <ul className="repair-action-list">
          {result.actions.map((action) => (
            <li key={`${action.code}-${action.profileId ?? action.path ?? action.title}`}>
              <div>
                <strong>{action.title}</strong>
                {action.profileId ? <span>{action.profileId}</span> : null}
              </div>
              <p>{action.detail}</p>
              {action.path ? <code>{action.path}</code> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HealthReportPanel({
  report,
  registeringOrphanId,
  onRegisterOrphan
}: HealthReportPanelProps) {
  const { profileCount, warningCount, errorCount } = report.summary;
  const isClean = report.issues.length === 0;

  return (
    <div className="health-report" aria-label="目录健康检查结果">
      <div className="health-summary">
        <span>{profileCount} 个账号</span>
        {errorCount > 0 ? <span className="health-chip error">{errorCount} 个错误</span> : null}
        {warningCount > 0 ? (
          <span className="health-chip warning">{warningCount} 个提醒</span>
        ) : null}
        {isClean ? <span className="health-chip active">未发现问题</span> : null}
      </div>

      {isClean ? (
        <p className="health-empty">索引和配置目录当前一致。</p>
      ) : (
        <ul className="health-issue-list">
          {report.issues.map((issue) => {
            const orphanProfileId =
              issue.code === "orphan_profile_dir" ? issue.profileId : null;
            return (
              <li key={`${issue.code}-${issue.profileId ?? issue.path ?? issue.title}`}>
                <div>
                  <span className={`health-severity ${issue.severity}`}>
                    {issue.severity === "error" ? "错误" : "提醒"}
                  </span>
                  <strong>{issue.title}</strong>
                </div>
                <p>{issue.detail}</p>
                {issue.path ? <code>{issue.path}</code> : null}
                {orphanProfileId ? (
                  <button
                    className="secondary-button compact health-issue-action"
                    type="button"
                    aria-label={`登记为账号 ${orphanProfileId}`}
                    disabled={registeringOrphanId === orphanProfileId}
                    onClick={() => void onRegisterOrphan(orphanProfileId)}
                  >
                    <UserPlus size={15} />
                    {registeringOrphanId === orphanProfileId ? "登记中" : "登记为账号"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface DeleteConfirmPanelProps {
  pendingDelete: PendingDelete;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

interface ProjectDeleteConfirmPanelProps {
  project: AirdropProject;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

function ProjectDeleteConfirmPanel({
  project,
  onCancel,
  onConfirm
}: ProjectDeleteConfirmPanelProps) {
  return (
    <div className="confirm-panel">
      <div>
        <strong>确认删除项目</strong>
        <p>{project.name} 会从项目列表移除，不会删除任何 Chrome profile。</p>
      </div>
      <div className="confirm-actions">
        <button className="secondary-button compact" type="button" onClick={onCancel}>
          取消
        </button>
        <button
          className="primary-button compact danger"
          type="button"
          aria-label="确认删除项目"
          onClick={() => void onConfirm()}
        >
          确认删除
        </button>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({
  pendingDelete,
  onCancel,
  onConfirm
}: DeleteConfirmPanelProps) {
  const deletingData = pendingDelete.mode === "data";
  const titleId = "account-delete-confirm-title";
  const title = deletingData ? "确认删除账号和文件夹" : "确认只删除账号记录";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="modal-card delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>删除前再确认一次，避免误触。</p>
          </div>
          <button className="icon-button" type="button" aria-label="取消删除账号" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p>
          {deletingData
            ? `${pendingDelete.profile.name} 的记录和 profile 文件夹都会被删除。`
            : `${pendingDelete.profile.name} 会从列表移除，profile 文件夹会保留。`}
        </p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className={`primary-button ${deletingData ? "danger" : ""}`}
            type="button"
            onClick={() => void onConfirm()}
          >
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}

interface BatchDeleteConfirmDialogProps {
  profiles: ChromeProfile[];
  working: DeleteMode | null;
  onCancel: () => void;
  onConfirm: (mode: DeleteMode) => Promise<void>;
}

function BatchDeleteConfirmDialog({
  profiles,
  working,
  onCancel,
  onConfirm
}: BatchDeleteConfirmDialogProps) {
  const titleId = "batch-delete-confirm-title";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="modal-card delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>确认批量删除账号</h2>
            <p>删除前再确认一次，避免误触。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="取消批量删除账号"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <p>将删除 {profiles.length} 个账号。</p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="secondary-button danger"
            type="button"
            disabled={working !== null}
            onClick={() => void onConfirm("record")}
          >
            {working === "record" ? "删除中" : "只删除记录"}
          </button>
          <button
            className="primary-button danger"
            type="button"
            disabled={working !== null}
            onClick={() => void onConfirm("data")}
          >
            {working === "data" ? "删除中" : "删除记录和文件夹"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface FullRestoreConfirmDialogProps {
  preview: FullProfileRestorePreview;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

function FullRestoreConfirmDialog({
  preview,
  working,
  onCancel,
  onConfirm
}: FullRestoreConfirmDialogProps) {
  const titleId = "full-restore-confirm-title";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="modal-card delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>确认恢复完整备份</h2>
            <p>恢复前再确认一次，避免误触。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="取消恢复完整备份"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          将恢复 {preview.profileCount} 个账号，新增 {preview.newProfileIds.length} 个，
          覆盖 {preview.overwriteProfileIds.length} 个已存在的 profile 文件夹。
        </p>
        <code className="confirm-path">{preview.path}</code>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="primary-button danger"
            type="button"
            disabled={working}
            onClick={() => void onConfirm()}
          >
            {working ? "恢复中" : "确认恢复"}
          </button>
        </div>
      </section>
    </div>
  );
}

function profileIndexLabel(profileId: string): string {
  const match = profileId.match(/(\d+)$/);
  if (!match) {
    return "01";
  }
  return match[1].slice(-2).padStart(2, "0");
}

function resolveAccentColor(profile: ChromeProfile): ProfileAccentColor {
  if (profile.accentColor && profile.accentColor in ACCENT_DETAILS) {
    return profile.accentColor;
  }
  return defaultAccentColor(profile.id);
}

function accentDetailsForProfile(profile: ChromeProfile) {
  return ACCENT_DETAILS[resolveAccentColor(profile)];
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function normalizeLaunchUrl(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    return "";
  }
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  return `https://${cleaned}`;
}

function createUrlLibraryDraft(item?: UrlLibraryItem | null): UrlLibraryDraft {
  return {
    name: item?.name ?? "",
    url: item?.url ?? "",
    tags: item?.tags.join(", ") ?? "",
    notes: item?.notes ?? ""
  };
}

function createUrlLibraryItem(
  item: Pick<UrlLibraryItem, "name" | "url" | "tags" | "notes">,
  existingItems: UrlLibraryItem[],
  now: string
): UrlLibraryItem {
  return {
    id: nextUrlLibraryId(existingItems),
    name: item.name,
    url: normalizeLaunchUrl(item.url),
    tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
    notes: item.notes,
    createdAt: now,
    updatedAt: now
  };
}

function nextUrlLibraryId(items: UrlLibraryItem[]): string {
  const usedIds = new Set(items.map((item) => item.id));
  let index = items.length + 1;
  let id = `url-${String(index).padStart(3, "0")}`;
  while (usedIds.has(id)) {
    index += 1;
    id = `url-${String(index).padStart(3, "0")}`;
  }
  return id;
}

function parseUrlTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ];
}

function normalizeBulkOpenIntervalSeconds(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return Number.parseInt(DEFAULT_BULK_OPEN_INTERVAL_SECONDS, 10);
  }

  return Math.min(60, Math.max(1, parsed));
}

function displayUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    return `${parsed.host}${path}`;
  } catch {
    return url.replace(/^https?:\/\//i, "");
  }
}

function formatWindowInspectionSummary(
  profileName: string,
  windows: ChromeWindowInfo[]
): string {
  const firstWindow = windows[0];
  const minimizedText = firstWindow?.minimized ? "，已最小化" : "";
  const firstWindowDetail = firstWindow
    ? `（${firstWindow.width}x${firstWindow.height} @ ${firstWindow.x},${firstWindow.y}${minimizedText}）`
    : "";

  return `${profileName} ${windows.length} 个窗口${firstWindowDetail}`;
}

function availableScreenWidth(): number {
  return Math.max(1, window.screen.availWidth || window.innerWidth || 1);
}

function availableScreenHeight(): number {
  return Math.max(1, window.screen.availHeight || window.innerHeight || 1);
}

function availableScreenLeft(): number {
  return finiteScreenOffset(screenOffset("availLeft"));
}

function availableScreenTop(): number {
  return finiteScreenOffset(screenOffset("availTop"));
}

function screenOffset(property: "availLeft" | "availTop"): number {
  const screenWithOffsets = window.screen as Screen &
    Partial<Record<"availLeft" | "availTop", number>>;
  return screenWithOffsets[property] ?? 0;
}

function finiteScreenOffset(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function maxTileableWindowCount(screenWidth: number, screenHeight: number): number {
  const columns = Math.max(1, Math.floor(screenWidth / MIN_TILED_WINDOW_WIDTH));
  const rows = Math.max(1, Math.floor(screenHeight / MIN_TILED_WINDOW_HEIGHT));
  return columns * rows;
}

function tileBoundsForCount(
  count: number,
  screenWidth: number,
  screenHeight: number,
  originX = 0,
  originY = 0
): WindowBounds[] {
  if (count <= 0) {
    return [];
  }

  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const tileWidth = Math.floor(screenWidth / columns);
  const tileHeight = Math.floor(screenHeight / rows);

  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: originX + column * tileWidth,
      y: originY + row * tileHeight,
      width: tileWidth,
      height: tileHeight
    };
  });
}

function windowMatchesBounds(windowInfo: ChromeWindowInfo, bounds: WindowBounds): boolean {
  return (
    Math.abs(windowInfo.x - bounds.x) <= WINDOW_BOUNDS_TOLERANCE &&
    Math.abs(windowInfo.y - bounds.y) <= WINDOW_BOUNDS_TOLERANCE &&
    Math.abs(windowInfo.width - bounds.width) <= WINDOW_BOUNDS_TOLERANCE &&
    Math.abs(windowInfo.height - bounds.height) <= WINDOW_BOUNDS_TOLERANCE
  );
}

function parseBatchProfileLines(value: string): BatchProfileDraft[] {
  return value
    .split(/\r?\n/)
    .map((line) => parseBatchProfileLine(line))
    .filter((profile): profile is BatchProfileDraft => Boolean(profile));
}

function parseBatchProfileLine(line: string): BatchProfileDraft | null {
  const cleanedLine = line.trim();
  if (!cleanedLine) {
    return null;
  }

  const parts = cleanedLine.includes("\t")
    ? cleanedLine.split("\t").map((part) => part.trim())
    : cleanedLine.includes("|")
      ? cleanedLine.split("|").map((part) => part.trim())
      : cleanedLine.split(/[,，]/).map((part) => part.trim());
  const [name = "", tagsRaw = "", ...noteParts] = parts;
  const cleanedName = name.trim();
  if (!cleanedName) {
    return null;
  }

  return {
    name: cleanedName,
    tags: parseBatchProfileTags(tagsRaw),
    notes: noteParts.join(", ").trim()
  };
}

function parseBatchProfileTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const tag of value.split(/[\s,，、;；]+/)) {
    const cleaned = tag.trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    tags.push(cleaned);
  }

  return tags;
}

function isImportCandidateSelectable(candidate: ProfileImportCandidate): boolean {
  return candidate.confidence !== "skipped" && !candidate.duplicateProfileId;
}

function importCandidateStatusText(candidate: ProfileImportCandidate): string {
  if (candidate.duplicateProfileName) {
    return `已导入：${candidate.duplicateProfileName}`;
  }
  if (candidate.confidence === "ready") {
    return "可导入";
  }
  if (candidate.confidence === "suspicious") {
    return "可疑";
  }
  return candidate.skippedReason || "跳过";
}

function createProfileUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseProjectUrlImportLines(value: string): ProjectUrl[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<ProjectUrl[]>((urls, line) => {
      const parsed = parseProjectUrlImportLine(line, urls.length);
      return parsed ? [...urls, parsed] : urls;
    }, []);
}

function parseProjectUrlImportLine(line: string, index: number): ProjectUrl | null {
  const urlMatch = line.match(
    /https?:\/\/[^\s]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/i
  );
  if (!urlMatch || urlMatch.index === undefined) {
    return null;
  }

  const rawUrl = trimImportedUrl(urlMatch[0]);
  const url = normalizeLaunchUrl(rawUrl);
  if (!url) {
    return null;
  }

  const beforeUrl = line.slice(0, urlMatch.index).trim();
  const afterUrl = line.slice(urlMatch.index + urlMatch[0].length).trim();
  const notes = afterUrl.replace(/^[-:：,，\s]+/, "").trim();

  return {
    id: `url-${String(index + 1).padStart(3, "0")}`,
    name: beforeUrl || displayUrlLabel(url),
    url,
    notes
  };
}

function trimImportedUrl(value: string): string {
  return value.trim().replace(/[),，。；;、]+$/g, "");
}

function projectDisplayUrls(project: AirdropProject): ProjectUrl[] {
  return normalizeProjectUrlsForStorage(project.urls).filter((projectUrl) => projectUrl.url);
}

function projectEditableUrls(project: AirdropProject): ProjectUrl[] {
  const urls = cleanEditableProjectUrls(project.urls);
  if (urls.length > 0) {
    return urls;
  }

  const legacyUrl = normalizeLaunchUrl(project.url);
  return [
    {
      id: "url-001",
      name: "主入口",
      url: legacyUrl,
      notes: ""
    }
  ];
}

function projectOpenUrls(project: AirdropProject): ProjectUrl[] {
  const urls = projectDisplayUrls(project);
  if (urls.length > 0) {
    return urls;
  }

  const legacyUrl = normalizeLaunchUrl(project.url);
  return legacyUrl
    ? [
        {
          id: "url-001",
          name: "主入口",
          url: legacyUrl,
          notes: ""
        }
      ]
    : [];
}

function normalizeEditableProjectUrls(urls: ProjectUrl[] | undefined): ProjectUrl[] {
  return normalizeProjectUrlsForStorage(urls);
}

function cleanEditableProjectUrls(urls: ProjectUrl[] | undefined): ProjectUrl[] {
  if (!Array.isArray(urls)) {
    return [];
  }

  const seen = new Set<string>();
  return urls
    .filter((projectUrl) => projectUrl && typeof projectUrl.id === "string")
    .map((projectUrl, index) => {
      const id = uniqueProjectUrlId(projectUrl.id, index, seen);
      return {
        id,
        name: typeof projectUrl.name === "string" ? projectUrl.name : `网址 ${index + 1}`,
        url: typeof projectUrl.url === "string" ? projectUrl.url : "",
        notes: typeof projectUrl.notes === "string" ? projectUrl.notes : ""
      };
    });
}

function normalizeProjectUrlsForStorage(urls: ProjectUrl[] | undefined): ProjectUrl[] {
  return cleanEditableProjectUrls(urls).map((projectUrl, index) => ({
    ...projectUrl,
    name: projectUrl.name.trim() || `网址 ${index + 1}`,
    url: normalizeLaunchUrl(projectUrl.url),
    notes: projectUrl.notes.trim()
  }));
}

function createProjectUrl(
  existingUrls: ProjectUrl[],
  overrides: Partial<ProjectUrl> = {}
): ProjectUrl {
  const id = overrides.id ?? nextProjectUrlId(existingUrls);
  const index = existingUrls.length + 1;
  return {
    id,
    name: overrides.name ?? `网址 ${index}`,
    url: overrides.url ?? "",
    notes: overrides.notes ?? ""
  };
}

function nextProjectUrlId(urls: ProjectUrl[]): string {
  const used = new Set(urls.map((projectUrl) => projectUrl.id));
  for (let index = 1; index < 10000; index += 1) {
    const id = `url-${String(index).padStart(3, "0")}`;
    if (!used.has(id)) {
      return id;
    }
  }

  return `url-${Date.now()}`;
}

function uniqueProjectUrlId(id: string, index: number, seen: Set<string>): string {
  const cleanedId = id.trim();
  const fallback = `url-${String(index + 1).padStart(3, "0")}`;
  let nextId = cleanedId || fallback;
  if (!seen.has(nextId)) {
    seen.add(nextId);
    return nextId;
  }

  for (let offset = index + 1; offset < 10000; offset += 1) {
    nextId = `url-${String(offset).padStart(3, "0")}`;
    if (!seen.has(nextId)) {
      seen.add(nextId);
      return nextId;
    }
  }

  nextId = `url-${Date.now()}`;
  seen.add(nextId);
  return nextId;
}

function primaryProjectUrl(urls: ProjectUrl[]): string {
  return cleanEditableProjectUrls(urls).find((projectUrl) => projectUrl.url.trim())?.url ?? "";
}

function cloneProfileForDraft(profile: ChromeProfile): ChromeProfile {
  return {
    ...profile,
    tags: [...profile.tags],
    accountPlatforms: profile.accountPlatforms.map((accountPlatform) => ({
      ...accountPlatform
    }))
  };
}

function cloneProjectForDraft(project: AirdropProject): AirdropProject {
  return {
    ...project,
    urls: projectEditableUrls(project).map((projectUrl) => ({ ...projectUrl })),
    profileIds: [...project.profileIds]
  };
}

function createProject(
  existingProjects: AirdropProject[],
  initialProfileIds: string[],
  now: string
): AirdropProject {
  const id = nextProjectId(existingProjects);
  return {
    id,
    name: `项目 ${existingProjects.length + 1}`,
    url: "",
    urls: [createProjectUrl([], { id: "url-001", name: "主入口" })],
    notes: "",
    profileIds: [...new Set(initialProfileIds)],
    intervalSeconds: Number.parseInt(DEFAULT_BULK_OPEN_INTERVAL_SECONDS, 10),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null
  };
}

function updateProject(
  project: AirdropProject,
  patch: Partial<AirdropProject>,
  now: string
): AirdropProject {
  const nextUrls = Array.isArray(patch.urls)
    ? cleanEditableProjectUrls(patch.urls)
    : typeof patch.url === "string"
      ? updatePrimaryProjectUrl(projectEditableUrls(project), patch.url)
      : projectEditableUrls(project);
  const nextUrl =
    typeof patch.url === "string" && !Array.isArray(patch.urls)
      ? normalizeLaunchUrl(patch.url)
      : primaryProjectUrl(nextUrls);

  return {
    ...project,
    ...patch,
    name: typeof patch.name === "string" ? patch.name : project.name,
    url: nextUrl,
    urls: nextUrls,
    notes: typeof patch.notes === "string" ? patch.notes : project.notes,
    profileIds: Array.isArray(patch.profileIds)
      ? [...new Set(patch.profileIds)]
      : project.profileIds,
    intervalSeconds:
      typeof patch.intervalSeconds === "number"
        ? normalizeBulkOpenIntervalSeconds(String(patch.intervalSeconds))
        : project.intervalSeconds,
    updatedAt: now
  };
}

function duplicateProject(
  source: AirdropProject,
  existingProjects: AirdropProject[],
  now: string
): AirdropProject {
  return {
    ...source,
    id: nextProjectId(existingProjects),
    name: `${source.name} 副本`,
    profileIds: [...source.profileIds],
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null
  };
}

function updatePrimaryProjectUrl(urls: ProjectUrl[], url: string): ProjectUrl[] {
  const safeUrls = urls.length > 0 ? urls : [createProjectUrl([], { id: "url-001", name: "主入口" })];
  return safeUrls.map((projectUrl, index) =>
    index === 0 ? { ...projectUrl, url } : projectUrl
  );
}

function nextProjectId(projects: AirdropProject[]): string {
  const used = new Set(projects.map((project) => project.id));
  for (let index = 1; index < 10000; index += 1) {
    const id = `project-${String(index).padStart(3, "0")}`;
    if (!used.has(id)) {
      return id;
    }
  }
  return `project-${Date.now()}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function windowAutomationErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (isLikelyOsascriptAccessibilityError(message)) {
    return `窗口操作失败：macOS 当前拦截的是 /usr/bin/osascript。请在系统设置 > 隐私与安全性 > 辅助功能 中同时允许 MultiChrome 和 /usr/bin/osascript。原始错误：${message}`;
  }
  if (isLikelyWindowAutomationPermissionError(message)) {
    return `窗口操作失败：可能需要在 macOS 系统设置 > 隐私与安全性 > 辅助功能 中允许 MultiChrome 控制电脑。原始错误：${message}`;
  }

  return `窗口操作失败：${message}`;
}

function isLikelyOsascriptAccessibilityError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("osascript") &&
    (message.includes("不允许辅助访问") ||
      normalized.includes("-25211") ||
      normalized.includes("not allowed assistive"))
  );
}

function isLikelyWindowAutomationPermissionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "system events",
    "osascript",
    "not authorized",
    "not permitted",
    "operation not permitted",
    "permission",
    "辅助功能",
    "权限",
    "apple events"
  ].some((keyword) => normalized.includes(keyword));
}

export default App;

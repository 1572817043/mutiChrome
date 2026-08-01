import {
  Chrome,
  Download,
  FolderKanban,
  FolderOpen,
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings,
  Tags,
  UserPlus
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BROWSER_PATH,
  formatBytes,
  normalizeSettings,
  profileApi,
  profilePath,
  type BrowserSessionSnapshot,
  type BrowserSessionStatus,
  type ChromeStatus,
  type RootStatus,
  type WindowBounds
} from "./api";
import {
  parseBatchProfileLines,
  type BatchProfileDraft
} from "./domain/batchProfileParser";
import { BatchDeleteConfirmDialog } from "./bulk-actions/BatchDeleteConfirmDialog";
import { BulkActionBar } from "./bulk-actions/BulkActionBar";
import {
  cloneProjectForDraft,
  createProject,
  duplicateProject,
  projectOpenUrls,
  updateProject
} from "./domain/projectModel";
import {
  appendBrowserLaunchEvents,
  browserLaunchEventFromResult,
  browserLaunchFailed,
  browserLaunchSucceeded,
  formatBulkLaunchQueueMessage,
  formatProjectLaunchQueueMessage,
  selectRetryableBrowserLaunchProfileIds,
  shouldMarkStartingAfterLaunch,
  summarizeBrowserLaunchQueue,
  type BrowserLaunchEvent,
  type BrowserLaunchResult
} from "./browserSessionLaunch";
import {
  buildInspectWindowOperationSummary,
  buildSyncLayoutWindowOperationSummary,
  buildTileWindowOperationSummary,
  type BrowserOperation
} from "./browserOperations";
import { useBrowserOperations } from "./browser/operations/useBrowserOperations";
import { isSessionRunning, profileSessionStatus } from "./browserSessions";
import {
  buildGridWindowLayoutPlan,
  buildPrimaryWindowRegistry,
  buildWindowLayoutSyncPlan,
  windowMatchesBounds,
  type BrowserWindowRegistryInput
} from "./browserWindows";
import {
  cloneProfileForDraft,
  createProfile,
  defaultAccentColor,
  duplicateProfile,
  removeProfile,
  updateProfile
} from "./domain/profileModel";
import {
  isReplacementCreatedAt,
  nextSequentialId
} from "./domain/profileDocumentMutationModel";
import { useProfileDocumentMutations } from "./domain/useProfileDocumentMutations";
import { BatchCreateProfilesDialog } from "./profiles/BatchCreateProfilesDialog";
import {
  DeleteConfirmDialog,
  type DeleteMode
} from "./profiles/DeleteConfirmDialog";
import { EditProfileDialog } from "./profiles/EditProfileDialog";
import { ProfileCard, type CardDensity } from "./profiles/ProfileCard";
import {
  type ImportPersistResult,
  importCandidateStatusText,
  isImportCandidateSelectable,
  useProfileImport
} from "./profiles/useProfileImport";
import { FullRestoreConfirmDialog } from "./data-safety/FullRestoreConfirmDialog";
import { EditProjectDialog } from "./projects/EditProjectDialog";
import { ProjectsView } from "./projects/ProjectsView";
import {
  SettingsDialog
} from "./settings/SettingsDialog";
import { useDataSafetySettings } from "./settings/useDataSafetySettings";
import {
  useRootSettings,
  type RootSettingsLoadedData
} from "./settings/useRootSettings";
import { useRuntimeDiagnostics } from "./settings/useRuntimeDiagnostics";
import {
  createUrlLibraryDraft,
  createUrlLibraryItem,
  parseUrlTags,
  type UrlLibraryDraft
} from "./domain/urlLibraryModel";
import {
  DEFAULT_BULK_OPEN_INTERVAL_SECONDS,
  formatWindowInspectionSummary,
  normalizeBulkOpenIntervalSeconds
} from "./shared/formatHelpers";
import {
  availableScreenHeight,
  availableScreenLeft,
  availableScreenTop,
  availableScreenWidth
} from "./shared/screenWorkArea";
import {
  DEFAULT_PROFILE_LAUNCH_URL,
  displayUrlLabel,
  normalizeLaunchUrl
} from "./shared/urlHelpers";
import {
  errorMessage,
  windowAutomationErrorMessage
} from "./shared/windowAutomationErrors";
import {
  UrlLibraryDeleteConfirmDialog,
  UrlLibraryEditDialog,
  UrlLibraryView
} from "./url-library/UrlLibraryView";
import type {
  AccountPlatform,
  AirdropProject,
  ChromeProfile,
  ProfileImportCandidate,
  ProfileMarker,
  ProfileDocument,
  ProjectUrl,
  ProfileSettings,
  UrlLibraryItem
} from "./types";
import { useBrowserSessions } from "./useBrowserSessions";

type ActiveView = "accounts" | "projects" | "url-library";
interface BulkLaunchRetryState {
  profileIds: string[];
  url: string;
}

type DevImportMeta = ImportMeta & {
  env?: {
    DEV?: boolean;
  };
};

const RUNNING_STATUS_POLL_MS = 5000;
const LAUNCH_CONFIRMATION_DELAY_MS = 2000;
const MAX_BROWSER_OPERATIONS = 20;
const BROWSER_COMMAND_TIMEOUT_MS = 120_000;
interface PendingDelete {
  profile: ChromeProfile;
  mode: DeleteMode;
}

interface LoadedRootData extends RootSettingsLoadedData {
  launchEvents: BrowserLaunchEvent[];
}

interface RestoredDataSafetyDocument {
  document: ProfileDocument;
  settings: ProfileSettings;
  rootStatus: RootStatus;
  chromeStatus: ChromeStatus;
  message: string;
}

interface RestoreDataSafetyDocumentInput {
  targetRootPath: string;
  restore: () => Promise<RestoredDataSafetyDocument>;
}

function App() {
  const [rootPath, setRootPath] = useState("");
  const [settings, setSettings] = useState<ProfileSettings>({
    browserPath: DEFAULT_BROWSER_PATH,
    favoriteUrls: [],
    recentUrls: [],
    urlLibrary: [],
    theme: "light"
  });
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
  const [editingUrlLibraryCreatedAt, setEditingUrlLibraryCreatedAt] = useState<
    string | null
  >(null);
  const [urlLibraryEditorOpen, setUrlLibraryEditorOpen] = useState(false);
  const [pendingUrlDeleteId, setPendingUrlDeleteId] = useState<string | null>(null);
  const [pendingUrlDeleteCreatedAt, setPendingUrlDeleteCreatedAt] = useState<
    string | null
  >(null);
  const [query, setQuery] = useState("");
  const [profileSizes, setProfileSizes] = useState<Record<string, number | null>>({});
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
  const [lastBulkLaunchRetry, setLastBulkLaunchRetry] =
    useState<BulkLaunchRetryState | null>(null);
  const [launchEvents, setLaunchEvents] = useState<BrowserLaunchEvent[]>([]);
  const launchEventsRef = useRef<BrowserLaunchEvent[]>([]);
  const launchEventsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [windowInspecting, setWindowInspecting] = useState(false);
  const [windowTiling, setWindowTiling] = useState(false);
  const [windowSyncing, setWindowSyncing] = useState(false);
  const [windowFocusing, setWindowFocusing] = useState(false);
  const [layoutSourceProfileId, setLayoutSourceProfileId] = useState("");
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [message, setMessage] = useState("正在初始化...");
  const {
    enqueueDocumentMutation,
    persistDocument,
    commitProfileDocumentState,
    replaceProfileDocumentState,
    getProfileDocumentSnapshot
  } = useProfileDocumentMutations({
    rootPath,
    profiles,
    settings,
    projects,
    saveDocument: (targetRootPath, document) =>
      profileApi.saveProfiles(targetRootPath, document),
    normalizeDocumentSettings: normalizeSettings,
    onCommitDocumentState: (documentState, nextMessage) => {
      setProfiles(documentState.profiles);
      setProjects(documentState.projects);
      setSettings(documentState.settings);
      syncPersistedSettings(documentState.settings, documentState.profiles.length);
      setSelectedIds((current) =>
        current.filter((id) =>
          documentState.profiles.some((profile) => profile.id === id)
        )
      );
      setMessage(nextMessage);
    }
  });
  const {
    importPath,
    importCandidates,
    selectedImportPaths,
    importScanning,
    importingProfiles,
    showImport,
    selectedImportCount,
    scanImportCandidates,
    toggleImportCandidate,
    importSelectedCandidates,
    onImportPathChange,
    clearImportPreview,
    toggleImportPanel,
    resetForLoadedRoot
  } = useProfileImport({
    rootPath,
    onImportCandidates: importCandidatesInQueue,
    onMessage: setMessage
  });
  const {
    rootSettings,
    chromeStatus,
    themeDraft,
    resetDrafts: resetRootSettingsDrafts,
    syncLoadedRoot,
    syncPersistedSettings,
    syncRestoredRoot
  } = useRootSettings<LoadedRootData>({
    rootPath,
    settings,
    onLoadRoot: loadRoot,
    onReadRootData: readRootData,
    onCommitLoadedRoot: commitLoadedRoot,
    onPersistSettings: (nextSettings) =>
      persist(profiles, "设置已保存", nextSettings).then(() => undefined),
    onMessage: setMessage
  });
  const dataSafetySettings = useDataSafetySettings({
    rootPath,
    profiles,
    selectedProfileIds: selectedIds,
    onPersistProfiles: (nextProfiles, nextMessage) =>
      persist(nextProfiles, nextMessage).then(() => undefined),
    onRestoreDocument: restoreDataSafetyDocument,
    onMessage: setMessage
  });
  const {
    health,
    lightBackup,
    fullBackup,
    fullRestoreConfirmOpen,
    fullRestorePreview,
    fullBackupWorking,
    cancelFullRestore,
    confirmFullRestore,
    closeDataSafetyDialogs
  } = dataSafetySettings;
  const launchingProfileIdsRef = useRef(new Set<string>());
  const bulkOpenCancelledRef = useRef(false);
  const projectOpenCancelledRef = useRef(false);
  const bulkOpenDelayResolveRef = useRef<(() => void) | null>(null);
  const {
    sessionsById: browserSessionsById,
    runningProfileIds,
    applySnapshots: applyBrowserSessionSnapshots,
    clearSnapshots: clearBrowserSessionSnapshots,
    nextRequestId: nextBrowserSessionRequestId,
    isLatestRequest: isLatestBrowserSessionRequest,
    markStarting: markBrowserSessionStarting,
    clearLaunchConfirmationRefresh,
    scheduleLaunchConfirmationRefresh
  } = useBrowserSessions({
    launchConfirmationDelayMs: LAUNCH_CONFIRMATION_DELAY_MS
  });
  const {
    browserOperations,
    startWindowOperation,
    finishWindowOperation,
    startProfileOpenOperation,
    finishProfileOpenOperation,
    failProfileOpenOperation,
    startBulkOpenUrlOperation,
    startProjectOpenOperation,
    finishLaunchQueueOperation,
    runBrowserCommandWithTimeout,
    listProfileWindowsWithTimeout,
    focusProfileWindowWithTimeout,
    setProfileWindowBoundsWithTimeout,
    canStartBrowserOperationForProfiles
  } = useBrowserOperations({
    rootPath,
    maxOperations: MAX_BROWSER_OPERATIONS,
    commandTimeoutMs: BROWSER_COMMAND_TIMEOUT_MS,
    onMessage: setMessage
  });

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

  const selectedProfiles = useMemo(
    () => profiles.filter((profile) => selectedIds.includes(profile.id)),
    [profiles, selectedIds]
  );
  const runtimeDiagnosticsProfile = useMemo(() => {
    if (selectedIds.length !== 1) {
      return null;
    }

    return profiles.find((profile) => profile.id === selectedIds[0]) ?? null;
  }, [profiles, selectedIds]);
  const { runtimeDiagnostics, resetRuntimeDiagnostics } = useRuntimeDiagnostics({
    rootPath,
    settingsOpen,
    selectedProfile: runtimeDiagnosticsProfile,
    session: runtimeDiagnosticsProfile
      ? browserSessionsById[runtimeDiagnosticsProfile.id] ?? null
      : null,
    selectedProfileCount: selectedIds.length,
    enabled: Boolean((import.meta as DevImportMeta).env?.DEV)
  });
  const profileIds = useMemo(() => profiles.map((profile) => profile.id), [profiles]);
  const totalProfiles = profiles.length;
  const hasSelectedProfiles = selectedProfiles.length > 0;
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
      const requestId = nextBrowserSessionRequestId();
      try {
        const snapshots = await profileApi.snapshotBrowserSessions(rootPath, profileIds, false);
        if (!cancelled && isLatestBrowserSessionRequest(requestId)) {
          applyBrowserSessionSnapshots(snapshots);
        }
      } catch {
        // 轻量轮询失败时保留上一次状态，下一轮成功后再纠偏。
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
  }, [activeView, profileIds, rootPath]);

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
      await loadRoot(defaultPath);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function readRootData(path: string): Promise<LoadedRootData> {
    const status = await profileApi.initProfileRoot(path);
    const document = await profileApi.loadProfiles(path);
    const settings = normalizeSettings(document.settings);
    const launchEvents = await loadBrowserLaunchEvents(path);
    const chrome = await profileApi.detectChrome(settings.browserPath);
    return { status, document, settings, launchEvents, chrome };
  }

  async function commitLoadedRoot(path: string, loaded: LoadedRootData) {
    clearLaunchConfirmationRefresh();
    dataSafetySettings.resetDataSafetyState();
    resetForLoadedRoot();
    replaceProfileDocumentState({
      rootPath: path,
      profiles: loaded.document.profiles,
      settings: loaded.settings,
      projects: loaded.document.projects
    });
    setRootPath(path);
    syncLoadedRoot(path, loaded.status, loaded.settings, loaded.chrome);
    setSettings(loaded.settings);
    setProfiles(loaded.document.profiles);
    setProjects(loaded.document.projects);
    launchEventsRef.current = loaded.launchEvents;
    setLaunchEvents(loaded.launchEvents);
    setMessage(loaded.status.writable ? "根目录正常" : "根目录不可写");
    await refreshRunningProfiles(path, loaded.document.profiles);
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
    setEditingUrlLibraryCreatedAt(null);
    setPendingUrlDeleteCreatedAt(null);
    setUrlLibraryEditorOpen(false);
    setPendingUrlDeleteId(null);
    setPendingDelete(null);
    setPendingBatchDelete(null);
    setBatchDeleteWorking(null);
    setSelectedIds([]);
    setBulkTag("");
    setBulkUrl("");
    setLastBulkLaunchRetry(null);
    setProjectQuery("");
    setBulkOpenRunning(false);
    setWindowInspecting(false);
    setWindowTiling(false);
    setWindowSyncing(false);
    setWindowFocusing(false);
    setOpeningProjectId(null);
    bulkOpenCancelledRef.current = false;
    projectOpenCancelledRef.current = false;
    bulkOpenDelayResolveRef.current = null;
    launchingProfileIdsRef.current.clear();
    setProfileSizes({});
  }

  async function loadRoot(path: string) {
    setMessage("正在检查配置根目录...");
    const loaded = await readRootData(path);
    await commitLoadedRoot(path, loaded);
    return loaded;
  }

  async function loadBrowserLaunchEvents(path: string): Promise<BrowserLaunchEvent[]> {
    try {
      return await profileApi.loadBrowserLaunchEvents(path);
    } catch {
      return [];
    }
  }

  async function refreshRunningProfiles(
    path = rootPath,
    sourceProfiles = profiles,
    options: { clearOnFailure?: boolean } = {}
  ): Promise<BrowserSessionSnapshot[]> {
    if (!path) {
      if (options.clearOnFailure !== false) {
        clearBrowserSessionSnapshots();
      }
      return [];
    }

    const requestId = nextBrowserSessionRequestId();
    try {
      const snapshots = await profileApi.snapshotBrowserSessions(
        path,
        sourceProfiles.map((profile) => profile.id),
        false
      );
      if (isLatestBrowserSessionRequest(requestId)) {
        applyBrowserSessionSnapshots(snapshots);
      }
      return snapshots;
    } catch {
      if (isLatestBrowserSessionRequest(requestId) && options.clearOnFailure !== false) {
        clearBrowserSessionSnapshots();
      }
      return [];
    }
  }

  async function refreshSelectedRunningProfiles() {
    const snapshots = await refreshRunningProfiles(rootPath, profiles);
    const runningIds = new Set(
      snapshots
        .filter(isSessionRunning)
        .map((snapshot) => snapshot.profileId)
    );
    return selectedProfiles.filter((profile) => runningIds.has(profile.id));
  }

  async function persist(
    nextProfiles: ChromeProfile[],
    nextMessage: string,
    nextSettings = settings,
    nextProjects = projects,
    targetRootPath = rootPath,
    shouldCommit?: () => boolean
  ): Promise<boolean> {
    return persistDocument({
      profiles: nextProfiles,
      message: nextMessage,
      settings: nextSettings,
      projects: nextProjects,
      baseDocument: {
        profiles,
        settings,
        projects
      },
      targetRootPath,
      shouldCommit
    });
  }

  async function importCandidatesInQueue(
    candidates: ProfileImportCandidate[],
    shouldCommit: () => boolean
  ): Promise<ImportPersistResult> {
    return enqueueDocumentMutation(async () => {
      if (!shouldCommit()) {
        return "not-saved";
      }

      const { rootPath: targetRootPath } = getProfileDocumentSnapshot();
      const shouldNotifyRollback = () =>
        getProfileDocumentSnapshot().rootPath === targetRootPath;
      const now = new Date().toISOString();
      const createdProfiles: ChromeProfile[] = [];
      try {
        for (const candidate of candidates) {
          if (!shouldCommit()) {
            await rollbackCancelledImport(
              targetRootPath,
              createdProfiles,
              shouldNotifyRollback
            );
            return "not-saved";
          }

          const profileUid = createProfileUid();
          const currentDocument = getProfileDocumentSnapshot();
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
            [...currentDocument.profiles, ...createdProfiles],
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
          await profileApi.importProfileData(
            targetRootPath,
            candidate.path,
            profile.id,
            marker
          );
          createdProfiles.push(profile);
        }

        if (!shouldCommit()) {
          await rollbackCancelledImport(
            targetRootPath,
            createdProfiles,
            shouldNotifyRollback
          );
          return "not-saved";
        }

        const currentDocument = getProfileDocumentSnapshot();
        const nextProfiles = [...currentDocument.profiles, ...createdProfiles];
        const sanitizedSettings = normalizeSettings(currentDocument.settings);
        const existingProfileIds = new Set(nextProfiles.map((profile) => profile.id));
        const sanitizedProjects = currentDocument.projects.map((project) => ({
          ...project,
          profileIds: project.profileIds.filter((profileId) =>
            existingProfileIds.has(profileId)
          )
        }));
        await profileApi.saveProfiles(targetRootPath, {
          version: 1,
          settings: sanitizedSettings,
          profiles: nextProfiles,
          projects: sanitizedProjects
        });

        if (!shouldCommit()) {
          return "saved-stale";
        }

        commitProfileDocumentState(
          nextProfiles,
          sanitizedSettings,
          sanitizedProjects,
          `已批量导入 ${createdProfiles.length} 个账号`
        );
        if (createdProfiles[0]) {
          setEditingId(createdProfiles[0].id);
          setEditingProfileDraft(cloneProfileForDraft(createdProfiles[0]));
        }
        return "saved-committed";
      } catch (error) {
        if (!shouldCommit()) {
          const rollbackFailures = await rollbackCreatedProfiles(
            targetRootPath,
            createdProfiles
          );
          if (shouldNotifyRollback()) {
            const rollbackMessage =
              rollbackFailures.length > 0
                ? `；回滚失败账号：${rollbackFailures.join("、")}`
                : "";
            setMessage(`导入已取消：${errorMessage(error)}${rollbackMessage}`);
          }
          return "not-saved";
        }
        const rollbackFailures = await rollbackCreatedProfiles(
          targetRootPath,
          createdProfiles
        );
        if (rollbackFailures.length === 0) {
          throw error;
        }
        throw new Error(
          `${errorMessage(error)}；回滚失败账号：${rollbackFailures.join("、")}`
        );
      }
    });
  }

  async function rollbackCreatedProfiles(
    targetRootPath: string,
    createdProfiles: ChromeProfile[]
  ): Promise<string[]> {
    const failures: string[] = [];
    for (const profile of createdProfiles) {
      try {
        await profileApi.deleteProfileData(targetRootPath, profile.id);
      } catch {
        failures.push(profile.id);
      }
    }
    return failures;
  }

  async function rollbackCancelledImport(
    targetRootPath: string,
    createdProfiles: ChromeProfile[],
    shouldNotify: () => boolean
  ) {
    const failures = await rollbackCreatedProfiles(
      targetRootPath,
      createdProfiles
    );
    if (failures.length > 0 && shouldNotify()) {
      setMessage(`导入已取消，但回滚失败账号：${failures.join("、")}`);
    }
  }

  function restoreDataSafetyDocument({
    targetRootPath,
    restore
  }: RestoreDataSafetyDocumentInput): Promise<boolean> {
    return enqueueDocumentMutation(async () => {
      if (getProfileDocumentSnapshot().rootPath !== targetRootPath) {
        return false;
      }
      const {
        document,
        settings: restoredSettings,
        rootStatus: status,
        chromeStatus: chrome,
        message: nextMessage
      } = await restore();
      if (getProfileDocumentSnapshot().rootPath !== targetRootPath) {
        return false;
      }
      replaceProfileDocumentState({
        profiles: document.profiles,
        settings: restoredSettings,
        projects: document.projects
      });
      setProfiles(document.profiles);
      setProjects(document.projects);
      setSettings(restoredSettings);
      syncRestoredRoot(status, restoredSettings, chrome);
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
      launchingProfileIdsRef.current.clear();
      projectOpenCancelledRef.current = false;
      setMessage(nextMessage);
      return true;
    });
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

  function recordLaunchResults(
    results: BrowserLaunchResult[],
    profileById: ReadonlyMap<string, ChromeProfile>,
    sourceLabel: string,
    launchUrl: string
  ) {
    if (results.length === 0) {
      return;
    }

    const nextEvents = results.map((result) => {
      const profile = profileById.get(result.profileId);
      return browserLaunchEventFromResult(result, {
        profileName: profile?.name ?? result.profileId,
        sourceLabel,
        url: launchUrl
      });
    });
    const mergedEvents = appendBrowserLaunchEvents(launchEventsRef.current, nextEvents);
    launchEventsRef.current = mergedEvents;
    setLaunchEvents(mergedEvents);
    queueLaunchEventsSave(rootPath, mergedEvents).catch(() => {
      setMessage("最近启动记录保存失败，但不会影响浏览器启动");
    });
  }

  function queueLaunchEventsSave(
    targetRootPath: string,
    events: BrowserLaunchEvent[]
  ): Promise<void> {
    const saveTask = launchEventsSaveQueueRef.current
      .catch(() => undefined)
      .then(() => profileApi.saveBrowserLaunchEvents(targetRootPath, events));
    launchEventsSaveQueueRef.current = saveTask.catch(() => undefined);
    return saveTask;
  }

  async function openProfile(profile: ChromeProfile) {
    if (launchingProfileIdsRef.current.has(profile.id)) {
      setMessage(`${profile.name} 正在启动，请稍等`);
      return;
    }
    if (!canStartBrowserOperationForProfiles([profile])) {
      return;
    }

    const operation = startProfileOpenOperation("账号启动", profile);
    let operationFinished = false;
    launchingProfileIdsRef.current.add(profile.id);

    try {
      const result = await launchChromeProfile(profile, DEFAULT_PROFILE_LAUNCH_URL);
      finishProfileOpenOperation(operation, result);
      operationFinished = true;
      recordLaunchResults(
        [result],
        new Map([[profile.id, profile]]),
        "账号",
        DEFAULT_PROFILE_LAUNCH_URL
      );
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      await updateProfileById(
        profile.id,
        { lastOpenedAt: new Date().toISOString() },
        `已启动 ${profile.name}`
      );
    } catch (error) {
      if (!operationFinished) {
        failProfileOpenOperation(operation, error);
      }
      setMessage(errorMessage(error));
    } finally {
      launchingProfileIdsRef.current.delete(profile.id);
    }
  }

  async function launchChromeProfile(
    profile: ChromeProfile,
    launchUrl: string
  ): Promise<BrowserLaunchResult> {
    if (!chromeStatus?.available) {
      return browserLaunchFailed(
        profile.id,
        new Error("未检测到浏览器，请先设置浏览器路径")
      );
    }

    try {
      const profileDirectory = await runBrowserCommandWithTimeout(
        profileApi.openProfile(rootPath, profile.id, settings.browserPath, launchUrl),
        `${profile.name} 启动`
      );
      const result = browserLaunchSucceeded(profile.id, profileDirectory);
      if (shouldMarkStartingAfterLaunch(result)) {
        markBrowserSessionStarting(profile.id);
        scheduleLaunchConfirmationRefresh(() => {
          void refreshRunningProfiles(rootPath, profiles, { clearOnFailure: false });
        });
      }
      return result;
    } catch (error) {
      return browserLaunchFailed(profile.id, error);
    }
  }

  async function focusProfileWindow(profile: ChromeProfile) {
    try {
      await focusProfileWindowWithTimeout(profile);
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
    if (!canStartBrowserOperationForProfiles([profile])) {
      return;
    }

    const operation = startProfileOpenOperation(`平台 ${platformLabel}`, profile);
    let operationFinished = false;
    try {
      const result = await launchChromeProfile(profile, launchUrl);
      finishProfileOpenOperation(operation, result);
      operationFinished = true;
      recordLaunchResults(
        [result],
        new Map([[profile.id, profile]]),
        `平台 ${platformLabel}`,
        launchUrl
      );
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      await updateProfileById(
        profile.id,
        { lastOpenedAt: new Date().toISOString() },
        `已打开 ${platformLabel}`
      );
    } catch (error) {
      if (!operationFinished) {
        failProfileOpenOperation(operation, error);
      }
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

  function openSettingsDialog() {
    resetRootSettingsDrafts();
    resetRuntimeDiagnostics();
    setSettingsOpen(true);
  }

  function closeSettingsDialog() {
    resetRootSettingsDrafts();
    closeDataSafetyDialogs();
    resetRuntimeDiagnostics();
    setSettingsOpen(false);
  }

  function closeActiveDialog() {
    if (fullRestoreConfirmOpen) {
      cancelFullRestore();
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
      setPendingUrlDeleteCreatedAt(null);
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
      const currentProfile = profiles.find(
        (profile) => profile.id === pendingDelete.profile.id
      );
      if (
        currentProfile &&
        isReplacementCreatedAt(
          pendingDelete.profile.createdAt,
          currentProfile.createdAt
        )
      ) {
        setEditingId(null);
        setEditingProfileDraft(null);
        setPendingDelete(null);
        return;
      }
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

    const currentProfilesById = new Map(
      profiles.map((profile) => [profile.id, profile])
    );
    const activeDeleteProfiles = pendingBatchDelete.filter((profile) => {
      const currentProfile = currentProfilesById.get(profile.id);
      return (
        !currentProfile ||
        !isReplacementCreatedAt(profile.createdAt, currentProfile.createdAt)
      );
    });
    const activeDeleteIds = new Set(
      activeDeleteProfiles.map((profile) => profile.id)
    );
    setBatchDeleteWorking(mode);
    try {
      if (mode === "data") {
        for (const profile of activeDeleteProfiles) {
          await profileApi.deleteProfileData(rootPath, profile.id);
        }
      }

      if (activeDeleteIds.size > 0) {
        const nextProfiles = profiles.filter(
          (profile) => !activeDeleteIds.has(profile.id)
        );
        await persist(
          nextProfiles,
          mode === "data"
            ? `已删除 ${activeDeleteProfiles.length} 个账号和文件夹`
            : `已删除 ${activeDeleteProfiles.length} 个账号记录`
        );
      }
      setProfileSizes((current) => {
        const next = { ...current };
        activeDeleteIds.forEach((profileId) => {
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
    if (!canStartBrowserOperationForProfiles(queuedProfiles)) {
      return;
    }

    const intervalMilliseconds =
      normalizeBulkOpenIntervalSeconds(String(project.intervalSeconds)) * 1000;
    const openedIds = new Set<string>();
    const launchResults: BrowserLaunchResult[] = [];
    const profileNameById = new Map(
      queuedProfiles.map((profile) => [profile.id, profile.name])
    );
    const runningOperation = startProjectOpenOperation(
      `项目 ${project.name}`,
      {
        projectId: project.id,
        projectName: project.name,
        projectUrlIds: launchUrls.map((projectUrl) => projectUrl.id)
      },
      queuedProfiles
    );

    projectOpenCancelledRef.current = false;
    setOpeningProjectId(project.id);
    try {
      for (const [index, profile] of queuedProfiles.entries()) {
        if (projectOpenCancelledRef.current) {
          break;
        }

        setMessage(`正在打开项目 ${project.name} ${index + 1} / ${queuedProfiles.length}`);
        let projectProfileResult: BrowserLaunchResult | null = null;
        for (const projectUrl of launchUrls) {
          const result = await launchChromeProfile(profile, projectUrl.url);
          projectProfileResult = result;
          if (!result.ok) {
            break;
          }
        }
        if (projectProfileResult) {
          launchResults.push(projectProfileResult);
        }
        if (projectProfileResult?.ok) {
          openedIds.add(profile.id);
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
      const launchSummary = summarizeBrowserLaunchQueue(
        launchResults,
        profileNameById,
        queuedProfiles.length,
        stopped
      );
      finishLaunchQueueOperation(runningOperation, launchSummary);
      const finalMessage = formatProjectLaunchQueueMessage(
        launchSummary,
        project.name,
        `${urlCountLabel}${urlLabel}`
      );
      recordLaunchResults(
        launchResults,
        profileById,
        `项目 ${project.name}`,
        launchUrls.length === 1 ? launchUrls[0].url : `${launchUrls.length} 个网址`
      );
      await persist(nextProfiles, finalMessage, nextSettings, nextProjects);
    } finally {
      projectOpenCancelledRef.current = false;
      bulkOpenDelayResolveRef.current = null;
      setOpeningProjectId(null);
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

  function toggleVisibleProfilesSelection() {
    if (hasSelectedProfiles) {
      clearSelection();
      return;
    }

    setSelectedIds(visibleProfiles.map((profile) => profile.id));
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
    setEditingUrlLibraryCreatedAt(item.createdAt);
    setUrlLibraryDraft(createUrlLibraryDraft(item));
    setPendingUrlDeleteId(null);
    setPendingUrlDeleteCreatedAt(null);
    setUrlLibraryEditorOpen(true);
  }

  function startCreatingUrlLibraryItem() {
    setEditingUrlLibraryId(null);
    setEditingUrlLibraryCreatedAt(null);
    setUrlLibraryDraft(createUrlLibraryDraft());
    setPendingUrlDeleteId(null);
    setPendingUrlDeleteCreatedAt(null);
    setUrlLibraryEditorOpen(true);
  }

  function cancelUrlLibraryEdit() {
    setEditingUrlLibraryId(null);
    setEditingUrlLibraryCreatedAt(null);
    setPendingUrlDeleteId(null);
    setPendingUrlDeleteCreatedAt(null);
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
    const editingItem = editingUrlLibraryId
      ? currentLibrary.find((item) => item.id === editingUrlLibraryId) ?? null
      : null;
    if (
      editingItem &&
      isReplacementCreatedAt(editingUrlLibraryCreatedAt, editingItem.createdAt)
    ) {
      setEditingUrlLibraryId(null);
      setEditingUrlLibraryCreatedAt(null);
      setPendingUrlDeleteId(null);
      setPendingUrlDeleteCreatedAt(null);
      setUrlLibraryDraft(createUrlLibraryDraft());
      setUrlLibraryEditorOpen(false);
      return;
    }
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
    setEditingUrlLibraryCreatedAt(null);
    setPendingUrlDeleteId(null);
    setPendingUrlDeleteCreatedAt(null);
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

  function updateBulkUrl(value: string) {
    setBulkUrl(value);
    setLastBulkLaunchRetry(null);
  }

  function fillBulkUrlFromLibrary(url: string) {
    const launchUrl = normalizeLaunchUrl(url);
    if (!launchUrl) {
      setMessage("这条网址为空");
      return;
    }

    updateBulkUrl(launchUrl);
    setActiveView("accounts");
    setMessage("已填入批量打开网址");
  }

  function requestDeleteUrlLibraryItem(itemId: string) {
    const item = (settings.urlLibrary ?? []).find(
      (libraryItem) => libraryItem.id === itemId
    );
    setPendingUrlDeleteId(itemId);
    setPendingUrlDeleteCreatedAt(item?.createdAt ?? null);
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
      setPendingUrlDeleteCreatedAt(null);
      return;
    }
    if (isReplacementCreatedAt(pendingUrlDeleteCreatedAt, item.createdAt)) {
      setPendingUrlDeleteId(null);
      setPendingUrlDeleteCreatedAt(null);
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
      setEditingUrlLibraryCreatedAt(null);
      setUrlLibraryDraft(createUrlLibraryDraft());
    }
    setPendingUrlDeleteId(null);
    setPendingUrlDeleteCreatedAt(null);
  }

  async function inspectWindowsForSelectedProfiles() {
    const freshRunningSelectedProfiles = await refreshSelectedRunningProfiles();

    if (freshRunningSelectedProfiles.length === 0) {
      setMessage("选中的账号没有运行窗口");
      return;
    }
    if (!canStartBrowserOperationForProfiles(freshRunningSelectedProfiles)) {
      return;
    }

    const operation = startWindowOperation("检查窗口", freshRunningSelectedProfiles);
    setWindowInspecting(true);
    try {
      const summaries: string[] = [];
      for (const profile of freshRunningSelectedProfiles) {
        const windows = await listProfileWindowsWithTimeout(profile, "检查窗口");
        summaries.push(formatWindowInspectionSummary(profile.name, windows));
      }
      setMessage(`窗口检查：${summaries.join("；")}`);
      finishWindowOperation(operation, "succeeded", buildInspectWindowOperationSummary({
        profileCount: freshRunningSelectedProfiles.length,
        inspectedCount: summaries.length
      }));
      await refreshRunningProfiles();
    } catch (error) {
      setMessage(windowAutomationErrorMessage(error));
      finishWindowOperation(
        operation,
        "failed",
        buildInspectWindowOperationSummary({
          profileCount: freshRunningSelectedProfiles.length,
          inspectedCount: 0,
          failedCount: freshRunningSelectedProfiles.length,
          reason: "inspect-failed"
        })
      );
      await refreshRunningProfiles();
    } finally {
      setWindowInspecting(false);
    }
  }

  async function focusProfileWindowsInOrder(profilesToFocus: ChromeProfile[]) {
    let focusedCount = 0;
    let failedCount = 0;
    let firstFailedError: unknown = null;

    for (const profile of profilesToFocus) {
      try {
        await focusProfileWindowWithTimeout(profile);
        focusedCount += 1;
      } catch (error) {
        failedCount += 1;
        firstFailedError ??= error;
      }
    }

    return { focusedCount, failedCount, firstFailedError };
  }

  async function focusWindowsForSelectedProfiles() {
    const freshRunningSelectedProfiles = await refreshSelectedRunningProfiles();

    if (freshRunningSelectedProfiles.length === 0) {
      setMessage("选中的账号没有运行窗口");
      return;
    }
    if (!canStartBrowserOperationForProfiles(freshRunningSelectedProfiles)) {
      return;
    }

    const operation = startWindowOperation("前置窗口", freshRunningSelectedProfiles);
    setWindowFocusing(true);
    try {
      const { focusedCount, failedCount, firstFailedError } =
        await focusProfileWindowsInOrder(freshRunningSelectedProfiles);

      if (focusedCount > 0) {
        const messageParts = [`已前置 ${focusedCount} 个窗口`];
        if (failedCount > 0) {
          messageParts.push(`${failedCount} 个失败`);
        }
        setMessage(messageParts.join("，"));
      } else {
        setMessage(
          firstFailedError
            ? windowAutomationErrorMessage(firstFailedError)
            : "选中的账号没有可前置窗口"
        );
      }
      finishWindowOperation(
        operation,
        focusedCount > 0 && failedCount === 0 ? "succeeded" : "failed",
        {
          profileCount: freshRunningSelectedProfiles.length,
          focusedCount,
          failedCount
        }
      );
      await refreshRunningProfiles();
    } finally {
      setWindowFocusing(false);
    }
  }

  async function tileWindowsForSelectedProfiles() {
    const freshRunningSelectedProfiles = await refreshSelectedRunningProfiles();

    if (freshRunningSelectedProfiles.length === 0) {
      setMessage("选中的账号没有运行窗口");
      return;
    }
    if (!canStartBrowserOperationForProfiles(freshRunningSelectedProfiles)) {
      return;
    }

    const operation = startWindowOperation("平铺窗口", freshRunningSelectedProfiles);
    setWindowTiling(true);
    try {
      const registryInputs: BrowserWindowRegistryInput[] = [];
      let failedCount = 0;
      let firstFailedError: unknown = null;

      for (const profile of freshRunningSelectedProfiles) {
        try {
          const windows = await listProfileWindowsWithTimeout(profile, "检查平铺窗口");
          registryInputs.push({
            profileId: profile.id,
            profileName: profile.name,
            windows
          });
        } catch (error) {
          failedCount += 1;
          firstFailedError ??= error;
          registryInputs.push({
            profileId: profile.id,
            profileName: profile.name,
            windows: [],
            windowError: errorMessage(error)
          });
        }
      }

      const windowRegistry = buildPrimaryWindowRegistry(registryInputs);
      const layoutPlan = buildGridWindowLayoutPlan(windowRegistry, {
        x: availableScreenLeft(),
        y: availableScreenTop(),
        width: availableScreenWidth(),
        height: availableScreenHeight()
      });
      const profileById = new Map(
        freshRunningSelectedProfiles.map((profile) => [profile.id, profile])
      );
      const noWindowCount = layoutPlan.skipped.filter(
        (entry) => entry.reason === "missing-window"
      ).length;
      const multiWindowProfileCount = layoutPlan.multiWindowProfileCount;

      if (layoutPlan.tileableCount === 0) {
        setMessage(
          firstFailedError
            ? windowAutomationErrorMessage(firstFailedError)
            : "选中的运行账号没有可平铺窗口"
        );
        finishWindowOperation(
          operation,
          "failed",
          buildTileWindowOperationSummary({
            profileCount: freshRunningSelectedProfiles.length,
            tileableCount: 0,
            noWindowCount,
            failedCount
          })
        );
        await refreshRunningProfiles();
        return;
      }

      if (layoutPlan.capacityExceeded) {
        setMessage(
          `当前屏幕最多适合平铺 ${layoutPlan.capacity} 个窗口；已选运行窗口 ${layoutPlan.tileableCount} 个，请减少选择或分批平铺`
        );
        finishWindowOperation(
          operation,
          "failed",
          buildTileWindowOperationSummary({
            profileCount: freshRunningSelectedProfiles.length,
            tileableCount: layoutPlan.tileableCount,
            noWindowCount,
            capacity: layoutPlan.capacity,
            capacityExceeded: true
          })
        );
        await refreshRunningProfiles();
        return;
      }

      let tiledCount = 0;
      let unchangedCount = 0;
      let focusFailedCount = 0;
      const tiledProfiles: ChromeProfile[] = [];

      for (const placement of layoutPlan.placements) {
        const profile = profileById.get(placement.profileId);
        if (!profile) {
          continue;
        }

        try {
          const targetBounds = placement.bounds;
          await setProfileWindowBoundsWithTimeout(profile, targetBounds, "平铺窗口");
          const updatedWindows = await listProfileWindowsWithTimeout(
            profile,
            "确认平铺窗口"
          );
          if (
            !updatedWindows[0] ||
            !windowMatchesBounds(updatedWindows[0], targetBounds)
          ) {
            unchangedCount += 1;
            continue;
          }
          tiledCount += 1;
          tiledProfiles.push(profile);
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
        const focusResult = await focusProfileWindowsInOrder(tiledProfiles);
        if (focusResult.failedCount > 0) {
          focusFailedCount = focusResult.failedCount;
          messageParts.push(`${focusResult.failedCount} 个未能前置`);
        }
        setMessage(messageParts.join("，"));
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
      finishWindowOperation(
        operation,
        tiledCount > 0 &&
          unchangedCount === 0 &&
          failedCount === 0 &&
          focusFailedCount === 0
          ? "succeeded"
          : "failed",
        buildTileWindowOperationSummary({
          profileCount: freshRunningSelectedProfiles.length,
          tileableCount: layoutPlan.tileableCount,
          tiledCount,
          unchangedCount,
          noWindowCount,
          multiWindowProfileCount,
          failedCount,
          focusFailedCount
        })
      );
      await refreshRunningProfiles();
    } finally {
      setWindowTiling(false);
    }
  }

  async function syncLayoutForSelectedProfiles() {
    const freshRunningSelectedProfiles = await refreshSelectedRunningProfiles();

    if (freshRunningSelectedProfiles.length < 2) {
      setMessage("至少选择 2 个运行账号才能同步布局");
      return;
    }

    const sourceProfile =
      freshRunningSelectedProfiles.find(
        (profile) => profile.id === resolvedLayoutSourceProfileId
      ) ?? freshRunningSelectedProfiles[0];

    if (!sourceProfile) {
      setMessage("请选择一个运行账号作为主账号");
      return;
    }
    if (!canStartBrowserOperationForProfiles(freshRunningSelectedProfiles)) {
      return;
    }

    const operation = startWindowOperation("同步布局", freshRunningSelectedProfiles);
    setWindowSyncing(true);
    try {
      const registryInputs: BrowserWindowRegistryInput[] = [];
      let firstFailedError: unknown = null;

      try {
        const sourceWindows = await listProfileWindowsWithTimeout(
          sourceProfile,
          "读取主窗口"
        );
        registryInputs.push({
          profileId: sourceProfile.id,
          profileName: sourceProfile.name,
          windows: sourceWindows
        });
      } catch (error) {
        registryInputs.push({
          profileId: sourceProfile.id,
          profileName: sourceProfile.name,
          windows: [],
          windowError: errorMessage(error)
        });
      }

      let windowRegistry = buildPrimaryWindowRegistry(registryInputs);
      let syncPlan = buildWindowLayoutSyncPlan(windowRegistry, sourceProfile.id);
      if (syncPlan.sourceStatus === "missing-window") {
        setMessage("主账号没有可同步窗口");
        finishWindowOperation(
          operation,
          "failed",
          buildSyncLayoutWindowOperationSummary({
            profileCount: freshRunningSelectedProfiles.length,
            sourceProfileId: sourceProfile.id,
            reason: "missing-source-window"
          })
        );
        await refreshRunningProfiles();
        return;
      }
      if (syncPlan.sourceStatus === "minimized-window") {
        setMessage("主账号窗口已最小化，请先恢复窗口再同步布局");
        finishWindowOperation(
          operation,
          "failed",
          buildSyncLayoutWindowOperationSummary({
            profileCount: freshRunningSelectedProfiles.length,
            sourceProfileId: sourceProfile.id,
            reason: "minimized-source-window"
          })
        );
        await refreshRunningProfiles();
        return;
      }
      if (syncPlan.sourceStatus === "window-error") {
        setMessage(windowAutomationErrorMessage(syncPlan.sourceWindowError));
        finishWindowOperation(
          operation,
          "failed",
          buildSyncLayoutWindowOperationSummary({
            profileCount: freshRunningSelectedProfiles.length,
            sourceProfileId: sourceProfile.id,
            reason: "source-window-error"
          })
        );
        await refreshRunningProfiles();
        return;
      }

      for (const profile of freshRunningSelectedProfiles) {
        if (profile.id === sourceProfile.id) {
          continue;
        }

        try {
          const windows = await listProfileWindowsWithTimeout(
            profile,
            "检查同步窗口"
          );
          registryInputs.push({
            profileId: profile.id,
            profileName: profile.name,
            windows
          });
        } catch (error) {
          firstFailedError ??= error;
          registryInputs.push({
            profileId: profile.id,
            profileName: profile.name,
            windows: [],
            windowError: errorMessage(error)
          });
        }
      }

      windowRegistry = buildPrimaryWindowRegistry(registryInputs);
      syncPlan = buildWindowLayoutSyncPlan(windowRegistry, sourceProfile.id);

      let syncedCount = 0;
      const noWindowCount = syncPlan.noWindowCount;
      const minimizedCount = syncPlan.minimizedCount;
      let unchangedCount = 0;
      let failedCount = syncPlan.failedCount;
      let focusFailedCount = 0;
      const syncedProfiles: ChromeProfile[] = [];
      const profileById = new Map(
        freshRunningSelectedProfiles.map((profile) => [profile.id, profile])
      );

      for (const placement of syncPlan.placements) {
        const profile = profileById.get(placement.profileId);
        if (!profile) {
          continue;
        }

        try {
          await setProfileWindowBoundsWithTimeout(
            profile,
            placement.bounds,
            "同步布局"
          );
          const updatedWindows = await listProfileWindowsWithTimeout(
            profile,
            "确认同步布局"
          );
          if (
            !updatedWindows[0] ||
            !windowMatchesBounds(updatedWindows[0], placement.bounds)
          ) {
            unchangedCount += 1;
            continue;
          }
          syncedCount += 1;
          syncedProfiles.push(profile);
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
        const focusResult = await focusProfileWindowsInOrder([
          ...syncedProfiles,
          sourceProfile
        ]);
        if (focusResult.failedCount > 0) {
          focusFailedCount = focusResult.failedCount;
          messageParts.push(`${focusResult.failedCount} 个未能前置`);
        }
        setMessage(messageParts.join("，"));
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
      finishWindowOperation(
        operation,
        syncedCount > 0 &&
          unchangedCount === 0 &&
          failedCount === 0 &&
          focusFailedCount === 0
          ? "succeeded"
          : "failed",
        buildSyncLayoutWindowOperationSummary({
          profileCount: freshRunningSelectedProfiles.length,
          sourceProfileId: sourceProfile.id,
          syncedCount,
          noWindowCount,
          minimizedCount,
          unchangedCount,
          failedCount,
          focusFailedCount
        })
      );
      await refreshRunningProfiles();
    } catch (error) {
      setMessage(windowAutomationErrorMessage(error));
      finishWindowOperation(
        operation,
        "failed",
        buildSyncLayoutWindowOperationSummary({
          profileCount: freshRunningSelectedProfiles.length,
          sourceProfileId: sourceProfile.id,
          reason: "sync-layout-error"
        })
      );
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

  async function openUrlForProfiles(
    queuedProfiles: ChromeProfile[],
    rawLaunchUrl: string,
    options: {
      emptyMessage: string;
      sourceLabel: string;
    }
  ) {
    if (queuedProfiles.length === 0) {
      setMessage(options.emptyMessage);
      return;
    }
    if (bulkOpenRunning) {
      setMessage("批量打开正在进行");
      return;
    }
    if (!canStartBrowserOperationForProfiles(queuedProfiles)) {
      return;
    }

    const launchUrl = rawLaunchUrl.trim()
      ? normalizeLaunchUrl(rawLaunchUrl)
      : DEFAULT_PROFILE_LAUNCH_URL;
    if (!chromeStatus?.available) {
      setMessage("未检测到浏览器，请先设置浏览器路径");
      return;
    }

    const intervalMilliseconds =
      normalizeBulkOpenIntervalSeconds(bulkOpenIntervalSeconds) * 1000;
    const queuedProfileIds = queuedProfiles.map((profile) => profile.id);
    const openedIds = new Set<string>();
    const launchResults: BrowserLaunchResult[] = [];
    const profileNameById = new Map(
      queuedProfiles.map((profile) => [profile.id, profile.name])
    );
    const runningOperation = startBulkOpenUrlOperation(
      options.sourceLabel,
      launchUrl,
      queuedProfiles
    );

    bulkOpenCancelledRef.current = false;
    setLastBulkLaunchRetry(null);
    setBulkOpenRunning(true);

    try {
      for (const [index, profile] of queuedProfiles.entries()) {
        if (bulkOpenCancelledRef.current) {
          break;
        }

        setMessage(`正在打开 ${index + 1} / ${queuedProfiles.length}：${profile.name}`);
        const result = await launchChromeProfile(profile, launchUrl);
        launchResults.push(result);
        if (result.ok) {
          openedIds.add(profile.id);
        }

        if (
          index < queuedProfiles.length - 1 &&
          !bulkOpenCancelledRef.current
        ) {
          await waitForBulkOpenInterval(intervalMilliseconds);
        }
      }

      const stopped = bulkOpenCancelledRef.current;
      const launchSummary = summarizeBrowserLaunchQueue(
        launchResults,
        profileNameById,
        queuedProfiles.length,
        stopped
      );
      finishLaunchQueueOperation(runningOperation, launchSummary);
      const finalMessage = formatBulkLaunchQueueMessage(launchSummary);
      const profileById = new Map(
        queuedProfiles.map((profile) => [profile.id, profile])
      );
      recordLaunchResults(launchResults, profileById, options.sourceLabel, launchUrl);
      const retryProfileIds = selectRetryableBrowserLaunchProfileIds(
        launchResults,
        queuedProfileIds
      );
      setLastBulkLaunchRetry(
        retryProfileIds.length > 0
          ? { profileIds: retryProfileIds, url: launchUrl }
          : null
      );

      if (launchSummary.successCount > 0) {
        const now = new Date().toISOString();
        const nextProfiles = profiles.map((profile) =>
          openedIds.has(profile.id)
            ? updateProfile(profile, { lastOpenedAt: now }, now)
            : profile
        );
        const nextSettings = normalizeSettings({
          ...settings,
          recentUrls:
            launchUrl === DEFAULT_PROFILE_LAUNCH_URL
              ? settings.recentUrls
              : [launchUrl, ...settings.recentUrls]
        });
        await persist(nextProfiles, finalMessage, nextSettings);
        return;
      }

      setMessage(finalMessage);
    } finally {
      bulkOpenCancelledRef.current = false;
      bulkOpenDelayResolveRef.current = null;
      setBulkOpenRunning(false);
    }
  }

  async function openUrlForSelectedProfiles(urlOverride?: string) {
    await openUrlForProfiles([...selectedProfiles], urlOverride ?? bulkUrl, {
      emptyMessage: "请先选择账号",
      sourceLabel: "批量打开"
    });
  }

  async function retryFailedBulkLaunch() {
    if (!lastBulkLaunchRetry || lastBulkLaunchRetry.profileIds.length === 0) {
      setMessage("没有可重试的失败账号");
      return;
    }

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const retryProfiles = lastBulkLaunchRetry.profileIds
      .map((profileId) => profileById.get(profileId))
      .filter((profile): profile is ChromeProfile => Boolean(profile));

    if (retryProfiles.length === 0) {
      setLastBulkLaunchRetry(null);
      setMessage("没有可重试的失败账号");
      return;
    }

    await openUrlForProfiles(retryProfiles, lastBulkLaunchRetry.url, {
      emptyMessage: "没有可重试的失败账号",
      sourceLabel: "重试失败"
    });
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
          setEditingUrlLibraryCreatedAt(null);
          setUrlLibraryDraft(createUrlLibraryDraft());
          setUrlLibraryEditorOpen(false);
          setPendingUrlDeleteId(null);
          setPendingUrlDeleteCreatedAt(null);
          setPendingDelete(null);
        }}
        onOpenSettings={openSettingsDialog}
      />

      <main className={`main-area ${cardDensity === "compact" ? "compact-density" : ""}`}>
        {activeView === "accounts" ? (
          <>
        <section className="launcher-header">
          <div className="search-box launcher-search">
            <Search size={16} />
            <input
              aria-label="搜索账号"
              placeholder="搜索名称、标签、备注"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
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
              onClick={toggleImportPanel}
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
          <div className="toolbar-controls" role="group" aria-label="选择操作">
            <button
              className="secondary-button compact"
              type="button"
              disabled={visibleProfiles.length === 0 && !hasSelectedProfiles}
              aria-pressed={hasSelectedProfiles}
              onClick={toggleVisibleProfilesSelection}
            >
              {hasSelectedProfiles ? "取消选择" : "全选当前"}
            </button>
            <span className="profile-count">{totalProfiles} 个账号</span>
          </div>
        </section>

        <BulkActionBar
          selection={{
            selectedCount: selectedProfiles.length,
            selectedProfiles,
            onRequestDelete: requestDeleteSelectedProfiles,
            onClear: clearSelection
          }}
          urlQueue={{
            bulkUrl,
            bulkOpenIntervalSeconds,
            bulkOpenRunning,
            retryFailureCount: lastBulkLaunchRetry?.profileIds.length ?? 0,
            favoriteUrls: settings.favoriteUrls,
            recentUrls: settings.recentUrls,
            onBulkUrlChange: updateBulkUrl,
            onBulkOpenIntervalChange: setBulkOpenIntervalSeconds,
            onAddFavoriteUrl: () => void addFavoriteUrl(),
            onRemoveFavoriteUrl: (url) => void removeFavoriteUrl(url),
            onOpenUrl: () => void openUrlForSelectedProfiles(),
            onRetryFailures: () => void retryFailedBulkLaunch(),
            onStopOpenQueue: stopBulkOpenQueue
          }}
          tagging={{
            bulkTag,
            onBulkTagChange: setBulkTag,
            onAppendTags: () => void appendBulkTags()
          }}
          windowActions={{
            windowInspecting,
            windowTiling,
            windowSyncing,
            windowFocusing,
            runningProfileIds,
            layoutSourceProfileId: resolvedLayoutSourceProfileId,
            onLayoutSourceProfileChange: setLayoutSourceProfileId,
            onInspectWindows: () => void inspectWindowsForSelectedProfiles(),
            onTileWindows: () => void tileWindowsForSelectedProfiles(),
            onSyncLayout: () => void syncLayoutForSelectedProfiles(),
            onFocusWindows: () => void focusWindowsForSelectedProfiles()
          }}
          activity={{
            browserOperations,
            launchEvents
          }}
        />

        {showImport ? (
          <section className="import-strip">
            <div className="path-input">
              <FolderOpen size={16} />
              <input
                aria-label="导入来源目录"
                placeholder="粘贴旧 MultiChrome 根目录、profiles 目录或整理好的来源目录"
                value={importPath}
                onChange={(event) => onImportPathChange(event.target.value)}
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
                    onClick={clearImportPreview}
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
                sessionStatus={profileSessionStatus(
                  browserSessionsById[profile.id],
                  runningProfileIds.includes(profile.id)
                )}
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
          onCancel={() => {
            setPendingUrlDeleteId(null);
            setPendingUrlDeleteCreatedAt(null);
          }}
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
          rootSettings={rootSettings}
          health={health}
          lightBackup={lightBackup}
          fullBackup={fullBackup}
          runtimeDiagnostics={runtimeDiagnostics}
          onClose={closeSettingsDialog}
        />
      ) : null}

      {fullRestoreConfirmOpen && fullRestorePreview ? (
        <FullRestoreConfirmDialog
          preview={fullRestorePreview}
          working={fullBackupWorking === "restore"}
          onCancel={cancelFullRestore}
          onConfirm={confirmFullRestore}
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

function createProfileUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export { nextSequentialId };

export default App;

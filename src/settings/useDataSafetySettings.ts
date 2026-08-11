import { useRef, useState } from "react";
import { normalizeSettings, profileApi, type ChromeStatus, type RootStatus } from "../api";
import { defaultAccentColor } from "../domain/profileModel";
import { errorMessage } from "../shared/windowAutomationErrors";
import type {
  ChromeProfile,
  FullProfileBackupPreview,
  FullProfileBackupResult,
  FullProfileRestorePreview,
  ProfileBackupResult,
  ProfileDocument,
  ProfileSettings,
  RootHealthReport,
  RootRepairResult
} from "../types";
import type {
  FullBackupScope,
  FullBackupWorking,
  SettingsDialogFullBackupProps,
  SettingsDialogHealthProps,
  SettingsDialogLightBackupProps
} from "./SettingsDialog";

interface RestoredDocumentResult {
  document: ProfileDocument;
  settings: ProfileSettings;
  rootStatus: RootStatus;
  chromeStatus: ChromeStatus;
  message: string;
}

interface RestoreDocumentInput {
  targetRootPath: string;
  restore: () => Promise<RestoredDocumentResult>;
}

interface UseDataSafetySettingsOptions {
  rootPath: string;
  profiles: ChromeProfile[];
  selectedProfileIds: string[];
  onPersistProfiles: (nextProfiles: ChromeProfile[], message: string) => Promise<void>;
  onRestoreDocument: (input: RestoreDocumentInput) => Promise<boolean>;
  onMessage: (message: string) => void;
}

export function useDataSafetySettings({
  rootPath,
  profiles,
  selectedProfileIds,
  onPersistProfiles,
  onRestoreDocument,
  onMessage
}: UseDataSafetySettingsOptions) {
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
  const [fullBackupPreview, setFullBackupPreview] = useState<FullProfileBackupPreview | null>(null);
  const [fullBackupResult, setFullBackupResult] = useState<FullProfileBackupResult | null>(null);
  const [fullBackupPathDraft, setFullBackupPathDraft] = useState("");
  const [fullRestorePreview, setFullRestorePreview] =
    useState<FullProfileRestorePreview | null>(null);
  const [fullBackupWorking, setFullBackupWorking] = useState<FullBackupWorking | null>(null);
  const [fullRestoreConfirmOpen, setFullRestoreConfirmOpen] = useState(false);
  const restoreInFlightRef = useRef(false);
  const dataSafetyGenerationRef = useRef(0);
  const currentRootPathRef = useRef(rootPath);
  currentRootPathRef.current = rootPath;

  function resetDataSafetyState() {
    dataSafetyGenerationRef.current += 1;
    setHealthReport(null);
    setHealthChecking(false);
    setHealthRepairing(false);
    setOrphanRegisteringId(null);
    setRepairResult(null);
    setBackupResult(null);
    setRestoreConfirmOpen(false);
    setFullBackupScope("all");
    setFullBackupPreview(null);
    setFullBackupResult(null);
    setFullBackupPathDraft("");
    setFullRestorePreview(null);
    setFullBackupWorking(null);
    setFullRestoreConfirmOpen(false);
  }

  function isCurrentDataSafetyRequest(requestRootPath: string, requestGeneration: number) {
    return (
      currentRootPathRef.current === requestRootPath &&
      dataSafetyGenerationRef.current === requestGeneration
    );
  }

  function closeDataSafetyDialogs() {
    setRestoreConfirmOpen(false);
    setFullRestoreConfirmOpen(false);
  }

  function clearLightBackupRestoreState() {
    setHealthReport(null);
    setRepairResult(null);
    setBackupResult(null);
    setRestoreConfirmOpen(false);
  }

  function clearFullBackupRestoreState() {
    setHealthReport(null);
    setRepairResult(null);
    setFullRestorePreview(null);
    setFullRestoreConfirmOpen(false);
  }

  function beginRestoreOperation() {
    if (restoreInFlightRef.current) {
      onMessage("恢复正在进行，请稍候");
      return false;
    }
    restoreInFlightRef.current = true;
    return true;
  }

  function finishRestoreOperation() {
    restoreInFlightRef.current = false;
  }

  async function readRestoredEnvironment(
    targetRootPath: string,
    settings: ProfileSettings,
    profileCount: number,
    successMessage: string
  ) {
    let message = successMessage;
    let rootStatus: RootStatus = {
      rootExists: true,
      writable: false,
      profileCount
    };
    let chromeStatus: ChromeStatus = {
      available: false,
      appPath: null
    };

    try {
      rootStatus = await profileApi.initProfileRoot(targetRootPath);
    } catch (error) {
      message = `${message}；${errorMessage(error)}`;
    }
    try {
      chromeStatus = await profileApi.detectChrome(settings.browserPath);
    } catch (error) {
      message = `${message}；${errorMessage(error)}`;
    }

    return { rootStatus, chromeStatus, message };
  }

  async function runRootHealthCheck() {
    if (!rootPath.trim()) {
      onMessage("请先填写配置根目录");
      return;
    }

    const requestRootPath = rootPath;
    const requestGeneration = dataSafetyGenerationRef.current;
    setHealthChecking(true);
    try {
      const report = await profileApi.checkProfileRootHealth(requestRootPath);
      if (!isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        return;
      }
      setHealthReport(report);
      setRepairResult(null);
      const { errorCount, warningCount } = report.summary;
      if (errorCount > 0) {
        onMessage(`健康检查发现 ${errorCount} 个错误`);
      } else if (warningCount > 0) {
        onMessage(`健康检查发现 ${warningCount} 个提醒`);
      } else {
        onMessage("目录健康检查通过");
      }
    } catch (error) {
      if (!isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        return;
      }
      onMessage(errorMessage(error));
    } finally {
      if (isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        setHealthChecking(false);
      }
    }
  }

  async function repairRootHealth() {
    if (!rootPath.trim()) {
      onMessage("请先填写配置根目录");
      return;
    }

    const requestRootPath = rootPath;
    const requestGeneration = dataSafetyGenerationRef.current;
    setHealthRepairing(true);
    try {
      const result = await profileApi.repairProfileRootHealth(requestRootPath);
      if (!isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        return;
      }
      setRepairResult(result);
      setHealthReport(result.health);
      onMessage(
        result.repairedCount > 0
          ? `已修复 ${result.repairedCount} 个问题`
          : "没有可自动修复的问题"
      );
    } catch (error) {
      if (!isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        return;
      }
      onMessage(errorMessage(error));
    } finally {
      if (isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        setHealthRepairing(false);
      }
    }
  }

  async function registerOrphanProfile(profileId: string) {
    if (!rootPath.trim()) {
      onMessage("请先填写配置根目录");
      return;
    }
    if (profiles.some((profile) => profile.id === profileId)) {
      onMessage(`${profileId} 已经登记`);
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

    const requestRootPath = rootPath;
    const requestGeneration = dataSafetyGenerationRef.current;
    setOrphanRegisteringId(profileId);
    try {
      await onPersistProfiles([...profiles, profile], `已登记 ${profileId}`);
      if (!isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        return;
      }
      const report = await profileApi.checkProfileRootHealth(requestRootPath);
      if (!isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        return;
      }
      setHealthReport(report);
      setRepairResult(null);
    } catch (error) {
      if (!isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        return;
      }
      onMessage(errorMessage(error));
    } finally {
      if (isCurrentDataSafetyRequest(requestRootPath, requestGeneration)) {
        setOrphanRegisteringId(null);
      }
    }
  }

  async function createBackup() {
    if (!rootPath.trim()) {
      onMessage("请先填写配置根目录");
      return;
    }

    setBackupWorking("create");
    try {
      const backup = await profileApi.createProfilesBackup(rootPath);
      setBackupResult(backup);
      setBackupPathDraft(backup.path);
      setRestoreConfirmOpen(false);
      onMessage(`已创建备份：${backup.profileCount} 个账号`);
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setBackupWorking(null);
    }
  }

  function requestRestoreBackup() {
    if (!backupPathDraft.trim()) {
      onMessage("请先填写备份文件路径");
      return;
    }

    setRestoreConfirmOpen(true);
  }

  async function restoreBackup() {
    if (!beginRestoreOperation()) {
      return;
    }
    const backupPath = backupPathDraft.trim();
    setBackupWorking("restore");
    try {
      const restored = await onRestoreDocument({
        targetRootPath: rootPath,
        restore: async () => {
          const document = await profileApi.restoreProfilesBackup(rootPath, backupPath);
          const settings = normalizeSettings(document.settings);
          const environment = await readRestoredEnvironment(
            rootPath,
            settings,
            document.profiles.length,
            `已从备份恢复 ${document.profiles.length} 个账号`
          );
          return {
            document,
            settings,
            ...environment
          };
        }
      });
      if (restored) {
        clearLightBackupRestoreState();
      }
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setBackupWorking(null);
      finishRestoreOperation();
    }
  }

  function selectedFullBackupProfileIds() {
    return fullBackupScope === "all" ? [] : selectedProfileIds;
  }

  function updateFullBackupScope(scope: FullBackupScope) {
    setFullBackupScope(scope);
    setFullBackupPreview(null);
    setFullBackupResult(null);
  }

  async function previewFullBackup() {
    if (!rootPath.trim()) {
      onMessage("请先填写配置根目录");
      return;
    }
    if (fullBackupScope === "selected" && selectedProfileIds.length === 0) {
      onMessage("请先选择要完整备份的账号");
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
      onMessage(`已预览完整备份：${preview.profileCount} 个账号`);
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setFullBackupWorking(null);
    }
  }

  async function createFullBackup() {
    if (!rootPath.trim()) {
      onMessage("请先填写配置根目录");
      return;
    }
    if (fullBackupScope === "selected" && selectedProfileIds.length === 0) {
      onMessage("请先选择要完整备份的账号");
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
      onMessage(`完整备份已创建：${backup.profileCount} 个账号`);
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setFullBackupWorking(null);
    }
  }

  async function previewFullRestore() {
    const backupPath = fullBackupPathDraft.trim();
    if (!backupPath) {
      onMessage("请先填写完整备份目录路径");
      return;
    }

    setFullBackupWorking("restore-preview");
    setFullRestorePreview(null);
    setFullRestoreConfirmOpen(false);
    try {
      const preview = await profileApi.previewFullProfileRestore(rootPath, backupPath);
      setFullRestorePreview(preview);
      onMessage(`已扫描完整备份：${preview.profileCount} 个账号`);
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setFullBackupWorking(null);
    }
  }

  function requestFullRestore() {
    if (!fullRestorePreview) {
      onMessage("请先扫描完整备份");
      return;
    }

    setFullRestoreConfirmOpen(true);
  }

  async function restoreFullBackup() {
    if (!fullRestorePreview) {
      return;
    }
    if (!beginRestoreOperation()) {
      return;
    }

    setFullBackupWorking("restore");
    try {
      const restorePath = fullRestorePreview.path;
      const restored = await onRestoreDocument({
        targetRootPath: rootPath,
        restore: async () => {
          const document = await profileApi.restoreFullProfileBackup(
            rootPath,
            restorePath,
            true
          );
          const settings = normalizeSettings(document.settings);
          const environment = await readRestoredEnvironment(
            rootPath,
            settings,
            document.profiles.length,
            `完整备份已恢复：${document.profiles.length} 个账号`
          );
          return {
            document,
            settings,
            ...environment
          };
        }
      });
      if (restored) {
        clearFullBackupRestoreState();
      }
    } catch (error) {
      onMessage(errorMessage(error));
    } finally {
      setFullBackupWorking(null);
      finishRestoreOperation();
    }
  }

  const health: SettingsDialogHealthProps = {
    healthReport,
    healthChecking,
    healthRepairing,
    orphanRegisteringId,
    repairResult,
    onHealthCheck: runRootHealthCheck,
    onRepairHealth: repairRootHealth,
    onRegisterOrphanProfile: registerOrphanProfile
  };
  const lightBackup: SettingsDialogLightBackupProps = {
    backupResult,
    backupPathDraft,
    backupWorking,
    restoreConfirmOpen,
    onCreateBackup: createBackup,
    onRequestRestoreBackup: requestRestoreBackup,
    onConfirmRestoreBackup: restoreBackup,
    onCancelRestoreBackup: () => setRestoreConfirmOpen(false),
    onBackupPathChange: setBackupPathDraft
  };
  const fullBackup: SettingsDialogFullBackupProps = {
    fullBackupScope,
    fullBackupPreview,
    fullBackupResult,
    fullBackupPathDraft,
    fullRestorePreview,
    fullBackupWorking,
    selectedProfileCount: selectedProfileIds.length,
    onFullBackupScopeChange: updateFullBackupScope,
    onPreviewFullBackup: previewFullBackup,
    onCreateFullBackup: createFullBackup,
    onPreviewFullRestore: previewFullRestore,
    onRequestFullRestore: requestFullRestore,
    onFullBackupPathChange: (value) => {
      setFullBackupPathDraft(value);
      setFullRestorePreview(null);
      setFullRestoreConfirmOpen(false);
    }
  };

  return {
    health,
    lightBackup,
    fullBackup,
    fullRestoreConfirmOpen,
    fullRestorePreview,
    fullBackupWorking,
    cancelFullRestore: () => setFullRestoreConfirmOpen(false),
    confirmFullRestore: restoreFullBackup,
    resetDataSafetyState,
    closeDataSafetyDialogs
  };
}

import {
  Download,
  FolderOpen,
  Moon,
  ShieldCheck,
  Sun,
  Upload,
  Wrench,
  X
} from "lucide-react";
import {
  formatBytes,
  type BrowserRuntimeNavigationResult,
  type BrowserRuntimeTabSnapshot,
  type BrowserSessionSnapshot,
  type ChromeStatus,
  type RootStatus
} from "../api";
import { HealthReportPanel } from "../data-safety/HealthReportPanel";
import { RepairResultPanel } from "../data-safety/RepairResultPanel";
import type {
  AppTheme,
  FullProfileBackupPreview,
  FullProfileBackupResult,
  FullProfileRestorePreview,
  ProfileBackupResult,
  RootHealthReport,
  RootRepairResult
} from "../types";

export type FullBackupScope = "all" | "selected";
export type FullBackupWorking = "preview" | "create" | "restore-preview" | "restore";
export type RuntimeDiagnosticsStatus = "idle" | "loading" | "succeeded" | "failed";

export interface RuntimeDiagnosticsProps {
  enabled: boolean;
  selectedProfileCount: number;
  selectedProfileName: string | null;
  session: BrowserSessionSnapshot | null;
  status: RuntimeDiagnosticsStatus;
  tabs: BrowserRuntimeTabSnapshot[];
  error: string | null;
  navigationConfirmationMessage?: string | null;
  onReadTabs: () => Promise<void> | void;
  navigateUrl: string;
  navigateStatus: RuntimeDiagnosticsStatus;
  navigateResult: BrowserRuntimeNavigationResult | null;
  navigateError: string | null;
  onNavigateUrlChange: (value: string) => void;
  onNavigate: () => Promise<void> | void;
}

export interface SettingsDialogProps {
  rootPathDraft: string;
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
  runtimeDiagnostics?: RuntimeDiagnosticsProps;
  onRootPathChange: (value: string) => void;
  onBrowserPathChange: (value: string) => void;
  onThemeChange: (value: AppTheme) => void;
  onApplyRootPath: () => Promise<void> | void;
  onSaveSettings: () => Promise<void> | void;
  onHealthCheck: () => Promise<void> | void;
  onRepairHealth: () => Promise<void> | void;
  onRegisterOrphanProfile: (profileId: string) => Promise<void> | void;
  onCreateBackup: () => Promise<void> | void;
  onRequestRestoreBackup: () => void;
  onConfirmRestoreBackup: () => Promise<void> | void;
  onCancelRestoreBackup: () => void;
  onFullBackupScopeChange: (scope: FullBackupScope) => void;
  onPreviewFullBackup: () => Promise<void> | void;
  onCreateFullBackup: () => Promise<void> | void;
  onPreviewFullRestore: () => Promise<void> | void;
  onRequestFullRestore: () => void;
  onRevealRootDirectory: () => Promise<void> | void;
  onRevealBackupsDirectory: () => Promise<void> | void;
  onBackupPathChange: (value: string) => void;
  onFullBackupPathChange: (value: string) => void;
  onClose: () => void;
}

export function SettingsDialog({
  rootPathDraft,
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
  runtimeDiagnostics,
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
  const rootStatusDetail = rootStatus
    ? rootStatus.writable
      ? `配置根目录可写，当前索引里有 ${rootStatus.profileCount} 个账号。`
      : rootStatus.rootExists
        ? "配置根目录已检测到，但当前不可写，请检查磁盘或权限。"
        : "配置根目录尚未确认存在，请点击检测。"
    : "尚未检测配置根目录，请先点击检测。";
  const chromeStatusDetail = chromeStatus
    ? chromeStatus.available
      ? `已检测到 Chrome：${chromeStatus.appPath}`
      : "未检测到可用 Chrome，请确认路径指向 .app。"
    : "尚未检测 Chrome 路径，请先点击检测。";
  const healthStatusDetail = healthReport
    ? healthReport.summary.errorCount > 0
      ? `检查结果有 ${healthReport.summary.errorCount} 个错误和 ${healthReport.summary.warningCount} 个提醒，建议先处理错误。`
      : healthReport.summary.warningCount > 0
        ? `检查结果有 ${healthReport.summary.warningCount} 个提醒，建议处理后再做备份。`
        : "检查通过，当前没有发现目录与索引不一致。"
    : "尚未运行健康检查。";
  const diagnosticsDisabledReason =
    runtimeDiagnostics?.selectedProfileCount === 0
      ? "请选择 1 个账号。"
      : runtimeDiagnostics && runtimeDiagnostics.selectedProfileCount > 1
        ? "仅支持单选账号。"
        : null;
  const diagnosticsCanRead =
    Boolean(runtimeDiagnostics?.enabled) &&
    runtimeDiagnostics?.selectedProfileCount === 1 &&
    runtimeDiagnostics.status !== "loading" &&
    runtimeDiagnostics.navigateStatus !== "loading";
  const diagnosticsCanNavigate =
    Boolean(runtimeDiagnostics?.enabled) &&
    runtimeDiagnostics?.selectedProfileCount === 1 &&
    runtimeDiagnostics.status !== "loading" &&
    runtimeDiagnostics.navigateStatus !== "loading" &&
    Boolean(runtimeDiagnostics.navigateUrl.trim());

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
              value={rootPathDraft}
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
          <div className="settings-status-item">
            <span className={`status-badge ${rootStatus?.writable ? "active" : "needs_check"}`}>
              {rootStatus?.writable ? "根目录正常" : "根目录待检测"}
            </span>
            <p className="settings-status-detail">{rootStatusDetail}</p>
          </div>
          <div className="settings-status-item">
            <span className={`status-badge ${chromeStatus?.available ? "active" : "needs_check"}`}>
              {chromeStatus?.available ? "浏览器正常" : "浏览器待检测"}
            </span>
            <p className="settings-status-detail">{chromeStatusDetail}</p>
          </div>
        </div>

        <div className="settings-health">
          <div className="settings-health-header">
            <div>
              <strong>目录健康</strong>
              <p>先检查，再按结果修复低风险项或手动登记孤儿目录。</p>
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
          <p className="settings-section-note">{healthStatusDetail}</p>
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
              <p>轻量备份只保存 profiles.json 里的账号索引、项目、网址库和设置。</p>
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
          <p className="settings-section-note">
            不会备份 profiles/ 下的 Chrome profile 文件夹。
          </p>
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
                <p>
                  这会替换当前 profiles.json 索引与设置；已有 Chrome profile 文件夹不会被删除。
                </p>
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

          <div className="settings-step-list" aria-label="完整备份和恢复步骤">
            <span>1. 预览本次范围</span>
            <span>2. 创建完整备份</span>
            <span>3. 扫描恢复目录</span>
            <span>4. 确认恢复</span>
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

        {runtimeDiagnostics?.enabled ? (
          <details className="settings-backup runtime-diagnostics-section">
            <summary>开发诊断</summary>
            <div className="settings-health-header">
              <div>
                <strong>{runtimeDiagnostics.selectedProfileName ?? "未选中账号"}</strong>
                <p>仅用于开发诊断；导航目标固定为第一个 page 标签页。</p>
              </div>
              <button
                className="secondary-button compact"
                type="button"
                disabled={!diagnosticsCanRead}
                onClick={() => void runtimeDiagnostics.onReadTabs()}
              >
                {runtimeDiagnostics.status === "loading" ? "读取中" : "读取标签页"}
              </button>
            </div>
            {diagnosticsDisabledReason ? (
              <p className="settings-section-note">{diagnosticsDisabledReason}</p>
            ) : (
              <div className="backup-summary-row">
                <span>CDP：{runtimeDiagnostics.session?.cdpStatus ?? "unknown"}</span>
                <span>
                  调试端口：{runtimeDiagnostics.session?.debugPort ?? "未发现"}
                </span>
              </div>
            )}
            <div className="field">
              <label htmlFor="runtime-navigation-url">导航 URL</label>
              <div className="path-row">
                <input
                  id="runtime-navigation-url"
                  type="url"
                  placeholder="https://example.com"
                  value={runtimeDiagnostics.navigateUrl}
                  disabled={
                    runtimeDiagnostics.selectedProfileCount !== 1 ||
                    runtimeDiagnostics.status === "loading" ||
                    runtimeDiagnostics.navigateStatus === "loading"
                  }
                  onChange={(event) =>
                    runtimeDiagnostics.onNavigateUrlChange(event.target.value)
                  }
                />
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={!diagnosticsCanNavigate}
                  onClick={() => void runtimeDiagnostics.onNavigate()}
                >
                  {runtimeDiagnostics.navigateStatus === "loading"
                    ? "导航中"
                    : "导航标签页"}
                </button>
              </div>
              <p className="settings-section-note">
                将导航该账号的第一个 page 标签页。
              </p>
            </div>
            {runtimeDiagnostics.navigateStatus === "failed" &&
            runtimeDiagnostics.navigateError ? (
              <p className="health-empty">{runtimeDiagnostics.navigateError}</p>
            ) : null}
            {runtimeDiagnostics.navigateStatus === "succeeded" &&
            runtimeDiagnostics.navigateResult ? (
              <p className="health-state-line success">
                已导航第一个 page 标签页：{runtimeDiagnostics.navigateResult.url}
              </p>
            ) : null}
            {runtimeDiagnostics.navigationConfirmationMessage ? (
              <p className="health-empty">
                {runtimeDiagnostics.navigationConfirmationMessage}
              </p>
            ) : null}
            {runtimeDiagnostics.status === "failed" && runtimeDiagnostics.error ? (
              <p className="health-empty">{runtimeDiagnostics.error}</p>
            ) : null}
            {runtimeDiagnostics.status === "succeeded" ? (
              <div className="backup-result">
                <div className="backup-summary-row">
                  <span>{runtimeDiagnostics.tabs.length} 个标签页</span>
                </div>
                {runtimeDiagnostics.tabs.length > 0 ? (
                  <ul className="health-issue-list" aria-label="Runtime 标签页">
                    {runtimeDiagnostics.tabs.map((tab) => (
                      <li key={tab.targetId}>
                        <strong>{tab.title || "未命名标签页"}</strong>
                        <code>{tab.url}</code>
                        <span>target {shortTargetId(tab.targetId)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="health-empty">没有可展示的标签页。</p>
                )}
              </div>
            ) : null}
          </details>
        ) : null}

        <div className="modal-footer">
          <button className="primary-button" type="button" onClick={onSaveSettings}>
            保存设置
          </button>
        </div>
      </section>
    </div>
  );
}

function shortTargetId(targetId: string): string {
  return targetId.slice(0, 8);
}

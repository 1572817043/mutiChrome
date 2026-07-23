import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  FullProfileBackupPreview,
  FullProfileBackupResult,
  FullProfileRestorePreview,
  ProfileBackupResult,
  RootHealthReport,
  RootRepairResult
} from "../types";
import { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog";

const healthReport: RootHealthReport = {
  rootPath: "/tmp/multichrome",
  summary: {
    profileCount: 2,
    warningCount: 1,
    errorCount: 0
  },
  issues: [
    {
      severity: "warning",
      code: "orphan_profile_dir",
      title: "未登记 Profile 目录",
      detail: "发现未登记目录",
      path: "/tmp/multichrome/profiles/account-099",
      profileId: "account-099"
    }
  ]
};

const repairResult: RootRepairResult = {
  repairedCount: 0,
  actions: [],
  health: healthReport
};

const backupResult: ProfileBackupResult = {
  path: "/tmp/multichrome/app-data/backups/profiles.json",
  profileCount: 2
};

const fullBackupPreview: FullProfileBackupPreview = {
  destinationDir: "/tmp/full-backup-next",
  profileCount: 2,
  profileIds: ["account-001", "account-002"],
  totalBytes: 2048
};

const fullBackupResult: FullProfileBackupResult = {
  path: "/tmp/full-backup-done",
  profileCount: 2,
  profileIds: ["account-001", "account-002"],
  totalBytes: 4096
};

const fullRestorePreview: FullProfileRestorePreview = {
  path: "/tmp/full-backup-done",
  profileCount: 2,
  profileIds: ["account-001", "account-002"],
  newProfileIds: ["account-002"],
  overwriteProfileIds: ["account-001"],
  totalBytes: 4096
};

function renderSettingsDialog(overrides: Partial<SettingsDialogProps> = {}) {
  const props: SettingsDialogProps = {
    rootPath: "/tmp/multichrome",
    rootStatus: { rootExists: true, writable: true, profileCount: 2 },
    chromeStatus: { available: true, appPath: "/Applications/Google Chrome.app" },
    healthReport,
    healthChecking: false,
    healthRepairing: false,
    orphanRegisteringId: null,
    repairResult,
    backupResult,
    backupPathDraft: "/tmp/backup.json",
    backupWorking: null,
    restoreConfirmOpen: true,
    fullBackupScope: "all",
    fullBackupPreview,
    fullBackupResult,
    fullBackupPathDraft: "/tmp/full-backup-done",
    fullRestorePreview,
    fullBackupWorking: null,
    selectedProfileCount: 1,
    browserPathDraft: "/Applications/Google Chrome.app",
    themeDraft: "light",
    onRootPathChange: vi.fn(),
    onBrowserPathChange: vi.fn(),
    onThemeChange: vi.fn(),
    onApplyRootPath: vi.fn(),
    onSaveSettings: vi.fn(),
    onHealthCheck: vi.fn(),
    onRepairHealth: vi.fn(),
    onRegisterOrphanProfile: vi.fn(),
    onCreateBackup: vi.fn(),
    onRequestRestoreBackup: vi.fn(),
    onConfirmRestoreBackup: vi.fn(),
    onCancelRestoreBackup: vi.fn(),
    onFullBackupScopeChange: vi.fn(),
    onPreviewFullBackup: vi.fn(),
    onCreateFullBackup: vi.fn(),
    onPreviewFullRestore: vi.fn(),
    onRequestFullRestore: vi.fn(),
    onRevealRootDirectory: vi.fn(),
    onRevealBackupsDirectory: vi.fn(),
    onBackupPathChange: vi.fn(),
    onFullBackupPathChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };

  render(<SettingsDialog {...props} />);
  return props;
}

describe("设置弹窗", () => {
  test("保留根目录、浏览器路径、主题和遮罩关闭交互", () => {
    const props = renderSettingsDialog();

    fireEvent.change(screen.getByLabelText("配置根目录"), {
      target: { value: "/tmp/next-root" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "检测" })[0]);
    fireEvent.change(screen.getByLabelText("Chrome 路径"), {
      target: { value: "/Applications/Chrome Canary.app" }
    });
    fireEvent.click(screen.getByRole("button", { name: "夜晚" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement, {
      target: screen.getByRole("dialog").parentElement
    });

    expect(props.onRootPathChange).toHaveBeenCalledWith("/tmp/next-root");
    expect(props.onApplyRootPath).toHaveBeenCalledTimes(1);
    expect(props.onBrowserPathChange).toHaveBeenCalledWith("/Applications/Chrome Canary.app");
    expect(props.onThemeChange).toHaveBeenCalledWith("dark");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("配置根目录可写，当前索引里有 2 个账号。")).toBeTruthy();
    expect(screen.getByText("已检测到 Chrome：/Applications/Google Chrome.app")).toBeTruthy();
  });

  test("保留健康检查、修复和孤儿目录登记入口", () => {
    const props = renderSettingsDialog();

    fireEvent.click(screen.getByRole("button", { name: "健康检查" }));
    fireEvent.click(screen.getByRole("button", { name: "修复可自动处理项" }));
    fireEvent.click(screen.getByRole("button", { name: "登记为账号 account-099" }));

    expect(screen.getByText("目录健康")).toBeTruthy();
    expect(screen.getByText("先检查，再按结果修复低风险项或手动登记孤儿目录。")).toBeTruthy();
    expect(screen.getByText("检查结果有 1 个提醒，建议处理后再做备份。")).toBeTruthy();
    expect(screen.getByText("未登记 Profile 目录")).toBeTruthy();
    expect(props.onHealthCheck).toHaveBeenCalledTimes(1);
    expect(props.onRepairHealth).toHaveBeenCalledTimes(1);
    expect(props.onRegisterOrphanProfile).toHaveBeenCalledWith("account-099");
  });

  test("保留轻量备份创建、路径输入和恢复确认流程", () => {
    const props = renderSettingsDialog();

    expect(
      screen.getByText("轻量备份只保存 profiles.json 里的账号索引、项目、网址库和设置。")
    ).toBeTruthy();
    expect(screen.getByText("不会备份 profiles/ 下的 Chrome profile 文件夹。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建备份" }));
    fireEvent.change(screen.getByLabelText("备份文件路径"), {
      target: { value: "/tmp/restore.json" }
    });
    fireEvent.click(screen.getByRole("button", { name: "从备份恢复" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));

    expect(screen.getByText("确认从备份恢复")).toBeTruthy();
    expect(
      screen.getByText("这会替换当前 profiles.json 索引与设置；已有 Chrome profile 文件夹不会被删除。")
    ).toBeTruthy();
    expect(screen.getByText("/tmp/multichrome/app-data/backups/profiles.json")).toBeTruthy();
    expect(props.onCreateBackup).toHaveBeenCalledTimes(1);
    expect(props.onBackupPathChange).toHaveBeenCalledWith("/tmp/restore.json");
    expect(props.onRequestRestoreBackup).toHaveBeenCalledTimes(1);
    expect(props.onConfirmRestoreBackup).toHaveBeenCalledTimes(1);
  });

  test("保留完整备份预览、创建、扫描和恢复入口", () => {
    const props = renderSettingsDialog();

    fireEvent.click(screen.getByRole("button", { name: "选中账号" }));
    fireEvent.click(screen.getByRole("button", { name: "预览完整备份" }));
    fireEvent.click(screen.getByRole("button", { name: "创建完整备份" }));
    fireEvent.change(screen.getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/full-restore" }
    });
    fireEvent.click(screen.getByRole("button", { name: "扫描完整备份" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复完整备份" }));

    expect(screen.getByText("1. 预览本次范围")).toBeTruthy();
    expect(screen.getByText("2. 创建完整备份")).toBeTruthy();
    expect(screen.getByText("3. 扫描恢复目录")).toBeTruthy();
    expect(screen.getByText("4. 确认恢复")).toBeTruthy();
    expect(screen.getByText("/tmp/full-backup-next")).toBeTruthy();
    expect(screen.getAllByText("/tmp/full-backup-done")).toHaveLength(2);
    expect(screen.getByText("新增 1 个")).toBeTruthy();
    expect(screen.getByText("覆盖 1 个")).toBeTruthy();
    expect(props.onFullBackupScopeChange).toHaveBeenCalledWith("selected");
    expect(props.onPreviewFullBackup).toHaveBeenCalledTimes(1);
    expect(props.onCreateFullBackup).toHaveBeenCalledTimes(1);
    expect(props.onFullBackupPathChange).toHaveBeenCalledWith("/tmp/full-restore");
    expect(props.onPreviewFullRestore).toHaveBeenCalledTimes(1);
    expect(props.onRequestFullRestore).toHaveBeenCalledTimes(1);
  });
});

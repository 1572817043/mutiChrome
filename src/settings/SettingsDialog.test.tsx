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

const runtimeDiagnostics = {
  enabled: true,
  selectedProfileCount: 1,
  selectedProfileName: "主号",
  session: {
    profileId: "account-001",
    status: "running" as const,
    running: true,
    pid: 1201,
    debugPort: 19222,
    cdpStatus: "available" as const,
    runtimeError: null,
    windowCount: null,
    windows: [],
    windowError: null,
    checkedAt: 1000
  },
  status: "idle" as const,
  tabs: [],
  error: null,
  onReadTabs: vi.fn(),
  navigateUrl: "",
  navigateStatus: "idle" as const,
  navigateResult: null,
  navigateError: null,
  onNavigateUrlChange: vi.fn(),
  onNavigate: vi.fn()
};

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

type SettingsDialogPropsOverride = Omit<
  Partial<SettingsDialogProps>,
  "rootSettings" | "health" | "lightBackup" | "fullBackup"
> & {
  rootSettings?: Partial<SettingsDialogProps["rootSettings"]>;
  health?: Partial<SettingsDialogProps["health"]>;
  lightBackup?: Partial<SettingsDialogProps["lightBackup"]>;
  fullBackup?: Partial<SettingsDialogProps["fullBackup"]>;
};

function renderSettingsDialog(overrides: SettingsDialogPropsOverride = {}) {
  const props = renderSettingsDialogProps(overrides);

  render(<SettingsDialog {...props} />);
  return props;
}

describe("设置弹窗", () => {
  test("保留根目录、浏览器路径、主题和遮罩关闭交互", () => {
    const props = renderSettingsDialog({
      rootSettings: {
        rootPathDraft: "/tmp/multichrome"
      }
    });

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

    expect(props.rootSettings.onRootPathChange).toHaveBeenCalledWith("/tmp/next-root");
    expect(props.rootSettings.onApplyRootPath).toHaveBeenCalledTimes(1);
    expect(props.rootSettings.onBrowserPathChange).toHaveBeenCalledWith(
      "/Applications/Chrome Canary.app"
    );
    expect(props.rootSettings.onThemeChange).toHaveBeenCalledWith("dark");
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
    expect(props.health.onHealthCheck).toHaveBeenCalledTimes(1);
    expect(props.health.onRepairHealth).toHaveBeenCalledTimes(1);
    expect(props.health.onRegisterOrphanProfile).toHaveBeenCalledWith("account-099");
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
    expect(props.lightBackup.onCreateBackup).toHaveBeenCalledTimes(1);
    expect(props.lightBackup.onBackupPathChange).toHaveBeenCalledWith("/tmp/restore.json");
    expect(props.lightBackup.onRequestRestoreBackup).toHaveBeenCalledTimes(1);
    expect(props.lightBackup.onConfirmRestoreBackup).toHaveBeenCalledTimes(1);
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
    expect(props.fullBackup.onFullBackupScopeChange).toHaveBeenCalledWith("selected");
    expect(props.fullBackup.onPreviewFullBackup).toHaveBeenCalledTimes(1);
    expect(props.fullBackup.onCreateFullBackup).toHaveBeenCalledTimes(1);
    expect(props.fullBackup.onFullBackupPathChange).toHaveBeenCalledWith("/tmp/full-restore");
    expect(props.fullBackup.onPreviewFullRestore).toHaveBeenCalledTimes(1);
    expect(props.fullBackup.onRequestFullRestore).toHaveBeenCalledTimes(1);
  });

  test("非 DEV 时不显示开发诊断区", () => {
    renderSettingsDialog({
      runtimeDiagnostics: {
        ...runtimeDiagnostics,
        enabled: false
      }
    });

    expect(screen.queryByText("开发诊断")).toBeNull();
  });

  test("开发诊断 details 默认未展开", () => {
    renderSettingsDialog({
      runtimeDiagnostics
    });

    expect(getDevDiagnosticsDetails().open).toBe(false);
  });

  test("DEV 且单选账号时显示运行诊断状态", () => {
    renderSettingsDialog({
      runtimeDiagnostics
    });
    expandDevDiagnostics();

    expect(screen.getByText("开发诊断")).toBeTruthy();
    expect(screen.getByText("主号")).toBeTruthy();
    expect(screen.getByText("CDP：available")).toBeTruthy();
    expect(screen.getByText("调试端口：19222")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "读取标签页" }) as HTMLButtonElement).disabled
    ).toBe(false);
    expect(screen.getByLabelText("导航 URL")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "导航标签页" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByText("将导航该账号的第一个 page 标签页。")).toBeTruthy();
  });

  test("没有选中或多选账号时禁用读取并显示短提示", () => {
    const { rerender } = render(
      <SettingsDialog
        {...renderSettingsDialogProps({
          runtimeDiagnostics: {
            ...runtimeDiagnostics,
            selectedProfileCount: 0,
            selectedProfileName: null,
            session: null
          }
        })}
      />
    );
    expandDevDiagnostics();

    expect(
      (screen.getByRole("button", { name: "读取标签页" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "导航标签页" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByText("请选择 1 个账号。")).toBeTruthy();

    rerender(
      <SettingsDialog
        {...renderSettingsDialogProps({
          runtimeDiagnostics: {
            ...runtimeDiagnostics,
            selectedProfileCount: 2,
            selectedProfileName: null,
            session: null
          }
        })}
      />
    );
    expandDevDiagnostics();

    expect(
      (screen.getByRole("button", { name: "读取标签页" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "导航标签页" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByText("仅支持单选账号。")).toBeTruthy();
  });

  test("DEV 单选账号填写 URL 后可以请求导航第一个 page 标签页", () => {
    const onNavigateUrlChange = vi.fn();
    const onNavigate = vi.fn();
    renderSettingsDialog({
      runtimeDiagnostics: {
        ...runtimeDiagnostics,
        navigateUrl: "https://example.com/dashboard",
        onNavigateUrlChange,
        onNavigate
      }
    });
    expandDevDiagnostics();

    fireEvent.change(screen.getByLabelText("导航 URL"), {
      target: { value: "https://example.org" }
    });
    fireEvent.click(screen.getByRole("button", { name: "导航标签页" }));

    expect(onNavigateUrlChange).toHaveBeenCalledWith("https://example.org");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  test("导航成功时展示第一个 page 标签页反馈", () => {
    renderSettingsDialog({
      runtimeDiagnostics: {
        ...runtimeDiagnostics,
        navigateUrl: "https://example.com/dashboard",
        navigateStatus: "succeeded",
        navigateResult: {
          profileId: "account-001",
          targetId: "page-1",
          url: "https://example.com/dashboard",
          navigatedAt: 1000
        }
      }
    });
    expandDevDiagnostics();

    expect(
      screen.getByText("已导航第一个 page 标签页：https://example.com/dashboard")
    ).toBeTruthy();
  });

  test("点击读取标签页会调用 handler", () => {
    const onReadTabs = vi.fn();
    renderSettingsDialog({
      runtimeDiagnostics: {
        ...runtimeDiagnostics,
        onReadTabs
      }
    });
    expandDevDiagnostics();

    fireEvent.click(screen.getByRole("button", { name: "读取标签页" }));

    expect(onReadTabs).toHaveBeenCalledTimes(1);
  });

  test("标签页读取成功时展示数量、标题、URL 和短 targetId", () => {
    renderSettingsDialog({
      runtimeDiagnostics: {
        ...runtimeDiagnostics,
        status: "succeeded",
        tabs: [
          {
            targetId: "0123456789abcdef",
            type: "page",
            url: "https://example.com/dashboard",
            title: "Example Dashboard",
            webSocketDebuggerUrl: "ws://127.0.0.1:19222/devtools/page/0123456789abcdef",
            checkedAt: 1000
          }
        ]
      }
    });
    expandDevDiagnostics();

    expect(screen.getByText("1 个标签页")).toBeTruthy();
    expect(screen.getByText("Example Dashboard")).toBeTruthy();
    expect(screen.getByText("https://example.com/dashboard")).toBeTruthy();
    expect(screen.getByText("target 01234567")).toBeTruthy();
    expect(screen.queryByText(/webSocketDebuggerUrl|devtools\/page|ws:\/\//)).toBeNull();
  });

  test("标签页读取失败时展示错误文案", () => {
    renderSettingsDialog({
      runtimeDiagnostics: {
        ...runtimeDiagnostics,
        status: "failed",
        error: "Runtime 不可用"
      }
    });
    expandDevDiagnostics();

    expect(screen.getByText("Runtime 不可用")).toBeTruthy();
  });
});

function getDevDiagnosticsDetails(): HTMLDetailsElement {
  const summary = screen.getByText("开发诊断");
  const details = summary.closest("details");
  if (!details) {
    throw new Error("开发诊断不在 details 内");
  }
  return details as HTMLDetailsElement;
}

function expandDevDiagnostics() {
  const details = getDevDiagnosticsDetails();
  if (!details.open) {
    fireEvent.click(screen.getByText("开发诊断"));
  }
}

function renderSettingsDialogProps(
  overrides: SettingsDialogPropsOverride = {}
): SettingsDialogProps {
  const {
    rootSettings,
    health: healthOverrides,
    lightBackup,
    fullBackup,
    ...topLevelOverrides
  } = overrides;

  return {
    rootSettings: {
      rootPathDraft: "/tmp/multichrome",
      rootStatus: { rootExists: true, writable: true, profileCount: 2 },
      browserPathDraft: "/Applications/Google Chrome.app",
      chromeStatus: { available: true, appPath: "/Applications/Google Chrome.app" },
      themeDraft: "light",
      onRootPathChange: vi.fn(),
      onBrowserPathChange: vi.fn(),
      onThemeChange: vi.fn(),
      onApplyRootPath: vi.fn(),
      onSaveSettings: vi.fn(),
      onRevealRootDirectory: vi.fn(),
      onRevealBackupsDirectory: vi.fn(),
      ...rootSettings
    },
    health: {
      healthReport,
      healthChecking: false,
      healthRepairing: false,
      orphanRegisteringId: null,
      repairResult,
      onHealthCheck: vi.fn(),
      onRepairHealth: vi.fn(),
      onRegisterOrphanProfile: vi.fn(),
      ...healthOverrides
    },
    lightBackup: {
      backupResult,
      backupPathDraft: "/tmp/backup.json",
      backupWorking: null,
      restoreConfirmOpen: true,
      onCreateBackup: vi.fn(),
      onRequestRestoreBackup: vi.fn(),
      onConfirmRestoreBackup: vi.fn(),
      onCancelRestoreBackup: vi.fn(),
      onBackupPathChange: vi.fn(),
      ...lightBackup
    },
    fullBackup: {
      fullBackupScope: "all",
      fullBackupPreview,
      fullBackupResult,
      fullBackupPathDraft: "/tmp/full-backup-done",
      fullRestorePreview,
      fullBackupWorking: null,
      selectedProfileCount: 1,
      onFullBackupScopeChange: vi.fn(),
      onPreviewFullBackup: vi.fn(),
      onCreateFullBackup: vi.fn(),
      onPreviewFullRestore: vi.fn(),
      onRequestFullRestore: vi.fn(),
      onFullBackupPathChange: vi.fn(),
      ...fullBackup
    },
    onClose: vi.fn(),
    ...topLevelOverrides
  };
}

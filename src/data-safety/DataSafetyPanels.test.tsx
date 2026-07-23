import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  FullProfileRestorePreview,
  RootHealthReport,
  RootRepairResult
} from "../types";
import { FullRestoreConfirmDialog } from "./FullRestoreConfirmDialog";
import { HealthReportPanel } from "./HealthReportPanel";
import { RepairResultPanel } from "./RepairResultPanel";

const healthReport: RootHealthReport = {
  rootPath: "/tmp/multichrome",
  summary: {
    profileCount: 2,
    warningCount: 1,
    errorCount: 1
  },
  issues: [
    {
      severity: "error",
      code: "missing_profile_dir",
      title: "账号目录缺失",
      detail: "account-001 缺少 profile 文件夹",
      path: "/tmp/multichrome/profiles/account-001",
      profileId: "account-001"
    },
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

describe("数据安全展示组件", () => {
  test("健康检查结果保留摘要、问题展示和孤儿目录登记入口", () => {
    const onRegisterOrphan = vi.fn();

    render(
      <HealthReportPanel
        report={healthReport}
        registeringOrphanId="account-099"
        onRegisterOrphan={onRegisterOrphan}
      />
    );

    expect(screen.getByText("2 个账号")).toBeTruthy();
    expect(screen.getByText("1 个错误")).toBeTruthy();
    expect(screen.getByText("1 个提醒")).toBeTruthy();
    expect(screen.getByText("需要处理：先看错误，再处理提醒。")).toBeTruthy();
    expect(screen.getByText("账号目录缺失")).toBeTruthy();
    expect(screen.getByText("/tmp/multichrome/profiles/account-001")).toBeTruthy();
    expect(
      screen.getByText("登记只会加入账号索引，不复制、不移动、不删除这个目录。")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "登记为账号 account-099" })).toHaveProperty(
      "disabled",
      true
    );
  });

  test("健康检查无问题时保留清洁状态文案", () => {
    render(
      <HealthReportPanel
        report={{
          rootPath: "/tmp/multichrome",
          summary: {
            profileCount: 2,
            warningCount: 0,
            errorCount: 0
          },
          issues: []
        }}
        registeringOrphanId={null}
        onRegisterOrphan={vi.fn()}
      />
    );

    expect(screen.getByText("未发现问题")).toBeTruthy();
    expect(screen.getByText("检查通过")).toBeTruthy();
    expect(screen.getByText("索引和配置目录当前一致。")).toBeTruthy();
  });

  test("自动修复结果保留动作列表和空结果文案", () => {
    const repairResult: RootRepairResult = {
      repairedCount: 1,
      actions: [
        {
          code: "create_profile_dir",
          title: "创建账号目录",
          detail: "已补齐缺失目录",
          path: "/tmp/multichrome/profiles/account-001",
          profileId: "account-001"
        }
      ],
      health: healthReport
    };

    const { rerender } = render(<RepairResultPanel result={repairResult} />);

    expect(screen.getByText("自动修复结果")).toBeTruthy();
    expect(screen.getByText("已完成 1 个自动修复动作。")).toBeTruthy();
    expect(screen.getByText("创建账号目录")).toBeTruthy();
    expect(screen.getByText("account-001")).toBeTruthy();

    rerender(<RepairResultPanel result={{ ...repairResult, actions: [] }} />);
    expect(screen.getByText("没有可自动修复的问题。")).toBeTruthy();
    expect(
      screen.getByText("自动修复只处理创建缺失目录这类低风险项，不会删除文件或覆盖损坏索引。")
    ).toBeTruthy();
  });

  test("完整恢复确认弹窗保留遮罩取消、路径展示和 working 状态", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const preview: FullProfileRestorePreview = {
      path: "/tmp/full-backup",
      profileCount: 3,
      profileIds: ["account-001", "account-002", "account-003"],
      newProfileIds: ["account-003"],
      overwriteProfileIds: ["account-001", "account-002"],
      totalBytes: 4096
    };

    render(
      <FullRestoreConfirmDialog
        preview={preview}
        working={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("heading", { name: "确认恢复完整备份" })).toBeTruthy();
    expect(screen.getByText("扫描结果：共 3 个账号，新增 1 个，覆盖 2 个。")).toBeTruthy();
    expect(
      screen.getByText("覆盖项会按现有恢复流程替换同 ID 的账号资料和 Chrome profile 文件夹。")
    ).toBeTruthy();
    expect(
      screen.getByText("备份中没有出现的其他账号会保留；不会合并同 ID profile 文件夹内容。")
    ).toBeTruthy();
    expect(screen.getByText("/tmp/full-backup")).toBeTruthy();
    expect(screen.getByRole("button", { name: "恢复中" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

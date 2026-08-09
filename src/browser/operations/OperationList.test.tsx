import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { BrowserOperation, WindowOperationSummary } from "../../browserOperations";
import { OperationList } from "./OperationList";

function operation(
  id: string,
  status: BrowserOperation["status"],
  target: BrowserOperation["target"] = { kind: "url", url: "https://galxe.com" }
): BrowserOperation {
  return {
    id,
    type: target.kind === "project" ? "project-open" : "bulk-open-url",
    status,
    profileIds: ["account-001", "account-002"],
    target,
    sourceLabel: "批量打开",
    createdAt: 1,
    startedAt: status === "queued" ? null : 2,
    finishedAt: status === "queued" || status === "running" ? null : 3,
    cancelReason: null,
    summary: {
      totalCount: 2,
      queuedCount: 2,
      successCount: 1,
      failureCount: 1,
      failures: [],
      stopped: false
    }
  };
}

describe("OperationList", () => {
  test("把进行中操作和最近操作分开展示", () => {
    render(
      <OperationList
        operations={[
          operation("op-running", "running"),
          operation("op-succeeded", "succeeded", {
            kind: "project",
            projectId: "project-001",
            projectName: "Galxe 项目",
            projectUrlIds: ["project-url-001"]
          })
        ]}
      />
    );

    const currentList = screen.getByRole("list", { name: "当前操作记录" });
    expect(within(currentList).getByText("运行中")).toBeTruthy();
    expect(within(currentList).getByText("批量打开")).toBeTruthy();

    const recentList = screen.getByRole("list", { name: "最近操作记录" });
    expect(within(recentList).getByText("成功")).toBeTruthy();
    expect(within(recentList).getByText("打开项目")).toBeTruthy();
    expect(within(recentList).getByText("Galxe 项目")).toBeTruthy();
  });

  test("失败批量操作只展示前两条失败原因并提示剩余数量", () => {
    render(
      <OperationList
        operations={[
          {
            ...operation("op-failed", "failed"),
            summary: {
              totalCount: 4,
              queuedCount: 4,
              successCount: 1,
              failureCount: 3,
              failures: [
                {
                  profileId: "account-001",
                  profileName: "主号",
                  message: "Chrome 启动失败"
                },
                {
                  profileId: "account-002",
                  profileName: "抽奖号",
                  message: "辅助功能权限不足"
                },
                {
                  profileId: "account-003",
                  profileName: "备用号",
                  message: "浏览器路径无效"
                }
              ],
              stopped: false
            }
          }
        ]}
      />
    );

    const recentList = screen.getByRole("list", { name: "最近操作记录" });
    expect(within(recentList).getByText("1 / 4")).toBeTruthy();
    expect(
      within(recentList).getByText(
        "失败原因：主号：Chrome 启动失败；抽奖号：辅助功能权限不足；另 1 个失败"
      )
    ).toBeTruthy();
    expect(within(recentList).queryByText(/浏览器路径无效/)).toBeNull();
  });

  test("取消和窗口操作展示已有原因与数量字段", () => {
    render(
      <OperationList
        operations={[
          {
            ...operation("op-cancelled", "cancelled"),
            cancelReason: "用户停止"
          },
          {
            ...operation("op-window", "failed", {
              kind: "window",
              action: "同步布局"
            }),
            type: "window-action",
            summary: {
              profileCount: 3,
              syncedCount: 1,
              noWindowCount: 1,
              minimizedCount: 1,
              failedCount: 1
            }
          }
        ]}
      />
    );

    const recentList = screen.getByRole("list", { name: "最近操作记录" });
    expect(within(recentList).getByText("取消原因：用户停止")).toBeTruthy();
    expect(
      within(recentList).getByText("结果：已同步 1 个，失败 1 个，无窗口 1 个，最小化 1 个")
    ).toBeTruthy();
  });

  test("窗口操作优先展示标准 summary", () => {
    const summary: WindowOperationSummary = {
      summaryType: "window-operation",
      action: "sync-layout",
      profileCount: 4,
      sourceProfileId: "account-001",
      succeededCount: 1,
      skippedCount: 1,
      failedCount: 1,
      focusFailedCount: 1,
      minimizedCount: 1,
      unchangedCount: 1
    };

    render(
      <OperationList
        operations={[
          {
            ...operation("op-window-standard", "failed", {
              kind: "window",
              action: "同步布局"
            }),
            type: "window-action",
            summary
          }
        ]}
      />
    );

    const recentList = screen.getByRole("list", { name: "最近操作记录" });
    expect(
      within(recentList).getByText(
        "结果：已同步 1 / 4，失败 1 个，最小化 1 个，未生效 1 个，未能前置 1 个"
      )
    ).toBeTruthy();
    expect(
      within(recentList).queryByText("结果：已同步 1 个，失败 1 个，最小化 1 个，未生效 1 个，未能前置 1 个")
    ).toBeNull();
  });

  test("窗口操作保留旧 summary fallback", () => {
    render(
      <OperationList
        operations={[
          {
            ...operation("op-window-legacy", "failed", {
              kind: "window",
              action: "同步布局"
            }),
            type: "window-action",
            summary: {
              profileCount: 3,
              syncedCount: 1,
              noWindowCount: 1,
              failedCount: 1
            }
          }
        ]}
      />
    );

    const recentList = screen.getByRole("list", { name: "最近操作记录" });
    expect(
      within(recentList).getByText("结果：已同步 1 个，失败 1 个，无窗口 1 个")
    ).toBeTruthy();
  });

  test("关闭运行账号展示已关闭和失败数量", () => {
    render(
      <OperationList
        operations={[
          {
            ...operation("op-quit", "failed", {
              kind: "window",
              action: "关闭运行账号"
            }),
            type: "window-action",
            summary: {
              profileCount: 3,
              closedCount: 2,
              failedCount: 1
            }
          }
        ]}
      />
    );

    const recentList = screen.getByRole("list", { name: "最近操作记录" });
    expect(
      within(recentList).getByText("结果：已关闭 2 个，失败 1 个")
    ).toBeTruthy();
  });
});

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { WindowSyncPlan } from "../../browserWindows";
import { WindowSyncDetailsPanel } from "./WindowSyncDetailsPanel";
import { buildWindowSyncPreviewDetails } from "./windowSyncController";

const plan: WindowSyncPlan = {
  sourceProfileId: "account-001",
  sourceProfileName: "主号",
  sourceStatus: "ready",
  sourceBounds: { x: 80, y: 120, width: 960, height: 720 },
  sourceWindowError: null,
  placements: [
    {
      profileId: "account-002",
      profileName: "目标号",
      bounds: { x: 80, y: 120, width: 960, height: 720 }
    }
  ],
  skipped: [
    {
      profileId: "account-003",
      profileName: "最小化号",
      reason: "minimized-window"
    },
    {
      profileId: "account-004",
      profileName: "失败号",
      reason: "window-error"
    }
  ],
  noWindowCount: 0,
  minimizedCount: 1,
  failedCount: 1
};

test("同步详情预览面板展示 source、placement、bounds 和跳过原因", () => {
  render(
    <WindowSyncDetailsPanel details={buildWindowSyncPreviewDetails(plan)} />
  );

  expect(screen.getByRole("region", { name: "同步详情" })).toBeTruthy();
  expect(screen.getByText("预览")).toBeTruthy();
  expect(screen.getByText("主账号：主号")).toBeTruthy();
  expect(screen.getByRole("list", { name: "同步目标" }).textContent).toContain(
    "目标号：960x720 @ 80,120"
  );
  expect(screen.getByText("最小化号：窗口已最小化")).toBeTruthy();
  expect(screen.getByText("失败号：读取失败")).toBeTruthy();
});

test("同步详情未预览时展示空态", () => {
  render(<WindowSyncDetailsPanel details={null} />);

  expect(screen.getByText("尚未预览或同步布局")).toBeTruthy();
});

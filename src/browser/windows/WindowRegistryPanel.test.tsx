import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { BrowserWindowRegistryEntry } from "../../browserWindows";
import { WindowRegistryPanel } from "./WindowRegistryPanel";

function entry(
  overrides: Partial<BrowserWindowRegistryEntry> = {}
): BrowserWindowRegistryEntry {
  return {
    profileId: "account-001",
    profileName: "主号",
    status: "ready",
    windowCount: 1,
    primaryWindow: {
      index: 1,
      title: "Chrome",
      x: 12,
      y: 34,
      width: 1280,
      height: 720
    },
    hasMultipleWindows: false,
    minimized: false,
    windowError: null,
    ...overrides
  };
}

test("窗口状态面板展示未检查空态", () => {
  render(<WindowRegistryPanel entries={[]} checkedAt={null} />);

  expect(
    screen.getByText("点击检查窗口读取选中运行账号的窗口状态")
  ).toBeTruthy();
});

test("窗口状态面板展示可读窗口的首窗信息和多窗口提示", () => {
  render(
    <WindowRegistryPanel
      entries={[entry({ windowCount: 2, hasMultipleWindows: true })]}
      checkedAt="2026-08-09T10:20:30.000Z"
    />
  );

  expect(screen.getByText("主号")).toBeTruthy();
  expect(screen.getByText("可读窗口")).toBeTruthy();
  expect(screen.getByText("2 个窗口")).toBeTruthy();
  expect(screen.getByText("1280x720 @ 12,34")).toBeTruthy();
  expect(screen.getByText("仅显示首个窗口")).toBeTruthy();
  expect(screen.getByText(/最近检查：/)).toBeTruthy();
});

test("窗口状态面板展示最小化、无窗口和读取失败状态", () => {
  render(
    <WindowRegistryPanel
      entries={[
        entry({ minimized: true }),
        entry({ profileId: "account-002", profileName: "小号", status: "missing", windowCount: 0, primaryWindow: null }),
        entry({ profileId: "account-003", profileName: "失败号", status: "error", windowError: "无权限" })
      ]}
      checkedAt="2026-08-09T10:20:30.000Z"
    />
  );

  expect(screen.getByText("已最小化")).toBeTruthy();
  expect(screen.getByText("无可读窗口")).toBeTruthy();
  expect(screen.getByText("读取失败")).toBeTruthy();
  expect(screen.getByText("无权限")).toBeTruthy();
});

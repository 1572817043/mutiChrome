import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { RuntimeTabsPanelModel } from "./runtimeTabs";
import { RuntimeTabsPanel } from "./RuntimeTabsPanel";

function createModel(
  overrides: Partial<RuntimeTabsPanelModel> = {}
): RuntimeTabsPanelModel {
  return {
    profileName: "工作账号",
    canReadTabs: true,
    disabledReason: null,
    cdpStatusLabel: "可用",
    debugPortLabel: "9222",
    rows: [],
    emptyMessage: null,
    errorMessage: null,
    ...overrides
  };
}

describe("RuntimeTabsPanel", () => {
  test("missing-port 时禁用读取并显示重新打开提示", () => {
    render(
      <RuntimeTabsPanel
        model={createModel({
          canReadTabs: false,
          disabledReason: "重新打开账号以启用标签页读取",
          cdpStatusLabel: "缺少调试端口",
          debugPortLabel: "未发现"
        })}
        onReadTabs={vi.fn()}
      />
    );

    expect(screen.getByText("浏览器标签页")).toBeTruthy();
    expect(screen.getByText("CDP 状态：缺少调试端口")).toBeTruthy();
    expect(screen.getByText("调试端口：未发现")).toBeTruthy();
    expect(screen.getByText("重新打开账号以启用标签页读取")).toBeTruthy();
    expect((screen.getByRole("button", { name: "读取标签页" }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  test("loading 时显示读取中并禁用按钮", () => {
    render(
      <RuntimeTabsPanel
        model={createModel({ canReadTabs: false })}
        onReadTabs={vi.fn()}
        loading
      />
    );

    expect(screen.getByRole("button", { name: "读取中" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "读取中" }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  test("loading 时不显示过期的禁用原因提示", () => {
    render(
      <RuntimeTabsPanel
        model={createModel({
          canReadTabs: false,
          disabledReason: "账号未运行"
        })}
        onReadTabs={vi.fn()}
        loading
      />
    );

    expect(screen.queryByText("账号未运行")).toBeNull();
    expect(screen.getByRole("button", { name: "读取中" })).toBeTruthy();
  });

  test("点击读取调用 handler，并展示标签页标题 URL 和短 target", () => {
    const onReadTabs = vi.fn();
    render(
      <RuntimeTabsPanel
        model={createModel({
          rows: [
            {
              targetId: "target-1234567890",
              title: "示例页面",
              url: "https://example.com/page",
              checkedAt: 1000
            }
          ]
        })}
        onReadTabs={onReadTabs}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "读取标签页" }));

    expect(onReadTabs).toHaveBeenCalledTimes(1);
    expect(screen.getByText("示例页面")).toBeTruthy();
    expect(screen.getByText("https://example.com/page")).toBeTruthy();
    expect(screen.getByText("target-1…")).toBeTruthy();
  });

  test("失败时显示错误信息", () => {
    render(
      <RuntimeTabsPanel
        model={createModel({ errorMessage: "连接超时" })}
        onReadTabs={vi.fn()}
      />
    );

    expect(screen.getByText("读取失败：连接超时")).toBeTruthy();
  });
});

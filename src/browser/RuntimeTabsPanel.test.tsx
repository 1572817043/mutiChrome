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

  test("每个已读取标签页都有独立的复制网址按钮", () => {
    render(
      <RuntimeTabsPanel
        model={createModel({
          rows: [
            {
              targetId: "target-1",
              title: "第一行",
              url: "https://example.com/first",
              checkedAt: 1000
            },
            {
              targetId: "target-2",
              title: "第二行",
              url: "https://example.com/second",
              checkedAt: 1000
            }
          ]
        })}
        onReadTabs={vi.fn()}
        onCopyUrl={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", {
        name: "复制网址 第一行 https://example.com/first"
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "复制网址 第二行 https://example.com/second"
      })
    ).toBeTruthy();
  });

  test("同名标签页的复制按钮会用不同 URL 区分并复制对应 URL", () => {
    const onCopyUrl = vi.fn();
    render(
      <RuntimeTabsPanel
        model={createModel({
          rows: [
            {
              targetId: "target-1",
              title: "相同标题",
              url: "https://example.com/first",
              checkedAt: 1000
            },
            {
              targetId: "target-2",
              title: "相同标题",
              url: "https://example.com/second",
              checkedAt: 1000
            }
          ]
        })}
        onReadTabs={vi.fn()}
        onCopyUrl={onCopyUrl}
      />
    );

    const firstButton = screen.getByRole("button", {
      name: "复制网址 相同标题 https://example.com/first"
    });
    const secondButton = screen.getByRole("button", {
      name: "复制网址 相同标题 https://example.com/second"
    });

    fireEvent.click(firstButton);
    fireEvent.click(secondButton);

    expect(onCopyUrl).toHaveBeenNthCalledWith(1, "https://example.com/first");
    expect(onCopyUrl).toHaveBeenNthCalledWith(2, "https://example.com/second");
  });

  test("点击每一行的复制按钮只复制对应 URL，且不影响读取按钮", () => {
    const onReadTabs = vi.fn();
    const onCopyUrl = vi.fn();
    render(
      <RuntimeTabsPanel
        model={createModel({
          rows: [
            {
              targetId: "target-1",
              title: "第一行",
              url: "https://example.com/first",
              checkedAt: 1000
            },
            {
              targetId: "target-2",
              title: "第二行",
              url: "https://example.com/second",
              checkedAt: 1000
            }
          ]
        })}
        onReadTabs={onReadTabs}
        onCopyUrl={onCopyUrl}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "复制网址 第一行 https://example.com/first"
      })
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "复制网址 第二行 https://example.com/second"
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "读取标签页" }));

    expect(onCopyUrl).toHaveBeenNthCalledWith(1, "https://example.com/first");
    expect(onCopyUrl).toHaveBeenNthCalledWith(2, "https://example.com/second");
    expect(onCopyUrl).toHaveBeenCalledTimes(2);
    expect(onReadTabs).toHaveBeenCalledTimes(1);
  });

  test("没有真实标签页行或未提供复制 handler 时不显示复制按钮", () => {
    const { rerender } = render(
      <RuntimeTabsPanel
        model={createModel({
          canReadTabs: false,
          disabledReason: "重新打开账号以启用标签页读取"
        })}
        onReadTabs={vi.fn()}
        onCopyUrl={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /复制网址/ })).toBeNull();

    rerender(
      <RuntimeTabsPanel
        model={createModel({
          errorMessage: "连接超时"
        })}
        onReadTabs={vi.fn()}
        onCopyUrl={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /复制网址/ })).toBeNull();

    rerender(
      <RuntimeTabsPanel
        model={createModel({
          rows: [
            {
              targetId: "target-1",
              title: "未提供 handler",
              url: "https://example.com",
              checkedAt: 1000
            }
          ]
        })}
        onReadTabs={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /复制网址/ })).toBeNull();
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

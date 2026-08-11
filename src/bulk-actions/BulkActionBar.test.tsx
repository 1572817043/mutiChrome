import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ChromeProfile } from "../types";
import type { BrowserWindowRegistryEntry } from "../browserWindows";
import type { WindowLayoutPreset } from "../browserWindows";
import type { WindowSyncDetails } from "../browser/windows/windowSyncController";
import { BatchDeleteConfirmDialog } from "./BatchDeleteConfirmDialog";
import { BulkActionBar } from "./BulkActionBar";

type BulkActionBarProps = Parameters<typeof BulkActionBar>[0];
type BulkActionBarOverrides = {
  [Group in keyof BulkActionBarProps]?: Partial<BulkActionBarProps[Group]>;
};

function profile(id: string, name: string): ChromeProfile {
  return {
    id,
    name,
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    accentColor: "forest",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null
  };
}

function createBulkActionBarProps(overrides: BulkActionBarOverrides = {}) {
  const handlers = {
    onBulkTagChange: vi.fn(),
    onBulkUrlChange: vi.fn(),
    onBulkOpenIntervalChange: vi.fn(),
    onLayoutSourceProfileChange: vi.fn(),
    onTileLayoutPresetChange: vi.fn(),
    onAppendTags: vi.fn(),
    onAddFavoriteUrl: vi.fn(),
    onRemoveFavoriteUrl: vi.fn(),
    onOpenUrl: vi.fn(),
    onRetryFailures: vi.fn(),
    onInspectWindows: vi.fn(),
    onTileWindows: vi.fn(),
    onSyncLayout: vi.fn(),
    onPreviewSync: vi.fn(),
    onFocusWindows: vi.fn(),
    onQuitWindows: vi.fn(),
    onRestartWindows: vi.fn(),
    onStopOpenQueue: vi.fn(),
    onRequestDelete: vi.fn(),
    onClear: vi.fn()
  };

  return {
    handlers,
    props: {
      selection: {
        selectedCount: 0,
        selectedProfiles: [],
        onRequestDelete: handlers.onRequestDelete,
        onClear: handlers.onClear,
        ...overrides.selection
      },
      urlQueue: {
        bulkUrl: "",
        bulkOpenIntervalSeconds: "3",
        bulkOpenRunning: false,
        retryFailureCount: 0,
        favoriteUrls: [],
        recentUrls: [],
        onBulkUrlChange: handlers.onBulkUrlChange,
        onBulkOpenIntervalChange: handlers.onBulkOpenIntervalChange,
        onAddFavoriteUrl: handlers.onAddFavoriteUrl,
        onRemoveFavoriteUrl: handlers.onRemoveFavoriteUrl,
        onOpenUrl: handlers.onOpenUrl,
        onRetryFailures: handlers.onRetryFailures,
        onStopOpenQueue: handlers.onStopOpenQueue,
        ...overrides.urlQueue
      },
      tagging: {
        bulkTag: "",
        onBulkTagChange: handlers.onBulkTagChange,
        onAppendTags: handlers.onAppendTags,
        ...overrides.tagging
      },
      windowActions: {
        windowInspecting: false,
        windowTiling: false,
        windowSyncing: false,
        windowSyncPreviewing: false,
        windowFocusing: false,
        windowQuitting: false,
        windowRestarting: false,
        runningProfileIds: [],
        layoutSourceProfileId: "",
        tileLayoutPreset: "grid" as WindowLayoutPreset,
        onLayoutSourceProfileChange: handlers.onLayoutSourceProfileChange,
        onTileLayoutPresetChange: handlers.onTileLayoutPresetChange,
        onInspectWindows: handlers.onInspectWindows,
        onTileWindows: handlers.onTileWindows,
        onSyncLayout: handlers.onSyncLayout,
        onPreviewSync: handlers.onPreviewSync,
        onFocusWindows: handlers.onFocusWindows,
        onQuitWindows: handlers.onQuitWindows,
        onRestartWindows: handlers.onRestartWindows,
        ...overrides.windowActions
      },
      activity: {
        browserOperations: [],
        launchEvents: [],
        windowSyncDetails: null as WindowSyncDetails | null,
        ...overrides.activity
      }
    }
  };
}

test("批量栏保留打开、重试、停止和更多操作入口", () => {
  const { handlers, props } = createBulkActionBarProps({
    selection: {
      selectedCount: 2,
      selectedProfiles: [profile("account-001", "主号"), profile("account-002", "小号")]
    },
    urlQueue: {
      bulkUrl: "galxe.com",
      bulkOpenRunning: true,
      retryFailureCount: 1,
      favoriteUrls: ["https://galxe.com"],
      recentUrls: ["https://zealy.io"]
    },
    windowActions: {
      runningProfileIds: ["account-001"],
      layoutSourceProfileId: "account-001"
    }
  });
  const { rerender } = render(
    <BulkActionBar {...props} />
  );

  expect(screen.getByText("已选择 2 个账号")).toBeTruthy();
  expect(screen.getByText("正在按队列打开账号，可随时停止后面的账号。")).toBeTruthy();
  expect((screen.getByRole("button", { name: "打开中" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect((screen.getByRole("button", { name: "重试最近失败 1" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "检查窗口" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "平铺窗口" }) as HTMLButtonElement).disabled).toBe(true);

  rerender(
    <BulkActionBar
      {...props}
      urlQueue={{
        ...props.urlQueue,
        bulkOpenRunning: false
      }}
    />
  );

  expect(screen.getByText("将为 2 个账号打开指定网址。")).toBeTruthy();
  expect(screen.getByText("只重试最近一次批量打开失败的账号。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试最近失败 1" }));
  fireEvent.click(screen.getByRole("button", { name: "设为常用" }));
  fireEvent.change(screen.getByLabelText("批量追加标签"), {
    target: { value: "daily" }
  });
  fireEvent.click(screen.getByRole("button", { name: "检查窗口" }));
  fireEvent.click(screen.getByRole("button", { name: "平铺窗口" }));
  fireEvent.click(screen.getByRole("button", { name: "删除选中" }));

  expect(handlers.onStopOpenQueue).toHaveBeenCalledTimes(1);
  expect(handlers.onRetryFailures).toHaveBeenCalledTimes(1);
  expect(handlers.onAddFavoriteUrl).toHaveBeenCalledTimes(1);
  expect(handlers.onBulkTagChange).toHaveBeenCalledWith("daily");
  expect(handlers.onInspectWindows).toHaveBeenCalledTimes(1);
  expect(handlers.onTileWindows).toHaveBeenCalledTimes(1);
  expect(handlers.onRequestDelete).toHaveBeenCalledTimes(1);
});

test("批量打开期间锁定批量追加标签", () => {
  const { handlers, props } = createBulkActionBarProps({
    selection: {
      selectedCount: 1,
      selectedProfiles: [profile("account-001", "主号")]
    },
    urlQueue: {
      bulkOpenRunning: true
    },
    tagging: {
      bulkTag: "daily"
    }
  });

  render(<BulkActionBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

  const tagInput = screen.getByLabelText("批量追加标签") as HTMLInputElement;
  const appendButton = screen.getByRole("button", { name: "追加标签" }) as HTMLButtonElement;
  expect(tagInput.disabled).toBe(true);
  expect(appendButton.disabled).toBe(true);

  fireEvent.click(appendButton);

  expect(handlers.onAppendTags).not.toHaveBeenCalled();
});

test("批量栏更多操作中渲染只读窗口状态面板", () => {
  const { props } = createBulkActionBarProps({
    selection: {
      selectedCount: 1,
      selectedProfiles: [profile("account-001", "主号")]
    },
    activity: {
      windowRegistryEntries: [
        {
          profileId: "account-001",
          profileName: "主号",
          status: "ready",
          windowCount: 1,
          primaryWindow: { index: 1, title: "Chrome", x: 12, y: 34, width: 1280, height: 720 },
          hasMultipleWindows: false,
          minimized: false,
          windowError: null
        } satisfies BrowserWindowRegistryEntry
      ],
      windowRegistryCheckedAt: "2026-08-09T10:20:30.000Z"
    }
  });

  render(<BulkActionBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

  expect(screen.getByRole("region", { name: "窗口状态" })).toBeTruthy();
  expect(screen.getByText("1280x720 @ 12,34")).toBeTruthy();
});

test("批量栏展示预览同步按钮和同步详情面板", () => {
  const { handlers, props } = createBulkActionBarProps({
    selection: {
      selectedCount: 2,
      selectedProfiles: [profile("account-001", "主号"), profile("account-002", "小号")]
    },
    windowActions: {
      runningProfileIds: ["account-001", "account-002"],
      layoutSourceProfileId: "account-001"
    }
  });

  render(<BulkActionBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

  fireEvent.click(screen.getByRole("button", { name: "预览同步" }));
  expect(handlers.onPreviewSync).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("region", { name: "同步详情" })).toBeTruthy();
});

test("批量栏只允许关闭选中的运行账号", () => {
  const { handlers, props } = createBulkActionBarProps({
    selection: {
      selectedCount: 2,
      selectedProfiles: [profile("account-001", "主号"), profile("account-002", "小号")]
    },
    windowActions: {
      runningProfileIds: ["account-001"]
    }
  });

  render(<BulkActionBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

  const quitButton = screen.getByRole("button", { name: "关闭运行账号" });
  expect((quitButton as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(quitButton);
  expect(handlers.onQuitWindows).toHaveBeenCalledTimes(1);

  const noRunningProps = createBulkActionBarProps({
    selection: props.selection,
    windowActions: {
      runningProfileIds: []
    }
  }).props;
  const { rerender } = render(<BulkActionBar {...noRunningProps} />);
  fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[1]);
  expect(
    (screen.getAllByRole("button", { name: "关闭运行账号" })[1] as HTMLButtonElement).disabled
  ).toBe(true);
});

test("批量栏只允许重启选中的运行账号，并在窗口动作冲突时禁用", () => {
  const { handlers, props } = createBulkActionBarProps({
    selection: {
      selectedCount: 2,
      selectedProfiles: [profile("account-001", "主号"), profile("account-002", "小号")]
    },
    windowActions: {
      runningProfileIds: ["account-001"]
    }
  });

  render(<BulkActionBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

  const restartButton = screen.getByRole("button", { name: "重启运行账号" });
  expect((restartButton as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(restartButton);
  expect(handlers.onRestartWindows).toHaveBeenCalledTimes(1);

  const { props: conflictProps } = createBulkActionBarProps({
    selection: props.selection,
    windowActions: {
      runningProfileIds: ["account-001"],
      windowQuitting: true
    }
  });
  const { rerender } = render(<BulkActionBar {...conflictProps} />);
  fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[1]);
  expect(
    (screen.getAllByRole("button", { name: "重启运行账号" })[1] as HTMLButtonElement).disabled
  ).toBe(true);
});

test("批量栏展示布局选择并在窗口动作冲突时禁用", () => {
  const { handlers, props } = createBulkActionBarProps({
    selection: {
      selectedCount: 2,
      selectedProfiles: [profile("account-001", "主号"), profile("account-002", "小号")]
    },
    windowActions: { runningProfileIds: ["account-001"] }
  });

  render(<BulkActionBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

  const preset = screen.getByLabelText("布局") as HTMLSelectElement;
  expect(preset.value).toBe("grid");
  expect(screen.getByRole("option", { name: "自动网格" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "双列" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "左主右辅" })).toBeTruthy();
  fireEvent.change(preset, { target: { value: "left-main" } });
  expect(handlers.onTileLayoutPresetChange).toHaveBeenCalledWith("left-main");

  const { props: conflictProps } = createBulkActionBarProps({
    selection: props.selection,
    windowActions: { runningProfileIds: ["account-001"], windowQuitting: true }
  });
  render(<BulkActionBar {...conflictProps} />);
  fireEvent.click(screen.getAllByRole("button", { name: "更多操作" })[1]);
  expect((screen.getAllByLabelText("布局")[1] as HTMLSelectElement).disabled).toBe(true);
});

test("批量栏会说明未选择账号和空网址会打开新标签", () => {
  const { props } = createBulkActionBarProps();

  const { rerender } = render(
    <BulkActionBar {...props} />
  );

  expect(screen.getByText("先勾选账号，再批量打开网址或新标签。")).toBeTruthy();
  expect((screen.getByRole("button", { name: "打开新标签" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("请选择至少 1 个账号。")).toBeTruthy();

  rerender(
    <BulkActionBar
      {...props}
      selection={{
        ...props.selection,
        selectedCount: 2,
        selectedProfiles: [profile("account-001", "主号"), profile("account-002", "小号")]
      }}
    />
  );

  expect(screen.getByText("将为 2 个账号打开空白新标签。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "打开新标签" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.getByRole("option", { name: "无选中运行账号" })).toBeTruthy();
});

test("批量删除确认弹窗保留两种危险操作流程", () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  render(
    <BatchDeleteConfirmDialog
      profiles={[profile("account-001", "主号"), profile("account-002", "小号")]}
      working={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );

  expect(screen.getByRole("heading", { name: "确认批量删除账号" })).toBeTruthy();
  expect(screen.getByText("将删除 2 个账号。")).toBeTruthy();

  const actions = screen.getByText("将删除 2 个账号。").nextElementSibling as HTMLElement;
  fireEvent.click(within(actions).getByRole("button", { name: "只删除记录" }));
  fireEvent.click(within(actions).getByRole("button", { name: "删除记录和文件夹" }));

  expect(onConfirm).toHaveBeenCalledWith("record");
  expect(onConfirm).toHaveBeenCalledWith("data");
});

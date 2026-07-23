import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { BrowserLaunchEvent } from "../browserSessionLaunch";
import type { BrowserOperation } from "../browserOperations";
import type { ChromeProfile } from "../types";
import { BatchDeleteConfirmDialog } from "./BatchDeleteConfirmDialog";
import { BulkActionBar } from "./BulkActionBar";

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

test("批量栏保留打开、重试、停止和更多操作入口", () => {
  const handlers = {
    onBulkTagChange: vi.fn(),
    onBulkUrlChange: vi.fn(),
    onBulkOpenIntervalChange: vi.fn(),
    onLayoutSourceProfileChange: vi.fn(),
    onAppendTags: vi.fn(),
    onAddFavoriteUrl: vi.fn(),
    onRemoveFavoriteUrl: vi.fn(),
    onOpenUrl: vi.fn(),
    onRetryFailures: vi.fn(),
    onInspectWindows: vi.fn(),
    onTileWindows: vi.fn(),
    onSyncLayout: vi.fn(),
    onFocusWindows: vi.fn(),
    onStopOpenQueue: vi.fn(),
    onRequestDelete: vi.fn(),
    onClear: vi.fn()
  };

  const props = {
    selectedCount: 2,
    bulkTag: "",
    bulkUrl: "galxe.com",
    bulkOpenIntervalSeconds: "3",
    windowInspecting: false,
    windowTiling: false,
    windowSyncing: false,
    windowFocusing: false,
    selectedProfiles: [profile("account-001", "主号"), profile("account-002", "小号")],
    runningProfileIds: ["account-001"],
    layoutSourceProfileId: "account-001",
    browserOperations: [] as BrowserOperation[],
    launchEvents: [] as BrowserLaunchEvent[],
    favoriteUrls: ["https://galxe.com"],
    recentUrls: ["https://zealy.io"],
    retryFailureCount: 1,
    ...handlers
  };
  const { rerender } = render(
    <BulkActionBar
      bulkOpenRunning={true}
      {...props}
    />
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
      bulkOpenRunning={false}
      {...props}
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

test("批量栏会说明未选择账号和空网址会打开新标签", () => {
  const handlers = {
    onBulkTagChange: vi.fn(),
    onBulkUrlChange: vi.fn(),
    onBulkOpenIntervalChange: vi.fn(),
    onLayoutSourceProfileChange: vi.fn(),
    onAppendTags: vi.fn(),
    onAddFavoriteUrl: vi.fn(),
    onRemoveFavoriteUrl: vi.fn(),
    onOpenUrl: vi.fn(),
    onRetryFailures: vi.fn(),
    onInspectWindows: vi.fn(),
    onTileWindows: vi.fn(),
    onSyncLayout: vi.fn(),
    onFocusWindows: vi.fn(),
    onStopOpenQueue: vi.fn(),
    onRequestDelete: vi.fn(),
    onClear: vi.fn()
  };

  const { rerender } = render(
    <BulkActionBar
      selectedCount={0}
      bulkTag=""
      bulkUrl=""
      bulkOpenIntervalSeconds="3"
      bulkOpenRunning={false}
      windowInspecting={false}
      windowTiling={false}
      windowSyncing={false}
      windowFocusing={false}
      selectedProfiles={[]}
      runningProfileIds={[]}
      layoutSourceProfileId=""
      browserOperations={[]}
      launchEvents={[]}
      favoriteUrls={[]}
      recentUrls={[]}
      retryFailureCount={0}
      {...handlers}
    />
  );

  expect(screen.getByText("先勾选账号，再批量打开网址或新标签。")).toBeTruthy();
  expect((screen.getByRole("button", { name: "打开新标签" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("请选择至少 1 个账号。")).toBeTruthy();

  rerender(
    <BulkActionBar
      selectedCount={2}
      bulkTag=""
      bulkUrl=""
      bulkOpenIntervalSeconds="3"
      bulkOpenRunning={false}
      windowInspecting={false}
      windowTiling={false}
      windowSyncing={false}
      windowFocusing={false}
      selectedProfiles={[profile("account-001", "主号"), profile("account-002", "小号")]}
      runningProfileIds={[]}
      layoutSourceProfileId=""
      browserOperations={[]}
      launchEvents={[]}
      favoriteUrls={[]}
      recentUrls={[]}
      retryFailureCount={0}
      {...handlers}
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

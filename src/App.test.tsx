import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { normalizeSettings, profileApi, type BrowserSessionSnapshot } from "./api";
import App from "./App";
import type { ChromeProfile, ProfileDocument, RootHealthReport } from "./types";

interface TestProject {
  id: string;
  name: string;
  url: string;
  urls: TestProjectUrl[];
  notes: string;
  profileIds: string[];
  intervalSeconds: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

interface TestProjectUrl {
  id: string;
  name: string;
  url: string;
  notes: string;
}

describe("App launcher layout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("旧常用网址会迁移为结构化网址库", () => {
    const settings = normalizeSettings({
      browserPath: "/Applications/Google Chrome.app",
      favoriteUrls: ["galxe.com", "https://galxe.com", "zealy.io"],
      recentUrls: [],
      urlLibrary: [],
      theme: "light"
    });

    expect(settings.favoriteUrls).toEqual(["https://galxe.com", "https://zealy.io"]);
    expect(settings.urlLibrary).toMatchObject([
      { name: "galxe.com", url: "https://galxe.com" },
      { name: "zealy.io", url: "https://zealy.io" }
    ]);
  });

  test("超大顺序 ID 不会让冲突重分配生成重复 ID", async () => {
    const { nextSequentialId } = (await import("./App")) as typeof import("./App") & {
      nextSequentialId: (prefix: string, entities: Array<{ id: string }>) => string;
    };

    expect(
      nextSequentialId("url-", [
        { id: "url-001" },
        { id: "url-002" },
        { id: "url-9007199254740992" }
      ])
    ).toBe("url-003");
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith([
          profile({
            id: "account-001",
            name: "主号",
            tags: ["Gmail", "TG"],
            notes: "Google 已登录"
          }),
          profile({
            id: "account-002",
            name: "抽奖号",
            status: "needs_check",
            tags: ["X", "DC"]
          })
        ])
      )
    );
  });

  test("点击打开按钮会直接启动对应 Chrome profile", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));

    expect(await screen.findByText("已启动 主号")).toBeTruthy();
    await waitFor(() => {
      const stored = savedDocument();
      expect(stored.profiles[0].lastOpenedAt).not.toBeNull();
    });
  });

  test("单个账号启动后会在更多操作里显示最近启动记录", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue(
      "/tmp/account-001"
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));
    await screen.findByText("已启动 主号");
    await user.click(screen.getByRole("button", { name: "更多操作" }));

    const launchList = screen.getByRole("list", { name: "最近启动记录" });
    expect(within(launchList).getByText("主号")).toBeTruthy();
    expect(within(launchList).getByText("账号")).toBeTruthy();
    expect(within(launchList).getByText("成功")).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("启动页会加载持久化最近启动记录", async () => {
    const user = userEvent.setup();
    const loadLaunchEventsSpy = vi
      .spyOn(profileApi as typeof profileApi & {
        loadBrowserLaunchEvents: typeof profileApi.loadBrowserLaunchEvents;
      }, "loadBrowserLaunchEvents")
      .mockResolvedValue([
        {
          profileId: "account-001",
          profileName: "主号",
          sourceLabel: "批量打开",
          url: "https://galxe.com",
          ok: true,
          message: "已启动",
          finishedAt: 1000
        }
      ]);
    render(<App />);

    await screen.findByText("根目录正常");
    await user.click(screen.getByRole("button", { name: "更多操作" }));

    const launchList = screen.getByRole("list", { name: "最近启动记录" });
    expect(within(launchList).getByText("主号")).toBeTruthy();
    expect(within(launchList).getByText("批量打开")).toBeTruthy();
    expect(within(launchList).getByText("galxe.com")).toBeTruthy();
    expect(loadLaunchEventsSpy).toHaveBeenCalledWith("~/MultiChromeProfiles");
    loadLaunchEventsSpy.mockRestore();
  });

  test("新增启动记录会写入持久化最近启动记录", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/account-001");
    vi.spyOn(profileApi as typeof profileApi & {
      loadBrowserLaunchEvents: typeof profileApi.loadBrowserLaunchEvents;
    }, "loadBrowserLaunchEvents").mockResolvedValue([]);
    const saveLaunchEventsSpy = vi
      .spyOn(profileApi as typeof profileApi & {
        saveBrowserLaunchEvents: typeof profileApi.saveBrowserLaunchEvents;
      }, "saveBrowserLaunchEvents")
      .mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));

    await waitFor(() => {
      expect(saveLaunchEventsSpy).toHaveBeenCalledWith(
        "~/MultiChromeProfiles",
        expect.arrayContaining([
          expect.objectContaining({
            profileId: "account-001",
            profileName: "主号",
            sourceLabel: "账号",
            ok: true
          })
        ])
      );
    });
    vi.restoreAllMocks();
  });

  test("连续启动账号时最近启动记录会按顺序串行保存", async () => {
    const user = userEvent.setup();
    let releaseFirstSave: (() => void) | null = null;
    vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    vi.spyOn(profileApi as typeof profileApi & {
      loadBrowserLaunchEvents: typeof profileApi.loadBrowserLaunchEvents;
    }, "loadBrowserLaunchEvents").mockResolvedValue([]);
    const saveLaunchEventsSpy = vi
      .spyOn(profileApi as typeof profileApi & {
        saveBrowserLaunchEvents: typeof profileApi.saveBrowserLaunchEvents;
      }, "saveBrowserLaunchEvents")
      .mockImplementation(() => {
        if (!releaseFirstSave) {
          return new Promise<void>((resolve) => {
            releaseFirstSave = resolve;
          });
        }
        return Promise.resolve();
      });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));
    await screen.findByText("已启动 主号");
    await user.click(screen.getByRole("button", { name: "打开 抽奖号" }));
    await screen.findByText("已启动 抽奖号");

    expect(saveLaunchEventsSpy).toHaveBeenCalledTimes(1);

    const releaseSave = releaseFirstSave as unknown as (() => void) | null;
    if (!releaseSave) {
      throw new Error("第一笔最近启动记录保存没有进入等待状态");
    }
    releaseSave();
    await waitFor(() => {
      expect(saveLaunchEventsSpy).toHaveBeenCalledTimes(2);
    });
    expect(saveLaunchEventsSpy.mock.calls[1][1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: "account-001" }),
        expect.objectContaining({ profileId: "account-002" })
      ])
    );
    vi.restoreAllMocks();
  });

  test("启动命令成功后先标记为启动中而不是运行中", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue(
      "~/MultiChromeProfiles/profiles/account-001"
    );
    render(<App />);

    const card = await screen.findByRole("button", { name: "选择 主号" });

    await user.click(screen.getByRole("button", { name: "打开 主号" }));

    expect(within(card).getByText("启动中")).toBeTruthy();
    expect(within(card).queryByText("运行中")).toBeNull();
    expect(screen.queryByRole("button", { name: "切换到 主号" })).toBeNull();
    expect(openProfileSpy).toHaveBeenCalledOnce();
    openProfileSpy.mockRestore();
  });

  test("启动后会短延迟刷新会话并确认运行状态", async () => {
    vi.useFakeTimers();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue(
      "~/MultiChromeProfiles/profiles/account-001"
    );
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ])
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ]);
    render(<App />);

    await flushPromises();
    const card = screen.getByRole("button", { name: "选择 主号" });

    fireEvent.click(screen.getByRole("button", { name: "打开 主号" }));
    await flushPromises();

    expect(within(card).getByText("启动中")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushPromises();

    expect(within(card).getByText("运行中")).toBeTruthy();
    expect(snapshotSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenCalledOnce();
    openProfileSpy.mockRestore();
    snapshotSpy.mockRestore();
  });

  test("启动确认扫到停止时会短暂保留启动中状态", async () => {
    vi.useFakeTimers();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue(
      "~/MultiChromeProfiles/profiles/account-001"
    );
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ])
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ]);
    render(<App />);

    await flushPromises();
    const card = screen.getByRole("button", { name: "选择 主号" });

    fireEvent.click(screen.getByRole("button", { name: "打开 主号" }));
    await flushPromises();

    expect(within(card).getByText("启动中")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushPromises();

    expect(within(card).getByText("启动中")).toBeTruthy();
    expect(within(card).queryByText("运行中")).toBeNull();
    expect(snapshotSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenCalledOnce();
    openProfileSpy.mockRestore();
    snapshotSpy.mockRestore();
  });

  test("启动确认刷新失败不会清空已有运行状态", async () => {
    vi.useFakeTimers();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue(
      "~/MultiChromeProfiles/profiles/account-001"
    );
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", true)
      ])
      .mockRejectedValueOnce(new Error("ps failed"));
    render(<App />);

    await flushPromises();
    const firstCard = screen.getByRole("button", { name: "选择 主号" });
    const secondCard = screen.getByRole("button", { name: "选择 抽奖号" });
    expect(within(secondCard).getByText("运行中")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开 主号" }));
    await flushPromises();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushPromises();

    expect(within(firstCard).getByText("启动中")).toBeTruthy();
    expect(within(secondCard).getByText("运行中")).toBeTruthy();
    expect(snapshotSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenCalledOnce();
    openProfileSpy.mockRestore();
    snapshotSpy.mockRestore();
  });

  test("较旧的会话快照晚返回时不会覆盖较新的运行状态", async () => {
    let resolveOlderSnapshot: (snapshots: BrowserSessionSnapshot[]) => void = () => {};
    let resolveNewerSnapshot: (snapshots: BrowserSessionSnapshot[]) => void = () => {};
    const olderSnapshot = new Promise<BrowserSessionSnapshot[]>((resolve) => {
      resolveOlderSnapshot = resolve;
    });
    const newerSnapshot = new Promise<BrowserSessionSnapshot[]>((resolve) => {
      resolveNewerSnapshot = resolve;
    });
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockReturnValueOnce(olderSnapshot)
      .mockReturnValueOnce(newerSnapshot);

    render(<App />);
    await waitFor(() => expect(snapshotSpy).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(snapshotSpy).toHaveBeenCalledTimes(2));

    resolveNewerSnapshot([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    await flushPromises();

    const card = screen.getByRole("button", { name: "选择 主号" });
    expect(within(card).getByText("运行中")).toBeTruthy();

    resolveOlderSnapshot([
      browserSessionSnapshot("account-001", false),
      browserSessionSnapshot("account-002", false)
    ]);
    await flushPromises();

    expect(within(card).getByText("运行中")).toBeTruthy();
    snapshotSpy.mockRestore();
  });

  test("账号卡片点击只切换选择，打开按钮才启动 profile", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile");
    render(<App />);

    const selectionCard = await screen.findByRole("button", { name: "选择 主号" });
    expect(screen.queryByRole("checkbox", { name: "选择 主号" })).toBeNull();

    await user.click(selectionCard);

    expect(openProfileSpy).not.toHaveBeenCalled();
    expect(screen.getByText("已选择 1 个账号")).toBeTruthy();
    expect(selectionCard.getAttribute("aria-pressed")).toBe("true");

    await user.click(selectionCard);

    expect(screen.getByText("未选择账号")).toBeTruthy();
    expect(selectionCard.getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "打开 主号" }));

    expect(await screen.findByText("已启动 主号")).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledTimes(1);
    openProfileSpy.mockRestore();
  });

  test("重复点击账号会再次请求打开同一 profile 的新标签", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile");
    render(<App />);

    const launchButton = await screen.findByRole("button", { name: "打开 主号" });
    await user.click(launchButton);
    await screen.findByText("已启动 主号");
    await user.click(launchButton);

    expect(await screen.findByText("已启动 主号")).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "chrome://newtab/"
    );
    expect(openProfileSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "chrome://newtab/"
    );
    openProfileSpy.mockRestore();
  });

  test("账号卡片显示正在运行的 Chrome profile", async () => {
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    render(<App />);

    const runningCard = await screen.findByRole("button", { name: "选择 主号" });
    const idleCard = await screen.findByRole("button", { name: "选择 抽奖号" });

    expect(within(runningCard).getByText("运行中")).toBeTruthy();
    expect(within(idleCard).queryByText("运行中")).toBeNull();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
  });

  test("账号卡片运行状态来自浏览器会话快照", async () => {
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue([
        {
          profileId: "account-001",
          status: "running",
          running: true,
          pid: 1201,
          debugPort: 19222,
          cdpStatus: "available",
          runtimeError: null,
          windowCount: null,
          windows: [],
          windowError: null,
          checkedAt: 1
        },
        {
          profileId: "account-002",
          status: "stopped",
          running: false,
          pid: null,
          debugPort: null,
          cdpStatus: "unknown",
          runtimeError: null,
          windowCount: 0,
          windows: [],
          windowError: null,
          checkedAt: 1
        }
      ]);
    render(<App />);

    const runningCard = await screen.findByRole("button", { name: "选择 主号" });
    const idleCard = await screen.findByRole("button", { name: "选择 抽奖号" });

    expect(within(runningCard).getByText("运行中")).toBeTruthy();
    expect(within(idleCard).queryByText("运行中")).toBeNull();
    expect(snapshotSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", [
      "account-001",
      "account-002"
    ], false);
    snapshotSpy.mockRestore();
  });

  test("关闭运行账号只调用选中且运行中的账号并刷新会话", async () => {
    const user = userEvent.setup();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ])
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", true)
      ])
      .mockResolvedValue([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ]);
    const quitSpy = vi.spyOn(profileApi, "quitProfileBrowser").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("button", { name: "关闭运行账号" }));

    await waitFor(() => {
      expect(quitSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-002");
    });
    expect(quitSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("已关闭 1 个运行账号")).toBeTruthy();
    expect(snapshotSpy.mock.calls.length).toBeGreaterThan(1);
    quitSpy.mockRestore();
    snapshotSpy.mockRestore();
  });

  test("关闭运行账号单个失败仍继续关闭其它账号并汇总刷新", async () => {
    const user = userEvent.setup();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", true)
      ])
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", true)
      ])
      .mockResolvedValue([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ]);
    const quitSpy = vi
      .spyOn(profileApi, "quitProfileBrowser")
      .mockRejectedValueOnce(new Error("退出失败"))
      .mockResolvedValueOnce();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("button", { name: "关闭运行账号" }));

    await waitFor(() => {
      expect(quitSpy).toHaveBeenNthCalledWith(
        1,
        "~/MultiChromeProfiles",
        "account-001"
      );
      expect(quitSpy).toHaveBeenNthCalledWith(
        2,
        "~/MultiChromeProfiles",
        "account-002"
      );
    });
    expect(await screen.findByText("已关闭 1 个运行账号，1 个失败")).toBeTruthy();
    expect(snapshotSpy.mock.calls.length).toBeGreaterThan(2);
    quitSpy.mockRestore();
    snapshotSpy.mockRestore();
  });

  test("重启运行账号只处理点击后 fresh running 的账号并按关闭后启动顺序执行", async () => {
    const user = userEvent.setup();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ])
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", true)
      ])
      .mockResolvedValue([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ]);
    const quitSpy = vi.spyOn(profileApi, "quitProfileBrowser").mockResolvedValue();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue(
      "/tmp/account-002"
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("button", { name: "重启运行账号" }));

    await waitFor(() => {
      expect(quitSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-002");
      expect(openProfileSpy).toHaveBeenCalledWith(
        "~/MultiChromeProfiles",
        "account-002",
        "/Applications/Google Chrome.app",
        "chrome://newtab/"
      );
    });
    expect(quitSpy).toHaveBeenCalledTimes(1);
    expect(openProfileSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("已重启 1 个运行账号")).toBeTruthy();
    await waitFor(() => {
      expect(savedDocument().profiles[1].lastOpenedAt).not.toBeNull();
    });
    expect(snapshotSpy.mock.calls.length).toBeGreaterThan(2);
  });

  test("重启运行账号单个关闭或启动失败仍继续处理其它账号并汇总", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", true)
      ])
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", true)
      ])
      .mockResolvedValue([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ]);
    vi.spyOn(profileApi, "quitProfileBrowser")
      .mockRejectedValueOnce(new Error("退出失败"))
      .mockResolvedValueOnce();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue(
      "/tmp/account-002"
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("button", { name: "重启运行账号" }));

    await waitFor(() => {
      expect(openProfileSpy).toHaveBeenCalledWith(
        "~/MultiChromeProfiles",
        "account-002",
        "/Applications/Google Chrome.app",
        "chrome://newtab/"
      );
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("已重启 1 个运行账号，1 个失败")).toBeTruthy();
  });

  test("重启准备期间快速点击关闭只允许第一个窗口动作进入后端", async () => {
    const user = userEvent.setup();
    const runningSnapshots = [
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", true)
    ];
    let resolveRefresh: (snapshots: BrowserSessionSnapshot[]) => void = () => undefined;
    const refreshPromise = new Promise<BrowserSessionSnapshot[]>((resolve) => {
      resolveRefresh = resolve;
    });
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce(runningSnapshots)
      .mockReturnValueOnce(refreshPromise)
      .mockResolvedValue(runningSnapshots);
    const quitSpy = vi.spyOn(profileApi, "quitProfileBrowser").mockResolvedValue();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue(
      "/tmp/profile"
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("button", { name: "重启运行账号" }));
    await user.click(screen.getByRole("button", { name: "关闭运行账号" }));

    resolveRefresh(runningSnapshots);
    await waitFor(() => expect(quitSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(openProfileSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const stored = savedDocument();
      expect(stored.profiles[0].lastOpenedAt).not.toBeNull();
      expect(stored.profiles[1].lastOpenedAt).not.toBeNull();
    });
    expect(snapshotSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("重启运行账号启动失败后继续处理后续账号且失败账号不更新打开时间", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", true)
      ])
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", true)
      ])
      .mockResolvedValue([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ]);
    vi.spyOn(profileApi, "quitProfileBrowser").mockResolvedValue();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockRejectedValueOnce(new Error("启动失败"))
      .mockResolvedValueOnce("/tmp/account-002");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("button", { name: "重启运行账号" }));

    await waitFor(() => expect(openProfileSpy).toHaveBeenCalledTimes(2));
    expect(openProfileSpy.mock.calls.map((call) => call[1])).toEqual([
      "account-001",
      "account-002"
    ]);
    await waitFor(() => {
      const stored = savedDocument();
      expect(stored.profiles[0].lastOpenedAt).toBeNull();
      expect(stored.profiles[1].lastOpenedAt).not.toBeNull();
    });
  });

  test("重启成功但保存打开时间失败时仍收口最近操作并提示保存失败", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([browserSessionSnapshot("account-001", true)])
      .mockResolvedValueOnce([browserSessionSnapshot("account-001", true)])
      .mockResolvedValue([
        browserSessionSnapshot("account-001", false)
      ]);
    vi.spyOn(profileApi, "quitProfileBrowser").mockResolvedValue();
    vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/account-001");
    vi.spyOn(profileApi, "saveProfiles").mockRejectedValue(new Error("保存失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("button", { name: "重启运行账号" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "已重启 1 个运行账号；保存打开时间失败：保存失败"
      );
    });
    const recentList = await screen.findByRole("list", { name: "最近操作记录" });
    expect(within(recentList).getByText("失败")).toBeTruthy();
    expect(within(recentList).queryByText("运行中")).toBeNull();
  });

  test("运行状态会轻量动态刷新并移除已退出账号", async () => {
    vi.useFakeTimers();
    const listRunningSpy = vi
      .spyOn(profileApi, "listRunningProfiles")
      .mockResolvedValueOnce(["account-001"])
      .mockResolvedValueOnce([]);
    render(<App />);

    await flushPromises();

    const runningCard = screen.getByRole("button", { name: "选择 主号" });
    expect(within(runningCard).getByText("运行中")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await flushPromises();

    expect(within(runningCard).queryByText("运行中")).toBeNull();
    expect(listRunningSpy).toHaveBeenCalledTimes(2);
    listRunningSpy.mockRestore();
  });

  test("运行状态轻量刷新失败时保留上一次会话状态", async () => {
    vi.useFakeTimers();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ])
      .mockRejectedValueOnce(new Error("ps failed"));
    render(<App />);

    await flushPromises();

    const runningCard = screen.getByRole("button", { name: "选择 主号" });
    expect(within(runningCard).getByText("运行中")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await flushPromises();

    expect(within(runningCard).getByText("运行中")).toBeTruthy();
    expect(snapshotSpy).toHaveBeenCalledTimes(2);
    snapshotSpy.mockRestore();
  });

  test("账号卡片不显示目录大小，编辑时只刷新当前账号大小", async () => {
    const sizeSpy = vi
      .spyOn(profileApi, "profileDirectorySize")
      .mockResolvedValue(160 * 1024 * 1024);
    const user = userEvent.setup();
    render(<App />);

    const card = await screen.findByRole("button", { name: "选择 主号" });

    expect(screen.queryByRole("button", { name: "刷新大小" })).toBeNull();
    expect(within(card).queryByText("未检测")).toBeNull();
    expect(within(card).queryByText(/MB/)).toBeNull();
    expect(sizeSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });

    expect(await within(dialog).findByText("目录大小：160.0 MB")).toBeTruthy();
    expect(sizeSpy).toHaveBeenCalledTimes(1);
    expect(sizeSpy).toHaveBeenCalledWith("~/MultiChromeProfiles/profiles/account-001");
    sizeSpy.mockRestore();
  });

  test("运行中的账号编辑弹窗可以读取浏览器标签页", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ]);
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "0123456789abcdef",
        type: "page",
        url: "https://example.com/runtime",
        title: "Runtime Home",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/0123456789abcdef",
        checkedAt: 1000
      },
      {
        targetId: "fedcba9876543210",
        type: "page",
        url: "https://example.com/runtime",
        title: "Runtime Duplicate",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/fedcba9876543210",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));

    expect(listTabsSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await within(dialog).findByText("Runtime Home")).toBeTruthy();
    expect(within(dialog).getAllByText("https://example.com/runtime")).toHaveLength(2);
    expect(within(dialog).queryByText("ws://127.0.0.1:9222/devtools/page/0123456789abcdef")).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "复制全部 2 个标签页网址" })
    );
    expect(writeText).toHaveBeenCalledWith(
      "https://example.com/runtime\nhttps://example.com/runtime"
    );
    expect(writeText).not.toHaveBeenCalledWith(
      "ws://127.0.0.1:9222/devtools/page/0123456789abcdef\nws://127.0.0.1:9222/devtools/page/fedcba9876543210"
    );
    expect(await screen.findByText("已复制全部标签页网址")).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", {
        name: "复制网址 Runtime Home https://example.com/runtime"
      })
    );
    expect(writeText).toHaveBeenCalledWith("https://example.com/runtime");
    expect(writeText).not.toHaveBeenCalledWith(
      "ws://127.0.0.1:9222/devtools/page/0123456789abcdef"
    );
    expect(await screen.findByText("已复制标签页网址")).toBeTruthy();
    snapshotSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("运行中的账号复制标签页网址时不支持剪贴板会提示既有文案", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: {},
      configurable: true
    });
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "clipboard-target",
        type: "page",
        url: "https://example.com/clipboard",
        title: "剪贴板测试",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/clipboard-target",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));
    await user.click(
      within(dialog).getByRole("button", {
        name: "复制网址 剪贴板测试 https://example.com/clipboard"
      })
    );

    expect(await screen.findByText("当前环境不能复制到剪贴板")).toBeTruthy();
  });

  test("运行中的账号复制标签页网址失败时显示错误且不抛出未处理异常", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("剪贴板拒绝"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "failure-target",
        type: "page",
        url: "https://example.com/failure",
        title: "失败测试",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/failure-target",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));
    await user.click(
      within(dialog).getByRole("button", {
        name: "复制网址 失败测试 https://example.com/failure"
      })
    );

    expect(await screen.findByText("剪贴板拒绝")).toBeTruthy();
    expect(screen.queryByText("复制网址失败：剪贴板拒绝")).toBeNull();
  });

  test("运行中的账号复制全部标签页网址时不支持剪贴板会提示既有文案", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: {},
      configurable: true
    });
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "clipboard-all-target",
        type: "page",
        url: "https://example.com/clipboard-all",
        title: "全量剪贴板测试",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/clipboard-all-target",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));
    await user.click(
      within(dialog).getByRole("button", { name: "复制全部 1 个标签页网址" })
    );

    expect(await screen.findByText("当前环境不能复制到剪贴板")).toBeTruthy();
  });

  test("运行中的账号复制全部标签页网址失败时显示错误且不抛出未处理异常", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("全量剪贴板拒绝"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "failure-all-target",
        type: "page",
        url: "https://example.com/failure-all",
        title: "全量失败测试",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/failure-all-target",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));
    await user.click(
      within(dialog).getByRole("button", { name: "复制全部 1 个标签页网址" })
    );

    expect(await screen.findByText("全量剪贴板拒绝")).toBeTruthy();
    expect(screen.queryByText("复制网址失败：全量剪贴板拒绝")).toBeNull();
  });

  test("运行中的账号可以复制全部标签页标题和网址", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true), browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      { targetId: "detail-1", type: "page", url: "chrome://newtab/", title: "新标签页", webSocketDebuggerUrl: "ws://secret-1", checkedAt: 1000 },
      { targetId: "detail-2", type: "page", url: "https://example.com/detail", title: " ", webSocketDebuggerUrl: "ws://secret-2", checkedAt: 1000 },
      { targetId: "detail-3", type: "page", url: "chrome://newtab/", title: "新标签页", webSocketDebuggerUrl: "ws://secret-3", checkedAt: 1000 }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));
    await user.click(within(dialog).getByRole("button", { name: "复制全部 3 个标签页标题和网址" }));

    expect(writeText).toHaveBeenCalledWith(
      "标题：新标签页\n网址：chrome://newtab/\n\n标题：未命名标签页\n网址：https://example.com/detail\n\n标题：新标签页\n网址：chrome://newtab/"
    );
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("ws://secret"));
    expect(await screen.findByText("已复制全部标签页标题和网址")).toBeTruthy();
  });

  test("复制全部标签页详情在剪贴板不可用时沿用既有错误语义", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: {}, configurable: true });
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true), browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      { targetId: "detail-failure", type: "page", url: "https://example.com/detail", title: "详情", webSocketDebuggerUrl: null, checkedAt: 1000 }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));
    await user.click(within(dialog).getByRole("button", { name: "复制全部 1 个标签页标题和网址" }));
    expect(await screen.findByText("当前环境不能复制到剪贴板")).toBeTruthy();
  });

  test("复制全部标签页详情在剪贴板拒绝时显示错误", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("详情剪贴板拒绝")) },
      configurable: true
    });
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true), browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      { targetId: "detail-reject", type: "page", url: "https://example.com/detail", title: "详情", webSocketDebuggerUrl: null, checkedAt: 1000 }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));
    await user.click(within(dialog).getByRole("button", { name: "复制全部 1 个标签页标题和网址" }));
    expect(await screen.findByText("详情剪贴板拒绝")).toBeTruthy();
  });

  test("运行中的账号可以将标签页预填为未持久化的网址草稿", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "url-draft-target",
        type: "page",
        url: "https://example.com/draft",
        title: "标签页草稿",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/url-draft-target",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const accountDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(accountDialog).getByRole("button", { name: "读取标签页" }));
    await user.click(
      within(accountDialog).getByRole("button", {
        name: "存为网址草稿 标签页草稿 https://example.com/draft"
      })
    );

    expect(screen.queryByRole("dialog", { name: "编辑 主号" })).toBeNull();
    const urlDraftDialog = await screen.findByRole("dialog", { name: "新建网址" });
    expect((within(urlDraftDialog).getByLabelText("网址名称") as HTMLInputElement).value).toBe(
      "标签页草稿"
    );
    expect((within(urlDraftDialog).getByLabelText("网址 URL") as HTMLInputElement).value).toBe(
      "https://example.com/draft"
    );
    expect((within(urlDraftDialog).getByLabelText("网址标签") as HTMLInputElement).value).toBe("");
    expect((within(urlDraftDialog).getByLabelText("网址备注") as HTMLTextAreaElement).value).toBe("");
    expect(savedDocument().settings.urlLibrary).toEqual([]);

    await user.click(within(urlDraftDialog).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog", { name: "新建网址" })).toBeNull();
    expect(savedDocument().settings.urlLibrary).toEqual([]);
  });

  test("空标题标签页存为网址草稿时使用网址展示名并在保存后才写入", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "empty-title-draft-target",
        type: "page",
        url: "https://example.com/path?source=runtime",
        title: " ",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/empty-title-draft-target",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const accountDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(accountDialog).getByRole("button", { name: "读取标签页" }));
    await user.click(
      within(accountDialog).getByRole("button", {
        name: "存为网址草稿 未命名标签页 https://example.com/path?source=runtime"
      })
    );

    const urlDraftDialog = await screen.findByRole("dialog", { name: "新建网址" });
    expect((within(urlDraftDialog).getByLabelText("网址名称") as HTMLInputElement).value).toBe(
      "example.com/path?source=runtime"
    );
    expect(savedDocument().settings.urlLibrary).toEqual([]);

    await user.click(within(urlDraftDialog).getByRole("button", { name: "保存网址" }));

    expect(await screen.findByText("已保存网址")).toBeTruthy();
    expect(savedDocument().settings.urlLibrary[0]).toMatchObject({
      name: "example.com/path?source=runtime",
      url: "https://example.com/path?source=runtime",
      tags: [],
      notes: ""
    });
  });

  test("真实标题为未命名标签页时存为网址草稿会保留该标题", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "literal-unnamed-title-target",
        type: "page",
        url: "https://example.com/literal-title",
        title: "未命名标签页",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/literal-unnamed-title-target",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const accountDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(accountDialog).getByRole("button", { name: "读取标签页" }));
    await user.click(
      within(accountDialog).getByRole("button", {
        name: "存为网址草稿 未命名标签页 https://example.com/literal-title"
      })
    );

    const urlDraftDialog = await screen.findByRole("dialog", { name: "新建网址" });
    expect((within(urlDraftDialog).getByLabelText("网址名称") as HTMLInputElement).value).toBe(
      "未命名标签页"
    );
  });

  test("运行中的账号可以将标签页预填为未持久化的项目草稿", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "project-draft-first",
        type: "page",
        url: "https://example.com/first",
        title: "项目主页",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/project-draft-first",
        checkedAt: 1000
      },
      {
        targetId: "project-draft-empty-title",
        type: "page",
        url: "https://example.com/second?source=runtime",
        title: " ",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/project-draft-empty-title",
        checkedAt: 1000
      },
      {
        targetId: "project-draft-literal-title",
        type: "page",
        url: "https://example.com/first",
        title: "未命名标签页",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/project-draft-literal-title",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const accountDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(accountDialog).getByRole("button", { name: "读取标签页" }));
    await user.click(within(accountDialog).getByRole("button", { name: "存为项目草稿" }));

    expect(screen.queryByRole("dialog", { name: "编辑 主号" })).toBeNull();
    const projectDialog = await screen.findByRole("dialog", { name: "新建项目" });
    expect((within(projectDialog).getByLabelText("项目名称") as HTMLInputElement).value).toBe(
      "来自 主号 的标签页"
    );
    expect((within(projectDialog).getByLabelText("网址名称 1") as HTMLInputElement).value).toBe(
      "项目主页"
    );
    expect((within(projectDialog).getByLabelText("项目网址") as HTMLInputElement).value).toBe(
      "https://example.com/first"
    );
    expect((within(projectDialog).getByLabelText("网址名称 2") as HTMLInputElement).value).toBe(
      "example.com/second?source=runtime"
    );
    expect((within(projectDialog).getByLabelText("项目网址 2") as HTMLInputElement).value).toBe(
      "https://example.com/second?source=runtime"
    );
    expect((within(projectDialog).getByLabelText("网址名称 3") as HTMLInputElement).value).toBe(
      "未命名标签页"
    );
    expect((within(projectDialog).getByLabelText("项目网址 3") as HTMLInputElement).value).toBe(
      "https://example.com/first"
    );
    expect(
      within(projectDialog).getByRole("button", { name: "绑定账号 主号 account-001" })
        .getAttribute("aria-pressed")
    ).toBe("false");
    expect(savedDocument().projects).toEqual([]);

    await user.click(within(projectDialog).getByRole("button", { name: "取消新建项目" }));

    expect(screen.queryByRole("dialog", { name: "新建项目" })).toBeNull();
    expect(savedDocument().projects).toEqual([]);
  });

  test("运行中的账号从标签页保存项目草稿时才写入且不绑定账号", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "project-draft-save",
        type: "page",
        url: "https://example.com/save",
        title: "保存项目标签页",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/project-draft-save",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const accountDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(accountDialog).getByRole("button", { name: "读取标签页" }));
    await user.click(within(accountDialog).getByRole("button", { name: "存为项目草稿" }));
    const projectDialog = await screen.findByRole("dialog", { name: "新建项目" });

    expect(savedDocument().projects).toEqual([]);
    await user.click(within(projectDialog).getByRole("button", { name: "保存项目" }));

    expect(await screen.findByText("已创建 来自 主号 的标签页")).toBeTruthy();
    expect(savedDocument().projects[0]).toMatchObject({
      name: "来自 主号 的标签页",
      url: "https://example.com/save",
      profileIds: [],
      notes: ""
    });
    expect(savedDocument().projects[0]?.urls).toEqual([
      {
        id: "url-001",
        name: "保存项目标签页",
        url: "https://example.com/save",
        notes: ""
      }
    ]);
  });

  test("Runtime 非 http(s) 标签页不能进入网址草稿或项目草稿", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "chrome-newtab",
        type: "page",
        url: "chrome://newtab/",
        title: "新标签页",
        webSocketDebuggerUrl: null,
        checkedAt: 1000
      },
      {
        targetId: "about-blank",
        type: "page",
        url: "about:blank",
        title: "空白页",
        webSocketDebuggerUrl: null,
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const accountDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(accountDialog).getByRole("button", { name: "读取标签页" }));

    expect(
      within(accountDialog).queryByRole("button", {
        name: "存为网址草稿 新标签页 chrome://newtab/"
      })
    ).toBeNull();
    expect(within(accountDialog).queryByRole("button", { name: "存为项目草稿" })).toBeNull();
    expect(savedDocument().settings.urlLibrary).toEqual([]);
    expect(savedDocument().projects).toEqual([]);
  });

  test("Runtime 混合标签页保存项目时只持久化 http(s) URL", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "chrome-newtab",
        type: "page",
        url: "chrome://newtab/",
        title: "新标签页",
        webSocketDebuggerUrl: null,
        checkedAt: 1000
      },
      {
        targetId: "valid-first",
        type: "page",
        url: "https://example.com/first",
        title: "第一页",
        webSocketDebuggerUrl: null,
        checkedAt: 1000
      },
      {
        targetId: "about-blank",
        type: "page",
        url: "about:blank",
        title: "空白页",
        webSocketDebuggerUrl: null,
        checkedAt: 1000
      },
      {
        targetId: "valid-duplicate",
        type: "page",
        url: "https://example.com/first",
        title: "重复页",
        webSocketDebuggerUrl: null,
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const accountDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(accountDialog).getByRole("button", { name: "读取标签页" }));
    await user.click(within(accountDialog).getByRole("button", { name: "存为项目草稿" }));
    const projectDialog = await screen.findByRole("dialog", { name: "新建项目" });

    expect((within(projectDialog).getByLabelText("项目网址") as HTMLInputElement).value).toBe(
      "https://example.com/first"
    );
    expect((within(projectDialog).getByLabelText("项目网址 2") as HTMLInputElement).value).toBe(
      "https://example.com/first"
    );
    expect(within(projectDialog).queryByLabelText("项目网址 3")).toBeNull();

    await user.click(within(projectDialog).getByRole("button", { name: "保存项目" }));

    expect(savedDocument().projects[0]?.urls.map((projectUrl: any) => projectUrl.url)).toEqual([
      "https://example.com/first",
      "https://example.com/first"
    ]);
  });

  test("运行账号缺少调试端口时不允许编辑弹窗读取标签页", async () => {
    const user = userEvent.setup();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue([
        {
          ...browserSessionSnapshot("account-001", true),
          debugPort: null,
          cdpStatus: "missing-port"
        },
        browserSessionSnapshot("account-002", false)
      ]);
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    expect(
      within(dialog).getByText("重新打开账号以启用标签页读取")
    ).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", { name: "读取标签页" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(listTabsSpy).not.toHaveBeenCalled();
    snapshotSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("运行中的账号可以切换到对应 Chrome 进程", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    const runningCard = await screen.findByRole("button", { name: "选择 主号" });
    const idleCard = await screen.findByRole("button", { name: "选择 抽奖号" });

    expect(within(runningCard).getByText("运行中")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "切换到 抽奖号" })
    ).toBeNull();

    await user.click(await screen.findByRole("button", { name: "切换到 主号" }));

    expect(within(idleCard).queryByText("运行中")).toBeNull();
    expect(focusSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await screen.findByText("已切换到 主号")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    focusSpy.mockRestore();
  });

  test("账号卡片切换到主号会清空窗口状态面板", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    vi.spyOn(profileApi, "listProfileWindows").mockResolvedValue([
      { index: 1, title: "Chrome", x: 12, y: 34, width: 1280, height: 720 }
    ]);
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));
    expect(await screen.findByText("1280x720 @ 12,34")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "切换到 主号" }));
    expect(focusSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await screen.findByText("已切换到 主号")).toBeTruthy();
    expect(screen.queryByText("1280x720 @ 12,34")).toBeNull();
    expect(screen.getByText("点击检查窗口读取选中运行账号的窗口状态")).toBeTruthy();
  });

  test("切换窗口失败时会提示 macOS 辅助功能权限", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const focusSpy = vi
      .spyOn(profileApi, "focusProfileWindow")
      .mockRejectedValue(new Error("Not authorized to send Apple events to System Events"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "切换到 主号" }));

    expect(
      await screen.findByText(
        "窗口操作失败：可能需要在 macOS 系统设置 > 隐私与安全性 > 辅助功能 中允许 MultiChrome 控制电脑。原始错误：Not authorized to send Apple events to System Events"
      )
    ).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    focusSpy.mockRestore();
  });

  test("osascript 辅助功能失败时会提示允许 osascript", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockRejectedValue(
        new Error(
          "检查窗口失败：139:839: execution error: “System Events”遇到一个错误：“osascript”不允许辅助访问。 (-25211)"
        )
      );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));

    expect(
      await screen.findByText(
        "窗口操作失败：macOS 当前拦截的是 /usr/bin/osascript。请在系统设置 > 隐私与安全性 > 辅助功能 中同时允许 MultiChrome 和 /usr/bin/osascript。原始错误：检查窗口失败：139:839: execution error: “System Events”遇到一个错误：“osascript”不允许辅助访问。 (-25211)"
      )
    ).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("批量栏可以检查选中运行账号的窗口数量", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValue([
        {
          index: 1,
          title: "Galxe",
          x: 12,
          y: 34,
          width: 1280,
          height: 720
        }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(1);
    expect(listWindowsSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await screen.findByText("窗口检查：主号 1 个窗口（1280x720 @ 12,34）")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "窗口状态" })).toBeTruthy();
    expect(screen.getByText("可读窗口")).toBeTruthy();
    expect(screen.getByText("1280x720 @ 12,34")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("切换选择后会清空窗口状态面板", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValue([{ index: 1, title: "Chrome", x: 12, y: 34, width: 1280, height: 720 }]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));
    expect(await screen.findByText("1280x720 @ 12,34")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    expect(screen.queryByText("1280x720 @ 12,34")).toBeNull();
    expect(screen.getByText("点击检查窗口读取选中运行账号的窗口状态")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("检查失败会清空已有窗口状态面板", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        { index: 1, title: "Chrome", x: 12, y: 34, width: 1280, height: 720 }
      ])
      .mockRejectedValueOnce(new Error("检查窗口失败：读取失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));
    expect(await screen.findByText("1280x720 @ 12,34")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "检查窗口" }));
    expect(await screen.findByText(/窗口操作失败/)).toBeTruthy();
    expect(screen.queryByText("1280x720 @ 12,34")).toBeNull();
    expect(screen.getByText("点击检查窗口读取选中运行账号的窗口状态")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("检查时发现没有运行账号会清空已有窗口状态面板", async () => {
    const user = userEvent.setup();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue([browserSessionSnapshot("account-001", true)]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValue([
        { index: 1, title: "Chrome", x: 12, y: 34, width: 1280, height: 720 }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));
    expect(await screen.findByText("1280x720 @ 12,34")).toBeTruthy();

    snapshotSpy.mockResolvedValue([browserSessionSnapshot("account-001", false)]);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));
    expect(await screen.findByText("选中的账号没有运行窗口")).toBeTruthy();
    expect(screen.queryByText("1280x720 @ 12,34")).toBeNull();
    expect(screen.getByText("点击检查窗口读取选中运行账号的窗口状态")).toBeTruthy();
    snapshotSpy.mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("检查期间切换选择后不会写回旧窗口状态", async () => {
    const user = userEvent.setup();
    const pendingWindows = deferred<Awaited<ReturnType<typeof profileApi.listProfileWindows>>>();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockReturnValueOnce(pendingWindows.promise);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));
    await waitFor(() => expect(listWindowsSpy).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    pendingWindows.resolve([
      { index: 1, title: "Chrome", x: 12, y: 34, width: 1280, height: 720 }
    ]);
    await flushPromises();

    expect(screen.queryByText("1280x720 @ 12,34")).toBeNull();
    expect(screen.getByText("点击检查窗口读取选中运行账号的窗口状态")).toBeTruthy();
    snapshotSpy.mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("窗口动作开始后会使旧窗口状态面板失效", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockResolvedValue([
      browserSessionSnapshot("account-001", true)
    ]);
    vi.spyOn(profileApi, "listProfileWindows").mockResolvedValue([
      { index: 1, title: "Chrome", x: 12, y: 34, width: 1280, height: 720 }
    ]);
    vi.spyOn(profileApi, "setProfileWindowBounds").mockResolvedValue();
    vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));
    expect(await screen.findByText("1280x720 @ 12,34")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "平铺窗口" }));
    expect(screen.queryByText("1280x720 @ 12,34")).toBeNull();
    expect(screen.getByText("点击检查窗口读取选中运行账号的窗口状态")).toBeTruthy();
  });

  test("检查窗口完成后会登记窗口操作", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValue([
        {
          index: 1,
          title: "Galxe",
          x: 12,
          y: 34,
          width: 1280,
          height: 720
        }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));

    expect(await screen.findByText("窗口检查：主号 1 个窗口（1280x720 @ 12,34）")).toBeTruthy();
    const operationList = await screen.findByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("成功")).toBeTruthy();
    expect(within(operationList).getByText("窗口操作")).toBeTruthy();
    expect(within(operationList).getByText("检查窗口")).toBeTruthy();
    expect(within(operationList).getByText("1 个账号")).toBeTruthy();
    expect(within(operationList).getByText("结果：已检查 1 / 1")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("窗口操作前会刷新轻量会话状态", async () => {
    const user = userEvent.setup();
    const idleSnapshots = [
      browserSessionSnapshot("account-001", false),
      browserSessionSnapshot("account-002", false)
    ];
    const runningSnapshots = [
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ];
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue(idleSnapshots);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValue([
        {
          index: 1,
          title: "Galxe",
          x: 12,
          y: 34,
          width: 1280,
          height: 720
        }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    expect(
      within(screen.getByRole("button", { name: "选择 主号" })).queryByText("运行中")
    ).toBeNull();

    snapshotSpy.mockResolvedValue(runningSnapshots);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));

    expect(snapshotSpy).toHaveBeenLastCalledWith(
      "~/MultiChromeProfiles",
      ["account-001", "account-002"],
      false
    );
    expect(listWindowsSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await screen.findByText("窗口检查：主号 1 个窗口（1280x720 @ 12,34）")).toBeTruthy();
    snapshotSpy.mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("窗口操作会使用自身刷新结果，即使后续后台快照占用最新序号", async () => {
    const user = userEvent.setup();
    let resolveOperationSnapshot: (snapshots: BrowserSessionSnapshot[]) => void = () => {};
    let resolveBackgroundSnapshot: (snapshots: BrowserSessionSnapshot[]) => void = () => {};
    const operationSnapshot = new Promise<BrowserSessionSnapshot[]>((resolve) => {
      resolveOperationSnapshot = resolve;
    });
    const backgroundSnapshot = new Promise<BrowserSessionSnapshot[]>((resolve) => {
      resolveBackgroundSnapshot = resolve;
    });
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ])
      .mockReturnValueOnce(operationSnapshot)
      .mockReturnValueOnce(backgroundSnapshot);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValue([
        {
          index: 1,
          title: "Galxe",
          x: 12,
          y: 34,
          width: 1280,
          height: 720
        }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    fireEvent.click(screen.getByRole("button", { name: "检查窗口" }));
    await waitFor(() => expect(snapshotSpy).toHaveBeenCalledTimes(2));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(snapshotSpy).toHaveBeenCalledTimes(3));

    resolveOperationSnapshot([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    await flushPromises();

    expect(listWindowsSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await screen.findByText("窗口检查：主号 1 个窗口（1280x720 @ 12,34）")).toBeTruthy();

    resolveBackgroundSnapshot([
      browserSessionSnapshot("account-001", true),
      browserSessionSnapshot("account-002", false)
    ]);
    await flushPromises();

    snapshotSpy.mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("窗口检查会提示首个窗口已最小化", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValue([
        {
          index: 1,
          title: "Galxe",
          x: 12,
          y: 34,
          width: 1280,
          height: 720,
          minimized: true
        }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "检查窗口" }));

    expect(
      await screen.findByText("窗口检查：主号 1 个窗口（1280x720 @ 12,34，已最小化）")
    ).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("批量栏可以平铺选中运行账号的首个窗口", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 1200
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 800
    });
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 600,
          y: 0,
          width: 600,
          height: 800
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(4);
    expect(setBoundsSpy).toHaveBeenCalledTimes(2);
    expect(setBoundsSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001",
      { x: 0, y: 0, width: 600, height: 800 }
    );
    expect(setBoundsSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002",
      { x: 600, y: 0, width: 600, height: 800 }
    );
    expect(focusSpy).toHaveBeenCalledTimes(2);
    expect(focusSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001"
    );
    expect(focusSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002"
    );
    expect(await screen.findByText("已平铺 2 个窗口")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
    focusSpy.mockRestore();
  });

  test("选择左主右辅后平铺使用对应布局边界", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.screen, "availWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window.screen, "availHeight", { configurable: true, value: 800 });
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001", "account-002"]);
    const listWindowsCalls = new Map<string, number>();
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockImplementation(async (_rootPath, profileId) => {
        const callCount = (listWindowsCalls.get(profileId) ?? 0) + 1;
        listWindowsCalls.set(profileId, callCount);
        const bounds =
          callCount === 1
            ? { x: 0, y: 0, width: 600, height: 800 }
            : profileId === "account-001"
              ? { x: 0, y: 0, width: 600, height: 800 }
              : { x: 600, y: 0, width: 400, height: 800 };
        return [{ index: 1, title: "Chrome", ...bounds }];
      });
    const setBoundsSpy = vi.spyOn(profileApi, "setProfileWindowBounds").mockResolvedValue();
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.selectOptions(screen.getByLabelText("布局"), "left-main");
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(setBoundsSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001",
      { x: 0, y: 0, width: 600, height: 800 }
    );
    expect(setBoundsSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002",
      { x: 600, y: 0, width: 400, height: 800 }
    );
    expect(focusSpy).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("已平铺 2 个窗口")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
    focusSpy.mockRestore();
  });

  test("批量栏可以前置选中运行账号窗口", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "前置窗口" }));

    expect(focusSpy).toHaveBeenCalledTimes(2);
    expect(focusSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001"
    );
    expect(focusSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002"
    );
    expect(await screen.findByText("已前置 2 个窗口")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    focusSpy.mockRestore();
  });

  test("前置窗口部分失败仍继续处理并登记失败 summary", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const focusSpy = vi
      .spyOn(profileApi, "focusProfileWindow")
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("抽奖号前置失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "前置窗口" }));

    expect(focusSpy).toHaveBeenCalledTimes(2);
    expect(focusSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001"
    );
    expect(focusSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002"
    );
    expect(await screen.findByText("已前置 1 个窗口，1 个失败")).toBeTruthy();
    const operationList = await screen.findByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("失败")).toBeTruthy();
    expect(within(operationList).getByText("前置窗口")).toBeTruthy();
    expect(within(operationList).getByText("结果：已前置 1 个，失败 1 个")).toBeTruthy();
  });

  test("平铺成功但前置部分失败时保留组合结果", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 1200
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 800
    });
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        { index: 1, title: "主窗口", x: 0, y: 0, width: 600, height: 800 }
      ])
      .mockResolvedValueOnce([
        { index: 1, title: "目标窗口", x: 0, y: 0, width: 600, height: 800 }
      ])
      .mockResolvedValueOnce([
        { index: 1, title: "主窗口", x: 0, y: 0, width: 600, height: 800 }
      ])
      .mockResolvedValueOnce([
        { index: 1, title: "目标窗口", x: 600, y: 0, width: 600, height: 800 }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    const focusSpy = vi
      .spyOn(profileApi, "focusProfileWindow")
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("抽奖号前置失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(setBoundsSpy).toHaveBeenCalledTimes(2);
    expect(focusSpy).toHaveBeenCalledTimes(2);
    expect(focusSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001"
    );
    expect(focusSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002"
    );
    expect(await screen.findByText("已平铺 2 个窗口，1 个未能前置")).toBeTruthy();
    const operationList = await screen.findByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("失败")).toBeTruthy();
    expect(within(operationList).getByText("平铺窗口")).toBeTruthy();
    expect(
      within(operationList).getByText("结果：已平铺 2 / 2，未能前置 1 个")
    ).toBeTruthy();
  });

  test("平铺窗口会在窗口没有实际移动时提示未生效", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 1200
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 800
    });
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(["account-001"]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 200,
          y: 120,
          width: 640,
          height: 480
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 200,
          y: 120,
          width: 640,
          height: 480
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(2);
    expect(setBoundsSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      { x: 0, y: 0, width: 1200, height: 800 }
    );
    expect(await screen.findByText("平铺窗口未生效：1 个未生效")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("平铺窗口会提示多窗口账号只处理首个窗口", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 1200
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 800
    });
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        },
        {
          index: 2,
          title: "Chrome 设置",
          x: 40,
          y: 40,
          width: 900,
          height: 700
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 600,
          y: 0,
          width: 600,
          height: 800
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(4);
    expect(setBoundsSpy).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText("已平铺 2 个窗口，1 个账号存在多个窗口，仅平铺首个窗口")
    ).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("批量栏可以把主账号首个窗口布局同步给其它运行账号", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "主窗口",
          x: 80,
          y: 120,
          width: 960,
          height: 720
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "目标窗口",
          x: 0,
          y: 0,
          width: 640,
          height: 480
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "目标窗口",
          x: 80,
          y: 120,
          width: 960,
          height: 720
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "同步布局" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(3);
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001"
    );
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002"
    );
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      3,
      "~/MultiChromeProfiles",
      "account-002"
    );
    expect(setBoundsSpy).toHaveBeenCalledTimes(1);
    expect(setBoundsSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-002",
      { x: 80, y: 120, width: 960, height: 720 }
    );
    expect(focusSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await screen.findByText("已同步布局到 1 个账号")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
    focusSpy.mockRestore();
  });

  test("预览同步只读取窗口并展示目标 bounds，不移动或前置窗口", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        { index: 1, title: "主窗口", x: 80, y: 120, width: 960, height: 720 }
      ])
      .mockResolvedValueOnce([
        { index: 1, title: "目标窗口", x: 0, y: 0, width: 640, height: 480 }
      ]);
    const setBoundsSpy = vi.spyOn(profileApi, "setProfileWindowBounds");
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "预览同步" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(2);
    expect(setBoundsSpy).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("预览")).toBeTruthy();
    expect(screen.getByText("将同步到")).toBeTruthy();
    expect(screen.getByText(/抽奖号：960x720 @ 80,120/)).toBeTruthy();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
    focusSpy.mockRestore();
  });

  test("真实同步完成后在同步详情中展示结果账号", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    vi.spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        { index: 1, title: "主窗口", x: 80, y: 120, width: 960, height: 720 }
      ])
      .mockResolvedValueOnce([
        { index: 1, title: "目标窗口", x: 0, y: 0, width: 640, height: 480 }
      ])
      .mockResolvedValueOnce([
        { index: 1, title: "目标窗口", x: 80, y: 120, width: 960, height: 720 }
      ]);
    vi.spyOn(profileApi, "setProfileWindowBounds").mockResolvedValue();
    vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "同步布局" }));

    expect(await screen.findByText("结果")).toBeTruthy();
    expect(screen.getByText("抽奖号：同步成功")).toBeTruthy();
  });

  test("切换选择会清空已有同步详情", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    vi.spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        { index: 1, title: "主窗口", x: 80, y: 120, width: 960, height: 720 }
      ])
      .mockResolvedValueOnce([
        { index: 1, title: "目标窗口", x: 0, y: 0, width: 640, height: 480 }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "预览同步" }));
    expect(await screen.findByText("预览")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    expect(screen.getByText("尚未预览或同步布局")).toBeTruthy();
  });

  test("布局同步会跳过读取失败的目标并继续同步其它目标", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith([
          profile({ id: "account-001", name: "主号", tags: ["Gmail", "TG"], notes: "Google 已登录" }),
          profile({ id: "account-002", name: "抽奖号", status: "needs_check", tags: ["X", "DC"] }),
          profile({ id: "account-003", name: "任务号", tags: ["Galxe"] })
        ])
      )
    );
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002",
      "account-003"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "主窗口",
          x: 80,
          y: 120,
          width: 960,
          height: 720
        }
      ])
      .mockRejectedValueOnce(new Error("辅助功能权限不足"))
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "目标窗口",
          x: 0,
          y: 0,
          width: 640,
          height: 480
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "目标窗口",
          x: 80,
          y: 120,
          width: 960,
          height: 720
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    const focusSpy = vi.spyOn(profileApi, "focusProfileWindow").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await user.click(screen.getByRole("button", { name: "选择 任务号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "同步布局" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(4);
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001"
    );
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002"
    );
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      3,
      "~/MultiChromeProfiles",
      "account-003"
    );
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      4,
      "~/MultiChromeProfiles",
      "account-003"
    );
    expect(setBoundsSpy).toHaveBeenCalledTimes(1);
    expect(setBoundsSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-003",
      { x: 80, y: 120, width: 960, height: 720 }
    );
    expect(setBoundsSpy).not.toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-002",
      expect.anything()
    );
    expect(await screen.findByText("已同步布局到 1 个账号，1 个失败")).toBeTruthy();
    const operationList = await screen.findByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("失败")).toBeTruthy();
    expect(within(operationList).getByText("结果：已同步 1 / 3，失败 1 个")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
    focusSpy.mockRestore();
  });

  test("布局同步会在窗口没有实际移动时提示未生效", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "主窗口",
          x: 80,
          y: 120,
          width: 960,
          height: 720
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "目标窗口",
          x: 0,
          y: 0,
          width: 640,
          height: 480
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "目标窗口",
          x: 0,
          y: 0,
          width: 640,
          height: 480
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "同步布局" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(3);
    expect(setBoundsSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-002",
      { x: 80, y: 120, width: 960, height: 720 }
    );
    expect(await screen.findByText("没有窗口实际同步，1 个未生效")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("布局同步会拒绝使用已最小化的主账号窗口", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "主窗口",
          x: 80,
          y: 120,
          width: 960,
          height: 720,
          minimized: true
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "同步布局" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(1);
    expect(setBoundsSpy).not.toHaveBeenCalled();
    expect(
      await screen.findByText("主账号窗口已最小化，请先恢复窗口再同步布局")
    ).toBeTruthy();
    expect(screen.getByText("结果")).toBeTruthy();
    expect(screen.getByText("主账号：主号（窗口已最小化）")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("预览同步被 lock 拒绝的第二次点击不会使第一次详情失效", async () => {
    const user = userEvent.setup();
    const pendingTargetWindows = deferred<Awaited<ReturnType<typeof profileApi.listProfileWindows>>>();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        { index: 1, title: "主窗口", x: 80, y: 120, width: 960, height: 720 }
      ])
      .mockReturnValueOnce(pendingTargetWindows.promise);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    const previewButton = screen.getByRole("button", { name: "预览同步" });
    fireEvent.click(previewButton);
    fireEvent.click(previewButton);
    await waitFor(() => expect(listWindowsSpy).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("窗口操作“预览同步”正在进行，请稍候")
    ).toBeTruthy();

    pendingTargetWindows.resolve([
      { index: 1, title: "目标窗口", x: 0, y: 0, width: 640, height: 480 }
    ]);

    expect(await screen.findByText("预览")).toBeTruthy();
    expect(screen.getByText(/抽奖号：960x720 @ 80,120/)).toBeTruthy();
  });

  test("同步布局失败后会登记窗口操作失败", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "主窗口",
          x: 80,
          y: 120,
          width: 960,
          height: 720,
          minimized: true
        }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "同步布局" }));

    expect(
      await screen.findByText("主账号窗口已最小化，请先恢复窗口再同步布局")
    ).toBeTruthy();
    const operationList = await screen.findByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("失败")).toBeTruthy();
    expect(within(operationList).getByText("窗口操作")).toBeTruthy();
    expect(within(operationList).getByText("同步布局")).toBeTruthy();
    expect(within(operationList).getByText("2 个账号")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
  });

  test("布局同步会跳过已最小化的目标窗口", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "主窗口",
          x: 80,
          y: 120,
          width: 960,
          height: 720
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "目标窗口",
          x: 0,
          y: 0,
          width: 640,
          height: 480,
          minimized: true
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "同步布局" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(2);
    expect(setBoundsSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("没有可同步的目标窗口，1 个窗口已最小化")).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("平铺窗口会跳过没有可读窗口的运行账号", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 1200
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 800
    });
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Galxe",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Galxe",
          x: 0,
          y: 0,
          width: 1200,
          height: 800
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(3);
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001"
    );
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002"
    );
    expect(listWindowsSpy).toHaveBeenNthCalledWith(
      3,
      "~/MultiChromeProfiles",
      "account-001"
    );
    expect(setBoundsSpy).toHaveBeenCalledTimes(1);
    expect(setBoundsSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      { x: 0, y: 0, width: 1200, height: 800 }
    );
    expect(
      await screen.findByText("已平铺 1 个窗口，1 个没有可平铺窗口")
    ).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("平铺窗口会使用屏幕可用区域的左上角偏移", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.screen, "availLeft", {
      configurable: true,
      value: 80
    });
    Object.defineProperty(window.screen, "availTop", {
      configurable: true,
      value: 25
    });
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 1200
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 800
    });
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 80,
          y: 25,
          width: 600,
          height: 800
        }
      ])
      .mockResolvedValueOnce([
        {
          index: 1,
          title: "Chrome",
          x: 680,
          y: 25,
          width: 600,
          height: 800
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(setBoundsSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001",
      { x: 80, y: 25, width: 600, height: 800 }
    );
    expect(setBoundsSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-002",
      { x: 680, y: 25, width: 600, height: 800 }
    );
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("平铺窗口过多时会提示分批处理", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 1200
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 800
    });
    const manyProfiles = Array.from({ length: 10 }, (_, index) =>
      profile({
        id: `account-${String(index + 1).padStart(3, "0")}`,
        name: `账号 ${index + 1}`
      })
    );
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(documentWith(manyProfiles))
    );
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue(
      manyProfiles.map((item) => item.id)
    );
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockResolvedValue([
        {
          index: 1,
          title: "Chrome",
          x: 0,
          y: 0,
          width: 600,
          height: 800
        }
      ]);
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "全选当前" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(listWindowsSpy).toHaveBeenCalledTimes(10);
    expect(setBoundsSpy).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "当前屏幕最多适合平铺 9 个窗口；已选运行窗口 10 个，请减少选择或分批平铺"
      )
    ).toBeTruthy();
    const operationList = await screen.findByRole("list", { name: "最近操作记录" });
    expect(
      within(operationList).getByText("结果：可平铺 10 个，屏幕容量 9 个，已超限")
    ).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("平铺窗口检查全部失败时会提示 macOS 辅助功能权限", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "listRunningProfiles").mockResolvedValue([
      "account-001",
      "account-002"
    ]);
    const listWindowsSpy = vi
      .spyOn(profileApi, "listProfileWindows")
      .mockRejectedValue(new Error("osascript: execution error: System Events got an error"));
    const setBoundsSpy = vi
      .spyOn(profileApi, "setProfileWindowBounds")
      .mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "平铺窗口" }));

    expect(setBoundsSpy).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "窗口操作失败：可能需要在 macOS 系统设置 > 隐私与安全性 > 辅助功能 中允许 MultiChrome 控制电脑。原始错误：osascript: execution error: System Events got an error"
      )
    ).toBeTruthy();
    vi.mocked(profileApi.listRunningProfiles).mockRestore();
    listWindowsSpy.mockRestore();
    setBoundsSpy.mockRestore();
  });

  test("点击编辑按钮只打开弹窗，删除入口只在弹窗内出现", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    expect(screen.queryByText("已启动 主号")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "只删除记录" })).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "删除记录和文件夹" })
    ).toBeTruthy();
  });

  test("删除账号使用独立确认弹窗，确认后才删除", async () => {
    const user = userEvent.setup();
    const deleteSpy = vi.spyOn(profileApi, "deleteProfileData").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(editDialog).getByRole("button", { name: "删除记录和文件夹" }));

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(within(editDialog).queryByText("确认删除账号和文件夹")).toBeNull();
    const confirmDialog = await screen.findByRole("dialog", { name: "确认删除账号和文件夹" });

    await user.click(within(confirmDialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    });
    expect(screen.queryByRole("button", { name: "选择 主号" })).toBeNull();
    deleteSpy.mockRestore();
  });

  test("批量删除选中账号需要独立确认，确认只删除记录后不删除文件夹", async () => {
    const user = userEvent.setup();
    const deleteSpy = vi.spyOn(profileApi, "deleteProfileData").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "删除选中" }));

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(savedDocument().profiles).toHaveLength(2);

    const confirmDialog = await screen.findByRole("dialog", { name: "确认批量删除账号" });
    expect(within(confirmDialog).getByText("将删除 2 个账号。")).toBeTruthy();

    await user.click(within(confirmDialog).getByRole("button", { name: "只删除记录" }));

    await waitFor(() => {
      expect(savedDocument().profiles).toEqual([]);
    });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "选择 主号" })).toBeNull();
    expect(screen.queryByRole("button", { name: "选择 抽奖号" })).toBeNull();
    deleteSpy.mockRestore();
  });

  test("批量删除账号和文件夹会逐个删除目录，失败时不移除账号记录", async () => {
    const user = userEvent.setup();
    const deleteSpy = vi
      .spyOn(profileApi, "deleteProfileData")
      .mockRejectedValueOnce(new Error("删除失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "删除选中" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "确认批量删除账号" });
    await user.click(within(confirmDialog).getByRole("button", { name: "删除记录和文件夹" }));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    });
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(savedDocument().profiles.map((item) => item.id)).toEqual([
      "account-001",
      "account-002"
    ]);
    expect(await screen.findByText("删除失败")).toBeTruthy();
    deleteSpy.mockRestore();
  });

  test("新建账号取消后不会留下账号", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "新建账号" }));
    const dialog = await screen.findByRole("dialog", { name: "新建账号" });

    expect(savedDocument().profiles).toHaveLength(2);

    await user.click(within(dialog).getByRole("button", { name: "取消新建账号" }));

    expect(savedDocument().profiles).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "选择 账号 3" })).toBeNull();
  });

  test("新建账号保存后才创建账号", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "新建账号" }));
    const dialog = await screen.findByRole("dialog", { name: "新建账号" });
    await user.clear(within(dialog).getByLabelText("名称"));
    await user.type(within(dialog).getByLabelText("名称"), "测试号");
    await user.type(within(dialog).getByLabelText("标签"), "galxe");
    await user.type(within(dialog).getByLabelText("备注"), "刚买的号");

    expect(savedDocument().profiles).toHaveLength(2);

    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));

    await screen.findByRole("button", { name: "选择 测试号" });
    const created = savedDocument().profiles[2];
    expect(created.name).toBe("测试号");
    expect(created.tags).toEqual(["galxe"]);
    expect(created.notes).toBe("刚买的号");
  });

  test("批量新建账号取消后不会写入账号", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "批量新建账号" }));
    const dialog = await screen.findByRole("dialog", { name: "批量新建账号" });
    await user.type(within(dialog).getByLabelText("批量账号文本"), "测试号, galxe, 刚买的号");

    expect(savedDocument().profiles).toHaveLength(2);

    await user.click(within(dialog).getByRole("button", { name: "取消批量新建" }));

    expect(savedDocument().profiles).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "选择 测试号" })).toBeNull();
  });

  test("批量新建账号按 Esc 会关闭且不会写入账号", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "批量新建账号" }));
    const dialog = await screen.findByRole("dialog", { name: "批量新建账号" });
    await user.type(within(dialog).getByLabelText("批量账号文本"), "测试号, galxe, 刚买的号");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "批量新建账号" })).toBeNull();
    });
    expect(savedDocument().profiles).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "选择 测试号" })).toBeNull();
  });

  test("可以批量新建账号并解析标签和备注", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "批量新建账号" }));
    const dialog = await screen.findByRole("dialog", { name: "批量新建账号" });
    await user.type(
      within(dialog).getByLabelText("批量账号文本"),
      [
        "测试号一, galxe x, Google 已登录",
        "测试号二 | dc,tg | 待检查",
        "测试号三"
      ].join("\n")
    );
    await user.click(within(dialog).getByRole("button", { name: "创建 3 个账号" }));

    await screen.findByRole("button", { name: "选择 测试号一" });
    await screen.findByRole("button", { name: "选择 测试号二" });
    await screen.findByRole("button", { name: "选择 测试号三" });

    const createdProfiles = savedDocument().profiles.slice(2);
    expect(createdProfiles.map((profile) => profile.id)).toEqual([
      "account-003",
      "account-004",
      "account-005"
    ]);
    expect(createdProfiles[0]).toMatchObject({
      name: "测试号一",
      tags: ["galxe", "x"],
      notes: "Google 已登录"
    });
    expect(createdProfiles[1]).toMatchObject({
      name: "测试号二",
      tags: ["dc", "tg"],
      notes: "待检查"
    });
    expect(createdProfiles[2]).toMatchObject({
      name: "测试号三",
      tags: [],
      notes: ""
    });
  });

  test("批量新建账号支持从表格粘贴制表符分隔内容", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "批量新建账号" }));
    const dialog = await screen.findByRole("dialog", { name: "批量新建账号" });
    fireEvent.change(within(dialog).getByLabelText("批量账号文本"), {
      target: {
        value: ["表格号一\tgalxe tg\tGoogle 已登录", "表格号二\tDC, X\t备用号"].join("\n")
      }
    });
    await user.click(within(dialog).getByRole("button", { name: "创建 2 个账号" }));

    await screen.findByRole("button", { name: "选择 表格号一" });
    await screen.findByRole("button", { name: "选择 表格号二" });

    const createdProfiles = savedDocument().profiles.slice(2);
    expect(createdProfiles[0]).toMatchObject({
      name: "表格号一",
      tags: ["galxe", "tg"],
      notes: "Google 已登录"
    });
    expect(createdProfiles[1]).toMatchObject({
      name: "表格号二",
      tags: ["DC", "X"],
      notes: "备用号"
    });
  });

  test("可以扫描来源目录并预览批量导入候选", async () => {
    const user = userEvent.setup();
    const scanSpy = vi
      .spyOn(profileApi, "scanProfileImportCandidates")
      .mockResolvedValue([
        {
          path: "/Volumes/SATA/profiles/twitter-main",
          folderName: "twitter-main",
          suggestedName: "推特主号",
          suggestedTags: ["旧盘"],
          suggestedNotes: "来源：旧索引",
          sizeBytes: 1024,
          confidence: "ready",
          evidence: ["发现 Default/Preferences"],
          skippedReason: null,
          profileUid: null,
          duplicateProfileId: null,
          duplicateProfileName: null,
          duplicateReason: null
        },
        {
          path: "/Volumes/SATA/profiles/maybe-profile",
          folderName: "maybe-profile",
          suggestedName: "maybe-profile",
          suggestedTags: [],
          suggestedNotes: "",
          sizeBytes: 0,
          confidence: "suspicious",
          evidence: ["只发现 Default 文件夹"],
          skippedReason: null,
          profileUid: null,
          duplicateProfileId: null,
          duplicateProfileName: null,
          duplicateReason: null
        },
        {
          path: "/Volumes/SATA/profiles/empty",
          folderName: "empty",
          suggestedName: "empty",
          suggestedTags: [],
          suggestedNotes: "",
          sizeBytes: 0,
          confidence: "skipped",
          evidence: [],
          skippedReason: "空目录",
          profileUid: null,
          duplicateProfileId: null,
          duplicateProfileName: null,
          duplicateReason: null
        }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));

    const preview = await screen.findByRole("region", { name: "导入候选" });
    expect(within(preview).getByText("推特主号")).toBeTruthy();
    expect(within(preview).getByText("maybe-profile")).toBeTruthy();
    expect(within(preview).getAllByText("空目录").length).toBeGreaterThan(0);
    expect(
      (within(preview).getByRole("checkbox", {
        name: "选择导入 推特主号"
      }) as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (within(preview).getByRole("checkbox", {
        name: "选择导入 maybe-profile"
      }) as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (within(preview).getByRole("checkbox", {
        name: "选择导入 empty"
      }) as HTMLInputElement).disabled
    ).toBe(true);
    expect(scanSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "/Volumes/SATA/profiles");
    scanSpy.mockRestore();
  });

  test("扫描导入会禁用已经导入过的候选", async () => {
    const user = userEvent.setup();
    const scanSpy = vi
      .spyOn(profileApi, "scanProfileImportCandidates")
      .mockResolvedValue([
        importCandidate({
          path: "/Volumes/SATA/profiles/twitter-main",
          suggestedName: "推特主号",
          duplicateProfileId: "account-001",
          duplicateProfileName: "主号",
          duplicateReason: "来源路径已导入"
        }),
        importCandidate({
          path: "/Volumes/SATA/profiles/galxe-01",
          suggestedName: "Galxe 01"
        })
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));

    const preview = await screen.findByRole("region", { name: "导入候选" });
    expect(within(preview).getAllByText("已导入：主号").length).toBeGreaterThan(0);
    expect(
      (within(preview).getByRole("checkbox", {
        name: "选择导入 推特主号"
      }) as HTMLInputElement).disabled
    ).toBe(true);
    expect(screen.getByText("可导入 1 · 可疑 0 · 已导入 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "导入选中 1 个" })).toBeTruthy();
    scanSpy.mockRestore();
  });

  test("可以批量复制导入扫描候选", async () => {
    const user = userEvent.setup();
    const scanSpy = vi
      .spyOn(profileApi, "scanProfileImportCandidates")
      .mockResolvedValue([
        importCandidate({
          path: "/Volumes/SATA/profiles/twitter-main",
          suggestedName: "推特主号",
          suggestedTags: ["旧盘"],
          suggestedNotes: "来源：旧索引"
        }),
        importCandidate({
          path: "/Volumes/SATA/profiles/galxe-01",
          folderName: "galxe-01",
          suggestedName: "Galxe 01",
          suggestedTags: ["galxe"]
        })
      ]);
    const importSpy = vi.spyOn(profileApi, "importProfileData").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 2 个" }));

    await screen.findByRole("button", { name: "选择 推特主号" });
    await screen.findByRole("button", { name: "选择 Galxe 01" });
    expect(importSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "/Volumes/SATA/profiles/twitter-main",
      "account-003",
      expect.objectContaining({
        app: "MultiChrome",
        profileId: "account-003",
        name: "推特主号",
        sourcePath: "/Volumes/SATA/profiles/twitter-main",
        sourceFolderName: "twitter-main"
      })
    );
    expect(importSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "/Volumes/SATA/profiles/galxe-01",
      "account-004",
      expect.objectContaining({
        app: "MultiChrome",
        profileId: "account-004",
        name: "Galxe 01",
        sourcePath: "/Volumes/SATA/profiles/galxe-01",
        sourceFolderName: "galxe-01"
      })
    );
    const created = savedDocument().profiles.slice(2);
    expect(created[0]).toMatchObject({
      id: "account-003",
      name: "推特主号",
      tags: ["旧盘"],
      notes: "来源：旧索引",
      importSource: {
        sourcePath: "/Volumes/SATA/profiles/twitter-main",
        sourceFolderName: "twitter-main"
      }
    });
    expect(created[1]).toMatchObject({
      id: "account-004",
      name: "Galxe 01",
      tags: ["galxe"],
      notes: "来源：/Volumes/SATA/profiles/galxe-01",
      importSource: {
        sourcePath: "/Volumes/SATA/profiles/galxe-01",
        sourceFolderName: "galxe-01"
      }
    });
    scanSpy.mockRestore();
    importSpy.mockRestore();
  });

  test("批量导入失败会回滚本次已复制目录且不写入账号", async () => {
    const user = userEvent.setup();
    const scanSpy = vi
      .spyOn(profileApi, "scanProfileImportCandidates")
      .mockResolvedValue([
        importCandidate({
          path: "/Volumes/SATA/profiles/twitter-main",
          suggestedName: "推特主号"
        }),
        importCandidate({
          path: "/Volumes/SATA/profiles/galxe-01",
          folderName: "galxe-01",
          suggestedName: "Galxe 01"
        })
      ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("复制失败"));
    const deleteSpy = vi.spyOn(profileApi, "deleteProfileData").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 2 个" }));

    expect(await screen.findByText("复制失败")).toBeTruthy();
    expect(savedDocument().profiles).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "选择 推特主号" })).toBeNull();
    expect(deleteSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-003");
    scanSpy.mockRestore();
    importSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test("导入目标目录已存在失败时不会删除既有目录", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      })
    ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockRejectedValue(new Error("目标 profile 目录已存在"));
    const deleteSpy = vi.spyOn(profileApi, "deleteProfileData").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 1 个" }));

    expect(await screen.findByText("目标 profile 目录已存在")).toBeTruthy();
    expect(importSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "/Volumes/SATA/profiles/twitter-main",
      "account-003",
      expect.any(Object)
    );
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(savedDocument().profiles).toHaveLength(2);
    importSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test("批量导入失败且回滚失败时同时提示原始错误和账号 ID", async () => {
    const user = userEvent.setup();
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      }),
      importCandidate({
        path: "/Volumes/SATA/profiles/galxe-01",
        folderName: "galxe-01",
        suggestedName: "Galxe 01"
      })
    ]);
    vi.spyOn(profileApi, "importProfileData")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("复制失败"));
    const deleteSpy = vi
      .spyOn(profileApi, "deleteProfileData")
      .mockRejectedValue(new Error("目录被占用"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 2 个" }));

    expect(
      await screen.findByText("复制失败；回滚失败账号：account-003")
    ).toBeTruthy();
    expect(savedDocument().profiles).toHaveLength(2);
    expect(deleteSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-003");
    expect(deleteSpy).not.toHaveBeenCalledWith("~/MultiChromeProfiles", "account-004");
  });

  test("并发保存账号编辑不会覆盖正在导入的账号", async () => {
    const user = userEvent.setup();
    const importCopy = deferred<void>();
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      })
    ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockReturnValue(importCopy.promise);
    const deleteSpy = vi.spyOn(profileApi, "deleteProfileData").mockResolvedValue();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 1 个" }));
    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(dialog).getByLabelText("名称"));
    await user.type(within(dialog).getByLabelText("名称"), "并发改名主号");
    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));

    await act(async () => {
      importCopy.resolve();
      await importCopy.promise;
    });

    await waitFor(() => {
      const names = savedDocument().profiles.map((item) => item.name);
      expect(names).toContain("并发改名主号");
      expect(names).toContain("推特主号");
    });
    expect(deleteSpy).not.toHaveBeenCalled();
    importSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test("两个排队的普通保存分别修改不同账号时最终都保留", async () => {
    const user = userEvent.setup();
    const firstSave = deferred<void>();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockResolvedValue("/tmp/profile");
    const saveProfilesSpy = vi
      .spyOn(profileApi, "saveProfiles")
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue(undefined);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));
    await waitFor(() => {
      expect(saveProfilesSpy).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "打开 抽奖号" }));
    expect(saveProfilesSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve();
      await firstSave.promise;
    });

    await waitFor(() => {
      expect(saveProfilesSpy).toHaveBeenCalledTimes(2);
    });
    const finalProfiles = saveProfilesSpy.mock.calls[1][1].profiles;
    expect(finalProfiles.find((item) => item.id === "account-001")?.lastOpenedAt).not.toBeNull();
    expect(finalProfiles.find((item) => item.id === "account-002")?.lastOpenedAt).not.toBeNull();
    openProfileSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("同一账号名称编辑和 lastOpenedAt 并发修改时最终都保留", async () => {
    const user = userEvent.setup();
    const delayedOpen = deferred<string>();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockReturnValue(delayedOpen.promise);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));
    await waitFor(() => {
      expect(openProfileSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(dialog).getByLabelText("名称"));
    await user.type(within(dialog).getByLabelText("名称"), "并发改名主号");
    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));
    await waitFor(() => {
      expect(savedDocument().profiles[0].name).toBe("并发改名主号");
    });

    await act(async () => {
      delayedOpen.resolve("/tmp/account-001");
      await delayedOpen.promise;
    });

    await waitFor(() => {
      const stored = savedDocument().profiles[0];
      expect(stored.name).toBe("并发改名主号");
      expect(stored.lastOpenedAt).not.toBeNull();
    });
    openProfileSpy.mockRestore();
  });

  test("账号删除后排队的 stale 更新不能复活已删账号", async () => {
    const user = userEvent.setup();
    const staleOpen = deferred<string>();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockReturnValue(staleOpen.promise);
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));
    await waitFor(() => {
      expect(openProfileSpy).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "编辑 主号" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(editDialog).getByRole("button", { name: "只删除记录" }));
    const confirmDialog = await screen.findByRole("dialog", {
      name: "确认只删除账号记录"
    });
    await user.click(within(confirmDialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "选择 主号" })).toBeNull();
    });

    await act(async () => {
      staleOpen.resolve("/tmp/account-001");
      await staleOpen.promise;
    });
    await waitFor(() => {
      expect(saveProfilesSpy).toHaveBeenCalledTimes(2);
    });

    expect(savedDocument().profiles.map((item) => item.id)).toEqual(["account-002"]);
    expect(screen.queryByRole("button", { name: "选择 主号" })).toBeNull();
    openProfileSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("复用同 ID 的新账号不会被旧账号启动完成回写", async () => {
    const user = userEvent.setup();
    const staleOpen = deferred<string>();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockReturnValue(staleOpen.promise);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 抽奖号" }));
    await waitFor(() => {
      expect(openProfileSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "编辑 抽奖号" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑 抽奖号" });
    await user.click(within(editDialog).getByRole("button", { name: "只删除记录" }));
    const confirmDialog = await screen.findByRole("dialog", {
      name: "确认只删除账号记录"
    });
    await user.click(within(confirmDialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "选择 抽奖号" })).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "新建账号" }));
    const newProfileDialog = await screen.findByRole("dialog", { name: "新建账号" });
    await user.clear(within(newProfileDialog).getByLabelText("名称"));
    await user.type(within(newProfileDialog).getByLabelText("名称"), "复用新号");
    await user.click(within(newProfileDialog).getByRole("button", { name: "保存账号" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "选择 复用新号" })).toBeTruthy();
    });

    const replacementBeforeStaleOpen = savedDocument().profiles.find(
      (item) => item.id === "account-002"
    );
    expect(replacementBeforeStaleOpen?.name).toBe("复用新号");
    expect(replacementBeforeStaleOpen?.lastOpenedAt).toBeNull();

    await act(async () => {
      staleOpen.resolve("/tmp/account-002");
      await staleOpen.promise;
    });

    await flushPromises();
    const replacementAfterStaleOpen = savedDocument().profiles.find(
      (item) => item.id === "account-002"
    );
    expect(replacementAfterStaleOpen?.name).toBe("复用新号");
    expect(replacementAfterStaleOpen?.createdAt).toBe(
      replacementBeforeStaleOpen?.createdAt
    );
    expect(replacementAfterStaleOpen?.lastOpenedAt).toBeNull();
    openProfileSpy.mockRestore();
  });

  test("导入占用新 ID 时并发新建账号不会覆盖导入记录", async () => {
    const user = userEvent.setup();
    const importCopy = deferred<void>();
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      })
    ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockReturnValue(importCopy.promise);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 1 个" }));
    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "新建账号" }));
    const dialog = await screen.findByRole("dialog", { name: "新建账号" });
    await user.clear(within(dialog).getByLabelText("名称"));
    await user.type(within(dialog).getByLabelText("名称"), "并发新建号");
    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));

    await act(async () => {
      importCopy.resolve();
      await importCopy.promise;
    });

    await waitFor(() => {
      expect(savedDocument().profiles.map((item) => item.name)).toEqual(
        expect.arrayContaining(["推特主号", "并发新建号"])
      );
    });
    const created = savedDocument().profiles.slice(2);
    expect(created).toHaveLength(2);
    expect(new Set(created.map((item) => item.id)).size).toBe(2);
    expect(created.find((item) => item.name === "推特主号")?.importSource).toMatchObject({
      sourcePath: "/Volumes/SATA/profiles/twitter-main"
    });
    expect(created.find((item) => item.name === "并发新建号")?.importSource).toBeUndefined();
  });

  test("取消导入时目录回滚失败会提示账号 ID 且保留新来源路径", async () => {
    const user = userEvent.setup();
    const importCopy = deferred<void>();
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      })
    ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockReturnValue(importCopy.promise);
    const deleteSpy = vi
      .spyOn(profileApi, "deleteProfileData")
      .mockRejectedValue(new Error("目录被占用"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    const importPathInput = screen.getByLabelText("导入来源目录");
    fireEvent.change(importPathInput, {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 1 个" }));
    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(importPathInput, {
      target: { value: "/Volumes/SATA/new-profiles" }
    });
    await act(async () => {
      importCopy.resolve();
      await importCopy.promise;
    });

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-003");
    });
    expect(
      await screen.findByText("导入已取消，但回滚失败账号：account-003")
    ).toBeTruthy();
    expect((importPathInput as HTMLInputElement).value).toBe(
      "/Volumes/SATA/new-profiles"
    );
    expect(savedDocument().profiles).toHaveLength(2);
  });

  test("跨 root 取消导入回滚失败不会污染新 root 消息", async () => {
    const user = userEvent.setup();
    const importCopy = deferred<void>();
    const targetDocument = documentWith([
      profile({ id: "target-001", name: "目标账号" })
    ]);
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      })
    ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockReturnValue(importCopy.promise);
    const deleteSpy = vi
      .spyOn(profileApi, "deleteProfileData")
      .mockRejectedValue(new Error("目录被占用"));
    const loadProfilesSpy = vi
      .spyOn(profileApi, "loadProfiles")
      .mockImplementation(async (path) =>
        path === "/tmp/other-root" ? targetDocument : savedDocument()
      );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 1 个" }));
    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });

    const settingsDialog = await openSettingsDialog(user);
    changeRootPathDraft(settingsDialog, "/tmp/other-root");
    await user.click(within(settingsDialog).getByRole("button", { name: "保存设置" }));
    expect(await screen.findByRole("button", { name: "选择 目标账号" })).toBeTruthy();

    await act(async () => {
      importCopy.resolve();
      await importCopy.promise;
    });

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-003");
    });
    expect(
      screen.queryByText("导入已取消，但回滚失败账号：account-003")
    ).toBeNull();
    expect(screen.getByRole("button", { name: "选择 目标账号" })).toBeTruthy();
    loadProfilesSpy.mockRestore();
  });

  test("同 root 重新检测不会用正常状态覆盖取消导入回滚失败提示", async () => {
    const user = userEvent.setup();
    const importCopy = deferred<void>();
    const reloadRefresh = deferred<BrowserSessionSnapshot[]>();
    let snapshotCallCount = 0;
    vi.spyOn(profileApi, "snapshotBrowserSessions").mockImplementation(() => {
      snapshotCallCount += 1;
      return snapshotCallCount === 2 ? reloadRefresh.promise : Promise.resolve([]);
    });
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      })
    ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockReturnValue(importCopy.promise);
    const deleteSpy = vi
      .spyOn(profileApi, "deleteProfileData")
      .mockRejectedValue(new Error("目录被占用"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 1 个" }));
    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });

    const settingsDialog = await openSettingsDialog(user);
    await detectRootPathDraft(user, settingsDialog);
    await waitFor(() => {
      expect(snapshotCallCount).toBe(2);
    });

    await act(async () => {
      importCopy.resolve();
      await importCopy.promise;
    });

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-003");
    });
    expect(
      await screen.findByText("导入已取消，但回滚失败账号：account-003")
    ).toBeTruthy();

    await act(async () => {
      reloadRefresh.resolve([]);
      await reloadRefresh.promise;
    });
    expect(screen.getByText("导入已取消，但回滚失败账号：account-003")).toBeTruthy();
  });

  test("同 root 取消导入后复制失败会提示原始错误且不删除未复制目录", async () => {
    const user = userEvent.setup();
    const importCopy = deferred<void>();
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      })
    ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockReturnValue(importCopy.promise);
    const deleteSpy = vi
      .spyOn(profileApi, "deleteProfileData")
      .mockRejectedValue(new Error("目录被占用"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    const importPathInput = screen.getByLabelText("导入来源目录");
    fireEvent.change(importPathInput, {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 1 个" }));
    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(importPathInput, {
      target: { value: "/Volumes/SATA/new-profiles" }
    });
    await act(async () => {
      importCopy.reject(new Error("复制失败；清理失败：权限不足"));
      await importCopy.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(screen.getByText("导入已取消：复制失败；清理失败：权限不足")).toBeTruthy();
    });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByText(
        "导入已取消：复制失败；清理失败：权限不足；回滚失败账号：account-003"
      )
    ).toBeNull();
    expect(
      screen.getByText("导入已取消：复制失败；清理失败：权限不足")
    ).toBeTruthy();
    expect((importPathInput as HTMLInputElement).value).toBe(
      "/Volumes/SATA/new-profiles"
    );
    expect(savedDocument().profiles).toHaveLength(2);
  });

  test("主界面不显示说明性标题和副标题", async () => {
    render(<App />);

    await screen.findByRole("button", { name: "选择 主号" });

    expect(screen.queryByText("账号启动器")).toBeNull();
    expect(screen.queryByText("本机配置档案")).toBeNull();
  });

  test("可以切换标准和紧凑视图", async () => {
    const user = userEvent.setup();
    render(<App />);

    const compactToggle = await screen.findByRole("button", { name: "切换紧凑视图" });
    expect(compactToggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(compactToggle);

    const standardToggle = await screen.findByRole("button", { name: "切换标准视图" });
    expect(standardToggle.getAttribute("aria-pressed")).toBe("true");
  });

  test("全选和账号数量收在同一个工具组里", async () => {
    render(<App />);

    const toolbarGroup = await screen.findByRole("group", {
      name: "选择操作"
    });

    expect(within(toolbarGroup).getByRole("button", { name: "全选当前" })).toBeTruthy();
    expect(within(toolbarGroup).getByText("2 个账号")).toBeTruthy();
  });

  test("选择任意账号后顶部按钮变成取消选择并可清空", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));

    expect(screen.getByRole("button", { name: "取消选择" })).toBeTruthy();
    expect(screen.getByText("已选择 1 个账号")).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择 主号" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: "选择 抽奖号" }).getAttribute("aria-pressed")).toBe(
      "false"
    );

    await user.click(screen.getByRole("button", { name: "取消选择" }));

    expect(screen.getByRole("button", { name: "全选当前" })).toBeTruthy();
    expect(screen.getByText("未选择账号")).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择 主号" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(screen.getByRole("button", { name: "选择 抽奖号" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
  });

  test("界面不再显示账号状态管理入口", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: "选择 主号" });

    expect(screen.queryByRole("button", { name: "正常" })).toBeNull();
    expect(screen.queryByRole("button", { name: "待检查" })).toBeNull();
    expect(screen.queryByRole("button", { name: "归档" })).toBeNull();
    expect(screen.queryByText("批量标记待检查")).toBeNull();
    expect(screen.queryByText("批量归档")).toBeNull();

    await user.click(screen.getByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });

    expect(within(dialog).queryByText("状态")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "归档" })).toBeNull();
  });

  test("编辑已有账号保存前不会写入，点关闭会丢弃草稿", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(dialog).getByLabelText("名称"));
    await user.type(within(dialog).getByLabelText("名称"), "改名主号");
    await user.type(within(dialog).getByLabelText("备注"), "新的备注");

    expect(savedDocument().profiles[0].name).toBe("主号");
    expect(savedDocument().profiles[0].notes).toBe("Google 已登录");

    await user.click(within(dialog).getByRole("button", { name: "关闭编辑" }));

    expect(await screen.findByRole("button", { name: "选择 主号" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "选择 改名主号" })).toBeNull();
    expect(savedDocument().profiles[0].name).toBe("主号");
  });

  test("编辑已有账号点击遮罩关闭也不会写入草稿", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(dialog).getByLabelText("名称"));
    await user.type(within(dialog).getByLabelText("名称"), "遮罩关闭");

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(savedDocument().profiles[0].name).toBe("主号");
  });

  test("编辑已有账号按 Esc 会关闭且不会写入草稿", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(dialog).getByLabelText("名称"));
    await user.type(within(dialog).getByLabelText("名称"), "Esc 关闭");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(savedDocument().profiles[0].name).toBe("主号");
    expect(screen.queryByRole("button", { name: "选择 Esc 关闭" })).toBeNull();
  });

  test("编辑已有账号点击保存后才写入修改", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(dialog).getByLabelText("名称"));
    await user.type(within(dialog).getByLabelText("名称"), "保存后的主号");
    await user.clear(within(dialog).getByLabelText("标签"));
    await user.type(within(dialog).getByLabelText("标签"), "galxe, x");

    expect(savedDocument().profiles[0].name).toBe("主号");

    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));

    expect(await screen.findByRole("button", { name: "选择 保存后的主号" })).toBeTruthy();
    expect(savedDocument().profiles[0].name).toBe("保存后的主号");
    expect(savedDocument().profiles[0].tags).toEqual(["galxe", "x"]);
  });

  test("可以在账号编辑里添加账号平台资料", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });

    await user.click(within(dialog).getByRole("button", { name: "添加账号平台" }));
    await user.type(within(dialog).getByLabelText("平台名称"), "X");
    await user.type(within(dialog).getByLabelText("登录网址"), "x.com/i/flow/login");
    await user.type(within(dialog).getByLabelText("平台用户名"), "tree_user");
    await user.type(within(dialog).getByLabelText("平台备注"), "主推特");

    expect(savedDocument().profiles[0].accountPlatforms).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));

    await waitFor(() => {
      const stored = savedDocument();
      expect(stored.profiles[0].accountPlatforms).toEqual([
        {
          id: "platform-001",
          platform: "X",
          loginUrl: "https://x.com/i/flow/login",
          username: "tree_user",
          notes: "主推特"
        }
      ]);
    });
    expect(await screen.findByRole("button", { name: "选择 主号" })).toBeTruthy();
  });

  test("账号平台资料可以打开网址并复制用户名", async () => {
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith([
          profile({
            id: "account-001",
            name: "主号",
            accountPlatforms: [
              {
                id: "platform-001",
                platform: "Galxe",
                loginUrl: "https://galxe.com/login",
                username: "tree_user",
                notes: "每日打卡"
              }
            ]
          })
        ])
      )
    );
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "打开账号平台 Galxe" }));

    expect(openProfileSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "https://galxe.com/login"
    );

    await user.click(within(dialog).getByRole("button", { name: "复制用户名 Galxe" }));

    expect(writeText).toHaveBeenCalledWith("tree_user");
    expect(await screen.findByText("用户名已复制")).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("已有账号平台默认折叠，点击编辑后展开字段", async () => {
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith([
          profile({
            id: "account-001",
            name: "主号",
            accountPlatforms: [
              {
                id: "platform-001",
                platform: "Galxe",
                loginUrl: "https://galxe.com/login",
                username: "tree_user",
                notes: "每日打卡"
              }
            ]
          })
        ])
      )
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });

    expect(within(dialog).getByText("Galxe")).toBeTruthy();
    expect(within(dialog).queryByLabelText("平台名称")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "编辑账号平台 Galxe" }));

    expect(within(dialog).getByLabelText("平台名称")).toBeTruthy();
    expect(within(dialog).getByLabelText("登录网址")).toBeTruthy();
  });

  test("新增账号平台会直接展开方便录入", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "添加账号平台" }));

    expect(within(dialog).getByLabelText("平台名称")).toBeTruthy();
    expect(within(dialog).getByLabelText("登录网址")).toBeTruthy();
  });

  test("账号平台可以套用常用模板且保存前不落盘", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "添加账号平台" }));
    await user.click(within(dialog).getByRole("button", { name: "套用 Galxe 模板" }));

    expect((within(dialog).getByLabelText("平台名称") as HTMLInputElement).value).toBe(
      "Galxe"
    );
    expect((within(dialog).getByLabelText("登录网址") as HTMLInputElement).value).toBe(
      "https://galxe.com"
    );
    expect(savedDocument().profiles[0].accountPlatforms).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));

    await waitFor(() => {
      expect(savedDocument().profiles[0].accountPlatforms).toEqual([
        {
          id: "platform-001",
          platform: "Galxe",
          loginUrl: "https://galxe.com",
          username: "",
          notes: ""
        }
      ]);
    });
  });

  test("账号平台资料可以删除", async () => {
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith([
          profile({
            id: "account-001",
            name: "主号",
            accountPlatforms: [
              {
                id: "platform-001",
                platform: "Galxe",
                loginUrl: "https://galxe.com/login",
                username: "tree_user",
                notes: "每日打卡"
              }
            ]
          })
        ])
      )
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "删除账号平台 Galxe" }));

    expect(savedDocument().profiles[0].accountPlatforms).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));

    await waitFor(() => {
      const stored = savedDocument();
      expect(stored.profiles[0].accountPlatforms).toEqual([]);
    });
    expect(await screen.findByRole("button", { name: "选择 主号" })).toBeTruthy();
  });

  test("可以多选账号并批量追加标签", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await openBulkMore(user);
    await user.type(await screen.findByLabelText("批量追加标签"), "galxe");
    await user.click(screen.getByRole("button", { name: "追加标签" }));

    expect(await screen.findByText("已给 2 个账号追加标签")).toBeTruthy();
    await waitFor(() => {
      const stored = savedDocument();
      expect(stored.profiles[0].tags).toContain("galxe");
      expect(stored.profiles[1].tags).toContain("galxe");
    });
  });

  test("可以给选中的账号批量打开指定网址", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("已为 2 个账号打开网址")).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "https://galxe.com"
    );
    expect(openProfileSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-002",
      "/Applications/Google Chrome.app",
      "https://galxe.com"
    );
    openProfileSpy.mockRestore();
  });

  test("批量打开会标记启动中并触发短确认刷新", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", false),
        browserSessionSnapshot("account-002", false)
      ])
      .mockResolvedValueOnce([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ]);
    render(<App />);

    const card = await screen.findByRole("button", { name: "选择 主号" });
    await user.click(card);
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
    await flushPromises();

    expect(within(card).getByText("启动中")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushPromises();

    expect(within(card).getByText("运行中")).toBeTruthy();
    expect(snapshotSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenCalledOnce();
    openProfileSpy.mockRestore();
    snapshotSpy.mockRestore();
  });

  test("批量打开网址为空时会打开默认新标签页", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开新标签" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("已为 2 个账号打开网址")).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "chrome://newtab/"
    );
    expect(openProfileSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-002",
      "/Applications/Google Chrome.app",
      "chrome://newtab/"
    );
    expect(savedDocument().settings.recentUrls).toEqual([]);
    openProfileSpy.mockRestore();
  });

  test("批量打开部分失败时会提示失败账号和原因", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockResolvedValueOnce("/tmp/profile")
      .mockRejectedValueOnce(new Error("Chrome 启动失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(
      screen.getByText("已为 1 个账号打开网址，1 个失败（抽奖号：Chrome 启动失败）")
    ).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("批量打开失败后可以只重试失败账号", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockResolvedValueOnce("/tmp/profile")
      .mockRejectedValueOnce(new Error("Chrome 启动失败"))
      .mockResolvedValueOnce("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByRole("button", { name: "重试最近失败 1" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试最近失败 1" }));
    });

    expect(openProfileSpy).toHaveBeenCalledTimes(3);
    expect(openProfileSpy).toHaveBeenNthCalledWith(
      3,
      "~/MultiChromeProfiles",
      "account-002",
      "/Applications/Google Chrome.app",
      "https://galxe.com"
    );
    expect(screen.getByText("已为 1 个账号打开网址")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试最近失败 1" })).toBeNull();
    openProfileSpy.mockRestore();
  });

  test("修改批量网址会清空旧重试入口", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockResolvedValueOnce("/tmp/profile")
      .mockRejectedValueOnce(new Error("Chrome 启动失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByRole("button", { name: "重试最近失败 1" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("批量打开网址"), {
      target: { value: "zealy.io" }
    });

    expect(screen.queryByRole("button", { name: "重试最近失败 1" })).toBeNull();
    openProfileSpy.mockRestore();
  });

  test("新一轮批量打开开始时会清空旧重试入口", async () => {
    const user = userEvent.setup();
    let releaseSecondRun: (() => void) | null = null;
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockResolvedValueOnce("/tmp/profile")
      .mockRejectedValueOnce(new Error("Chrome 启动失败"))
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseSecondRun = () => resolve("/tmp/profile");
          })
      );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("button", { name: "重试最近失败 1" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await flushPromises();
    });

    expect(screen.queryByRole("button", { name: "重试最近失败 1" })).toBeNull();

    const releaseRun = releaseSecondRun as unknown as (() => void) | null;
    if (!releaseRun) {
      throw new Error("第二轮批量打开没有进入等待状态");
    }
    await act(async () => {
      releaseRun();
      await flushPromises();
    });
    openProfileSpy.mockRestore();
  });

  test("批量打开结果会在更多操作里按账号记录成功和失败", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockResolvedValueOnce("/tmp/profile")
      .mockRejectedValueOnce(new Error("Chrome 启动失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    const launchList = screen.getByRole("list", { name: "最近启动记录" });
    expect(within(launchList).getByText("主号")).toBeTruthy();
    expect(within(launchList).getByText("抽奖号")).toBeTruthy();
    expect(within(launchList).getAllByText("批量打开")).toHaveLength(2);
    expect(within(launchList).getAllByText("galxe.com")).toHaveLength(2);
    expect(within(launchList).getByText("Chrome 启动失败")).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("批量打开完成后会登记最近操作", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    const operationList = screen.getByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("批量打开")).toBeTruthy();
    expect(within(operationList).getByText("成功")).toBeTruthy();
    expect(within(operationList).getByText("2 / 2")).toBeTruthy();
    expect(within(operationList).getByText("galxe.com")).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("批量打开进行中会单独显示当前操作", async () => {
    const user = userEvent.setup();
    let resolveFirstLaunch: ((value: string) => void) | null = null;
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirstLaunch = resolve;
          })
      )
      .mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");

    fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    const currentList = await screen.findByRole("list", { name: "当前操作记录" });
    expect(within(currentList).getByText("批量打开")).toBeTruthy();
    expect(within(currentList).getByText("运行中")).toBeTruthy();
    expect(within(currentList).getByText("galxe.com")).toBeTruthy();
    expect(within(currentList).getByText("2 个账号")).toBeTruthy();
    expect(screen.getByText("还没有最近操作")).toBeTruthy();

    await act(async () => {
      resolveFirstLaunch?.("/tmp/profile");
      await Promise.resolve();
      fireEvent.click(screen.getByRole("button", { name: "停止" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    openProfileSpy.mockRestore();
  });

  test("项目打开会避开正在执行批量打开的同账号", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              profileIds: ["account-001"],
              intervalSeconds: 3
            })
          ]
        )
      )
    );
    let resolveBulkLaunch: ((value: string) => void) | null = null;
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveBulkLaunch = resolve;
          })
      )
      .mockResolvedValue("/tmp/project-profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "galxe.com");
    fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));

    await user.click(screen.getByRole("button", { name: "项目" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开项目 Galxe 每日" }));

    expect(await screen.findByText("主号 正在执行批量打开，请稍后再试")).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveBulkLaunch?.("/tmp/profile");
      await Promise.resolve();
      await Promise.resolve();
    });
    openProfileSpy.mockRestore();
  });

  test("批量打开会避开正在执行项目的同账号", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              profileIds: ["account-001"],
              intervalSeconds: 3
            })
          ]
        )
      )
    );
    let resolveProjectLaunch: ((value: string) => void) | null = null;
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveProjectLaunch = resolve;
          })
      )
      .mockResolvedValue("/tmp/bulk-profile");
    render(<App />);

    await user.click(screen.getByRole("button", { name: "项目" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开项目 Galxe 每日" }));

    await user.click(screen.getByRole("button", { name: "账号" }));
    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "zealy.io");
    fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));

    expect(
      await screen.findByText("主号 正在执行项目 Galxe 每日，请稍后再试")
    ).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveProjectLaunch?.("/tmp/profile");
      await Promise.resolve();
      await Promise.resolve();
    });
    openProfileSpy.mockRestore();
  });

  test("批量打开会避开正在单独启动的同账号", async () => {
    const user = userEvent.setup();
    let resolveProfileLaunch: ((value: string) => void) | null = null;
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveProfileLaunch = resolve;
          })
      )
      .mockResolvedValue("/tmp/bulk-profile");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "打开 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.type(await screen.findByLabelText("批量打开网址"), "zealy.io");
    fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));

    expect(await screen.findByText("主号 正在执行账号启动，请稍后再试")).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveProfileLaunch?.("/tmp/profile");
      await Promise.resolve();
      await Promise.resolve();
    });
    openProfileSpy.mockRestore();
  });

  test("单账号启动超时后会释放同账号操作守卫", async () => {
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockImplementationOnce(() => new Promise<string>(() => undefined))
      .mockResolvedValue("/tmp/bulk-profile");
    render(<App />);

    const openButton = await screen.findByRole("button", { name: "打开 主号" });
    vi.useFakeTimers();
    fireEvent.click(openButton);
    await flushPromises();

    fireEvent.click(screen.getByRole("button", { name: "选择 主号" }));
    fireEvent.change(screen.getByLabelText("批量打开网址"), {
      target: { value: "zealy.io" }
    });
    fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));

    expect(screen.getByText("主号 正在执行账号启动，请稍后再试")).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    await flushPromises();

    expect(screen.getByText("主号 启动超时，请稍后再试")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
    await flushPromises();

    expect(openProfileSpy).toHaveBeenCalledTimes(2);
    openProfileSpy.mockRestore();
  });

  test("批量打开网址会按自定义间隔逐个启动", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.clear(screen.getByLabelText("批量打开间隔秒"));
    await user.type(screen.getByLabelText("批量打开间隔秒"), "5");
    await user.type(screen.getByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
    });

    expect(openProfileSpy).toHaveBeenCalledTimes(1);
    expect(openProfileSpy).toHaveBeenLastCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "https://galxe.com"
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenLastCalledWith(
      "~/MultiChromeProfiles",
      "account-002",
      "/Applications/Google Chrome.app",
      "https://galxe.com"
    );
    expect(screen.getByText("已为 2 个账号打开网址")).toBeTruthy();

    openProfileSpy.mockRestore();
  });

  test("批量打开网址可以中途停止", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    expect(screen.getByLabelText("批量打开间隔秒")).toBeTruthy();
    await user.type(screen.getByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
    });

    expect(openProfileSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "停止" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("已停止，已打开 1 / 2 个账号")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    openProfileSpy.mockRestore();
  });

  test("停止批量打开后会把最近操作标记为已取消", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(screen.getByLabelText("批量打开网址"), "galxe.com");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "停止" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    const operationList = screen.getByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("批量打开")).toBeTruthy();
    expect(within(operationList).getByText("已取消")).toBeTruthy();
    expect(within(operationList).getByText("1 / 2")).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("批量打开网址后会记录最近网址并可回填", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(await screen.findByRole("button", { name: "选择 抽奖号" }));
    await user.type(screen.getByLabelText("批量打开网址"), "daily.example.com/checkin");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开指定网址" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(savedDocument().settings.recentUrls).toEqual([
      "https://daily.example.com/checkin"
    ]);

    fireEvent.change(screen.getByLabelText("批量打开网址"), {
      target: { value: "" }
    });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      screen.getByRole("button", { name: "使用最近网址 daily.example.com/checkin" })
    );

    expect((screen.getByLabelText("批量打开网址") as HTMLInputElement).value).toBe(
      "https://daily.example.com/checkin"
    );
    openProfileSpy.mockRestore();
  });

  test("可以把网址设为常用并删除", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.type(screen.getByLabelText("批量打开网址"), "daily.example.com/checkin");
    await openBulkMore(user);
    await user.click(screen.getByRole("button", { name: "设为常用" }));

    expect(await screen.findByText("已添加常用网址")).toBeTruthy();
    expect(savedDocument().settings.favoriteUrls).toEqual([
      "https://daily.example.com/checkin"
    ]);

    await user.clear(screen.getByLabelText("批量打开网址"));
    await user.click(
      screen.getByRole("button", { name: "使用常用网址 daily.example.com/checkin" })
    );

    expect((screen.getByLabelText("批量打开网址") as HTMLInputElement).value).toBe(
      "https://daily.example.com/checkin"
    );

    await user.click(
      screen.getByRole("button", { name: "删除常用网址 daily.example.com/checkin" })
    );

    expect(savedDocument().settings.favoriteUrls).toEqual([]);
    expect(screen.queryByRole("button", { name: "使用常用网址 daily.example.com/checkin" })).toBeNull();
  });

  test("网址库可以展示常用和最近网址并回填批量打开", async () => {
    const user = userEvent.setup();
    const document = documentWith([
      profile({ id: "account-001", name: "主号" }),
      profile({ id: "account-002", name: "抽奖号" })
    ]);
    document.settings.favoriteUrls = ["https://galxe.com"];
    document.settings.recentUrls = ["https://zealy.io"];
    localStorage.setItem("multichrome.profileDocument", JSON.stringify(document));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "网址库" }));

    expect(await screen.findByRole("heading", { name: "网址库" })).toBeTruthy();
    const table = screen.getByRole("table", { name: "网址库表格" });
    expect(within(table).getByRole("columnheader", { name: "名称" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "网址" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "标签" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "描述" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "操作" })).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "分类" })).toBeNull();
    expect(within(table).queryByRole("columnheader", { name: "常用" })).toBeNull();
    expect(within(table).getByText("galxe.com")).toBeTruthy();
    expect(within(table).queryByText("zealy.io")).toBeNull();
    expect(screen.queryByRole("button", { name: "新建网址" })).toBeNull();
    expect(screen.getByRole("button", { name: "新建" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "填入批量打开 galxe.com" }));

    expect(await screen.findByRole("button", { name: "选择 主号" })).toBeTruthy();
    expect((screen.getByLabelText("批量打开网址") as HTMLInputElement).value).toBe(
      "https://galxe.com"
    );
  });

  test("网址库填入网址后未选账号也会显示紧凑批量栏", async () => {
    const user = userEvent.setup();
    const document = documentWith([
      profile({ id: "account-001", name: "主号" }),
      profile({ id: "account-002", name: "抽奖号" })
    ]);
    document.settings.favoriteUrls = ["https://galxe.com"];
    localStorage.setItem("multichrome.profileDocument", JSON.stringify(document));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "网址库" }));
    await user.click(await screen.findByRole("button", { name: "填入批量打开 galxe.com" }));

    expect(await screen.findByRole("button", { name: "选择 主号" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "批量操作" })).toBeTruthy();
    expect(screen.getByText("未选择账号")).toBeTruthy();
    expect((screen.getByLabelText("批量打开网址") as HTMLInputElement).value).toBe(
      "https://galxe.com"
    );
    expect(screen.getByRole("button", { name: "打开指定网址" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "设为常用" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "更多操作" }));

    expect(screen.getByRole("button", { name: "设为常用" })).toBeTruthy();
  });

  test("账号页未选择账号时也固定显示紧凑批量栏", async () => {
    render(<App />);

    const header = document.querySelector(".launcher-header");
    const searchInput = await screen.findByRole("textbox", { name: "搜索账号" });
    expect(header?.contains(searchInput)).toBe(true);
    expect(screen.getByRole("region", { name: "批量操作" })).toBeTruthy();
    expect(screen.getByText("未选择账号")).toBeTruthy();
    expect((screen.getByLabelText("批量打开网址") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "打开新标签" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "设为常用" })).toBeNull();
  });

  test("网址库空状态也保持 Notion 风格表格", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "网址库" }));

    const table = await screen.findByRole("table", { name: "网址库表格" });
    expect(within(table).getByRole("columnheader", { name: "名称" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "网址" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "标签" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "描述" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "操作" })).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "分类" })).toBeNull();
    expect(within(table).queryByRole("columnheader", { name: "常用" })).toBeNull();
    expect(within(table).getByText("还没有常用网址")).toBeTruthy();
    expect(within(table).getByText("把每天会重复打开的活动页、任务页或平台官网保存到这里。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "新建网址" })).toBeNull();
    expect(screen.getByRole("button", { name: "新建" })).toBeTruthy();
  });

  test("网址库可以新增结构化常用网址并删除", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "网址库" }));
    await user.click(screen.getByRole("button", { name: "新建" }));
    const editor = await screen.findByRole("dialog", { name: "新建网址" });
    await user.type(within(editor).getByLabelText("网址名称"), "Galxe 每日");
    await user.type(within(editor).getByLabelText("网址 URL"), "galxe.com");
    await user.type(within(editor).getByLabelText("网址标签"), "平台, 每日");
    await user.type(within(editor).getByLabelText("网址备注"), "每天看任务");
    await user.click(within(editor).getByRole("button", { name: "保存网址" }));

    expect(await screen.findByText("已保存网址")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "新建网址" })).toBeNull();
    expect(savedDocument().settings.favoriteUrls).toEqual(["https://galxe.com"]);
    expect((savedDocument().settings as any).urlLibrary[0]).toMatchObject({
      name: "Galxe 每日",
      url: "https://galxe.com",
      tags: ["平台", "每日"],
      notes: "每天看任务"
    });

    await user.click(screen.getByRole("button", { name: "删除网址 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "确认删除网址" });
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

    expect(savedDocument().settings.favoriteUrls).toEqual([]);
    expect((savedDocument().settings as any).urlLibrary).toEqual([]);
  });

  test("网址库可以用选中账号直接打开网址", async () => {
    const user = userEvent.setup();
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    const document = documentWith([
      profile({ id: "account-001", name: "主号" }),
      profile({ id: "account-002", name: "抽奖号" })
    ]);
    document.settings.favoriteUrls = ["https://galxe.com"];
    localStorage.setItem("multichrome.profileDocument", JSON.stringify(document));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "网址库" }));
    await user.click(await screen.findByRole("button", { name: "用选中账号打开 galxe.com" }));

    expect(await screen.findByText("已为 1 个账号打开网址")).toBeTruthy();
    expect(openProfileSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "https://galxe.com"
    );
    expect(savedDocument().settings.recentUrls).toEqual(["https://galxe.com"]);
    openProfileSpy.mockRestore();
  });

  test("可以在项目页新建项目并绑定账号", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "新建项目" }));

    const dialog = await screen.findByRole("dialog", { name: "新建项目" });
    await user.clear(within(dialog).getByLabelText("项目名称"));
    await user.type(within(dialog).getByLabelText("项目名称"), "Galxe 每日");
    await user.type(within(dialog).getByLabelText("项目网址"), "galxe.com/quest");
    await user.clear(within(dialog).getByLabelText("项目打开间隔秒"));
    await user.type(within(dialog).getByLabelText("项目打开间隔秒"), "5");
    expect(within(dialog).queryByRole("checkbox", { name: "绑定 主号" })).toBeNull();

    const primaryProfileButton = within(dialog).getByRole("button", {
      name: "绑定账号 主号 account-001"
    });
    const raffleProfileButton = within(dialog).getByRole("button", {
      name: "绑定账号 抽奖号 account-002"
    });

    expect(primaryProfileButton.getAttribute("aria-pressed")).toBe("false");
    expect(primaryProfileButton.textContent).toBe("主号");
    expect(primaryProfileButton.textContent).not.toContain("account-001");
    await user.click(primaryProfileButton);
    await user.click(raffleProfileButton);
    expect(primaryProfileButton.getAttribute("aria-pressed")).toBe("true");

    expect(savedDocument().projects).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "保存项目" }));

    const project = savedDocument().projects[0];
    expect(project.name).toBe("Galxe 每日");
    expect(project.url).toBe("https://galxe.com/quest");
    expect(project.intervalSeconds).toBe(5);
    expect(project.profileIds).toEqual(["account-001", "account-002"]);

    expect(await screen.findByRole("button", { name: "打开项目 Galxe 每日" })).toBeTruthy();
  });

  test("stale 账号保存不会回滚并发新增的项目和网址库设置", async () => {
    const user = userEvent.setup();
    const delayedOpen = deferred<string>();
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockReturnValue(delayedOpen.promise);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));
    await waitFor(() => {
      expect(openProfileSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const projectDialog = await screen.findByRole("dialog", { name: "新建项目" });
    await user.clear(within(projectDialog).getByLabelText("项目名称"));
    await user.type(within(projectDialog).getByLabelText("项目名称"), "并发项目 A");
    await user.type(within(projectDialog).getByLabelText("项目网址"), "project.example");
    await user.click(
      within(projectDialog).getByRole("button", {
        name: "绑定账号 主号 account-001"
      })
    );
    await user.click(
      within(projectDialog).getByRole("button", { name: "保存项目" })
    );
    await waitFor(() => {
      expect(savedDocument().projects[0]?.name).toBe("并发项目 A");
    });
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const secondProjectDialog = await screen.findByRole("dialog", { name: "新建项目" });
    await user.clear(within(secondProjectDialog).getByLabelText("项目名称"));
    await user.type(within(secondProjectDialog).getByLabelText("项目名称"), "并发项目 B");
    await user.type(within(secondProjectDialog).getByLabelText("项目网址"), "project-b.example");
    await user.click(
      within(secondProjectDialog).getByRole("button", {
        name: "绑定账号 抽奖号 account-002"
      })
    );
    await user.click(
      within(secondProjectDialog).getByRole("button", { name: "保存项目" })
    );
    await waitFor(() => {
      expect(savedDocument().projects.map((item) => item.name)).toEqual([
        "并发项目 A",
        "并发项目 B"
      ]);
    });

    await user.click(screen.getByRole("button", { name: "网址库" }));
    await user.click(screen.getByRole("button", { name: "新建" }));
    const urlDialog = await screen.findByRole("dialog", { name: "新建网址" });
    await user.type(within(urlDialog).getByLabelText("网址名称"), "并发网址 A");
    await user.type(within(urlDialog).getByLabelText("网址 URL"), "url.example");
    await user.click(within(urlDialog).getByRole("button", { name: "保存网址" }));
    await waitFor(() => {
      expect(savedDocument().settings.urlLibrary[0]?.name).toBe("并发网址 A");
    });
    await user.click(screen.getByRole("button", { name: "新建" }));
    const secondUrlDialog = await screen.findByRole("dialog", { name: "新建网址" });
    await user.type(within(secondUrlDialog).getByLabelText("网址名称"), "并发网址 B");
    await user.type(within(secondUrlDialog).getByLabelText("网址 URL"), "url-b.example");
    await user.click(within(secondUrlDialog).getByRole("button", { name: "保存网址" }));
    await waitFor(() => {
      expect(savedDocument().settings.urlLibrary.map((item: any) => item.name)).toEqual([
        "并发网址 B",
        "并发网址 A"
      ]);
    });

    await act(async () => {
      delayedOpen.resolve("/tmp/account-001");
      await delayedOpen.promise;
    });

    await waitFor(() => {
      const stored = savedDocument();
      expect(stored.projects.map((item) => item.name)).toEqual([
        "并发项目 A",
        "并发项目 B"
      ]);
      expect(stored.projects.map((item) => item.profileIds)).toEqual([
        ["account-001"],
        ["account-002"]
      ]);
      expect(stored.settings.urlLibrary.map((item: any) => item.name)).toEqual([
        "并发网址 B",
        "并发网址 A"
      ]);
      expect(stored.settings.urlLibrary.map((item: any) => item.url)).toEqual([
        "https://url-b.example",
        "https://url.example"
      ]);
      expect(stored.profiles[0].lastOpenedAt).not.toBeNull();
    });
    openProfileSpy.mockRestore();
  });

  test("stale 账号保存后满额 recentUrls 的新网址和置顶顺序仍保留", async () => {
    const user = userEvent.setup();
    const delayedOpen = deferred<string>();
    const document = savedDocument();
    document.settings.recentUrls = [
      "https://old-01.example",
      "https://old-02.example",
      "https://old-03.example",
      "https://old-04.example",
      "https://old-05.example",
      "https://old-06.example",
      "https://old-07.example",
      "https://old-08.example",
      "https://old-09.example",
      "https://old-10.example"
    ];
    localStorage.setItem("multichrome.profileDocument", JSON.stringify(document));
    let openCallCount = 0;
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockImplementation(() => {
        openCallCount += 1;
        return openCallCount === 1
          ? delayedOpen.promise
          : Promise.resolve("/tmp/account-001");
      });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));
    await waitFor(() => {
      expect(openProfileSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "选择 抽奖号" }));
    await user.type(screen.getByLabelText("批量打开网址"), "fresh.example");
    await user.click(screen.getByRole("button", { name: "打开指定网址" }));
    await waitFor(() => {
      expect(savedDocument().settings.recentUrls[0]).toBe("https://fresh.example");
    });

    await user.clear(screen.getByLabelText("批量打开网址"));
    await user.type(screen.getByLabelText("批量打开网址"), "old-05.example");
    await user.click(screen.getByRole("button", { name: "打开指定网址" }));
    await waitFor(() => {
      expect(savedDocument().settings.recentUrls[0]).toBe(
        "https://old-05.example"
      );
    });

    await act(async () => {
      delayedOpen.resolve("/tmp/account-001");
      await delayedOpen.promise;
    });

    await waitFor(() => {
      expect(savedDocument().profiles[0].lastOpenedAt).not.toBeNull();
    });
    expect(savedDocument().settings.recentUrls.slice(0, 2)).toEqual([
      "https://old-05.example",
      "https://fresh.example"
    ]);
    expect(savedDocument().settings.recentUrls).toHaveLength(10);
    openProfileSpy.mockRestore();
  });

  test("stale 账号保存后并发新增的网址库项目仍保留在头部", async () => {
    const user = userEvent.setup();
    const delayedOpen = deferred<string>();
    const document = savedDocument();
    document.settings.urlLibrary = [
      {
        id: "url-001",
        name: "旧网址",
        url: "https://old.example",
        tags: [],
        notes: "",
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z"
      } as any
    ];
    localStorage.setItem("multichrome.profileDocument", JSON.stringify(document));
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockReturnValue(delayedOpen.promise);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "打开 主号" }));
    await waitFor(() => {
      expect(openProfileSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "网址库" }));
    await user.click(screen.getByRole("button", { name: "新建" }));
    const urlDialog = await screen.findByRole("dialog", { name: "新建网址" });
    await user.type(within(urlDialog).getByLabelText("网址名称"), "新网址 A");
    await user.type(within(urlDialog).getByLabelText("网址 URL"), "fresh.example");
    await user.click(within(urlDialog).getByRole("button", { name: "保存网址" }));
    await waitFor(() => {
      expect(savedDocument().settings.urlLibrary[0]?.name).toBe("新网址 A");
    });
    await user.click(screen.getByRole("button", { name: "新建" }));
    const secondUrlDialog = await screen.findByRole("dialog", { name: "新建网址" });
    await user.type(within(secondUrlDialog).getByLabelText("网址名称"), "新网址 B");
    await user.type(within(secondUrlDialog).getByLabelText("网址 URL"), "fresh-b.example");
    await user.click(within(secondUrlDialog).getByRole("button", { name: "保存网址" }));
    await waitFor(() => {
      expect(savedDocument().settings.urlLibrary.map((item: any) => item.name)).toEqual([
        "新网址 B",
        "新网址 A",
        "旧网址"
      ]);
    });

    await act(async () => {
      delayedOpen.resolve("/tmp/account-001");
      await delayedOpen.promise;
    });

    await waitFor(() => {
      expect(savedDocument().profiles[0].lastOpenedAt).not.toBeNull();
    });
    expect(savedDocument().settings.urlLibrary.map((item: any) => item.name)).toEqual([
      "新网址 B",
      "新网址 A",
      "旧网址"
    ]);
    openProfileSpy.mockRestore();
  });

  test("复用同 ID 的新网址不会被旧网址编辑草稿覆盖", async () => {
    const user = userEvent.setup();
    const document = savedDocument();
    document.settings.urlLibrary = [
      {
        id: "url-001",
        name: "旧网址",
        url: "https://old.example",
        tags: ["旧"],
        notes: "旧备注",
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z"
      } as any
    ];
    localStorage.setItem("multichrome.profileDocument", JSON.stringify(document));
    const restoredDocument = documentWith(document.profiles, document.projects);
    restoredDocument.settings.urlLibrary = [
      {
        id: "url-001",
        name: "复用新网址",
        url: "https://fresh.example",
        tags: ["新"],
        notes: "新备注",
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z"
      } as any
    ];
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockImplementation(async () => {
        localStorage.setItem(
          "multichrome.profileDocument",
          JSON.stringify(restoredDocument)
        );
        return restoredDocument;
      });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "网址库" }));
    await user.click(screen.getByRole("button", { name: "编辑网址 旧网址" }));
    const urlDialog = await screen.findByRole("dialog", { name: "编辑网址" });
    await user.clear(within(urlDialog).getByLabelText("网址名称"));
    await user.type(within(urlDialog).getByLabelText("网址名称"), "旧草稿覆盖");
    await user.clear(within(urlDialog).getByLabelText("网址 URL"));
    await user.type(within(urlDialog).getByLabelText("网址 URL"), "stale.example");

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const settingsDialog = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.change(within(settingsDialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/replacement-backup.json" }
    });
    await user.click(within(settingsDialog).getByRole("button", { name: "从备份恢复" }));
    expect(await within(settingsDialog).findByText("确认从备份恢复")).toBeTruthy();
    await user.click(within(settingsDialog).getByRole("button", { name: "确认恢复" }));
    await waitFor(() => {
      expect(savedDocument().settings.urlLibrary[0]?.name).toBe("复用新网址");
    });
    await user.click(within(settingsDialog).getByRole("button", { name: "关闭设置" }));

    await user.click(within(urlDialog).getByRole("button", { name: "保存网址" }));
    await flushPromises();

    expect(savedDocument().settings.urlLibrary).toEqual([
      expect.objectContaining({
        id: "url-001",
        name: "复用新网址",
        url: "https://fresh.example",
        createdAt: "2026-07-16T00:00:00.000Z"
      })
    ]);
    restoreBackupSpy.mockRestore();
  });

  test("项目可以保存多个网址并在卡片显示网址数量", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "新建项目" }));

    const dialog = await screen.findByRole("dialog", { name: "新建项目" });
    await user.clear(within(dialog).getByLabelText("项目名称"));
    await user.type(within(dialog).getByLabelText("项目名称"), "Galxe 每日");
    await user.clear(within(dialog).getByLabelText("网址名称 1"));
    await user.type(within(dialog).getByLabelText("网址名称 1"), "Galxe");
    await user.type(within(dialog).getByLabelText("项目网址"), "galxe.com/quest");
    await user.type(within(dialog).getByLabelText("网址备注 1"), "每日任务");

    await user.click(within(dialog).getByRole("button", { name: "添加网址" }));
    await user.clear(within(dialog).getByLabelText("网址名称 2"));
    await user.type(within(dialog).getByLabelText("网址名称 2"), "X 帖子");
    await user.type(within(dialog).getByLabelText("项目网址 2"), "x.com/project/status/1");
    await user.type(within(dialog).getByLabelText("网址备注 2"), "评论入口");

    await user.click(within(dialog).getByRole("button", { name: "保存项目" }));

    const project = savedDocument().projects[0];
    expect(project.url).toBe("https://galxe.com/quest");
    expect(project.urls).toEqual([
      {
        id: "url-001",
        name: "Galxe",
        url: "https://galxe.com/quest",
        notes: "每日任务"
      },
      {
        id: "url-002",
        name: "X 帖子",
        url: "https://x.com/project/status/1",
        notes: "评论入口"
      }
    ]);
    expect(await screen.findByText("2 个网址")).toBeTruthy();
  });

  test("项目可以批量导入多行网址", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "新建项目" }));

    const dialog = await screen.findByRole("dialog", { name: "新建项目" });
    await user.clear(within(dialog).getByLabelText("项目名称"));
    await user.type(within(dialog).getByLabelText("项目名称"), "Monad 活动");
    await user.click(within(dialog).getByRole("button", { name: "批量导入网址" }));
    await user.type(
      within(dialog).getByLabelText("批量网址文本"),
      [
        "Galxe https://galxe.com/quest 每日任务",
        "X 帖子 https://x.com/project/status/1 评论入口",
        "https://project.example.com"
      ].join("\n")
    );
    await user.click(within(dialog).getByRole("button", { name: "应用导入网址" }));
    await user.click(within(dialog).getByRole("button", { name: "保存项目" }));

    const project = savedDocument().projects[0];
    expect(project.urls).toEqual([
      {
        id: "url-001",
        name: "Galxe",
        url: "https://galxe.com/quest",
        notes: "每日任务"
      },
      {
        id: "url-002",
        name: "X 帖子",
        url: "https://x.com/project/status/1",
        notes: "评论入口"
      },
      {
        id: "url-003",
        name: "project.example.com",
        url: "https://project.example.com",
        notes: ""
      }
    ]);
    expect(await screen.findByText("3 个网址")).toBeTruthy();
  });

  test("项目网址可以上移和下移排序", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              urls: [
                projectUrl({ id: "url-001", name: "Galxe", url: "https://galxe.com/quest" }),
                projectUrl({ id: "url-002", name: "X 帖子", url: "https://x.com/project/status/1" }),
                projectUrl({ id: "url-003", name: "官网", url: "https://project.example.com" })
              ]
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });

    await user.click(within(dialog).getByRole("button", { name: "下移网址 Galxe" }));
    await user.click(within(dialog).getByRole("button", { name: "上移网址 官网" }));
    await user.click(within(dialog).getByRole("button", { name: "保存项目" }));

    expect(savedDocument().projects[0].urls.map((projectUrl) => projectUrl.name)).toEqual([
      "X 帖子",
      "官网",
      "Galxe"
    ]);
  });

  test("项目网址可以复制单条网址", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              urls: [
                projectUrl({ id: "url-001", name: "Galxe", url: "https://galxe.com/quest" })
              ]
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });
    await user.click(within(dialog).getByRole("button", { name: "复制网址 Galxe" }));

    expect(writeText).toHaveBeenCalledWith("https://galxe.com/quest");
    expect(await screen.findByText("网址已复制")).toBeTruthy();
  });

  test("新建项目取消后不会留下项目", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const dialog = await screen.findByRole("dialog", { name: "新建项目" });
    await user.type(within(dialog).getByLabelText("项目名称"), "Zealy 打卡");
    await user.type(within(dialog).getByLabelText("项目网址"), "zealy.io");
    await user.click(
      within(dialog).getByRole("button", { name: "绑定账号 主号 account-001" })
    );

    await user.click(within(dialog).getByRole("button", { name: "取消新建项目" }));

    expect(savedDocument().projects).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "打开项目 Zealy 打卡" })).toBeNull();
  });

  test("项目会按绑定账号和间隔打开网址", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              profileIds: ["account-001", "account-002"],
              intervalSeconds: 4
            })
          ]
        )
      )
    );
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));
    });

    expect(openProfileSpy).toHaveBeenCalledTimes(1);
    expect(openProfileSpy).toHaveBeenLastCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "https://galxe.com/quest"
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenLastCalledWith(
      "~/MultiChromeProfiles",
      "account-002",
      "/Applications/Google Chrome.app",
      "https://galxe.com/quest"
    );
    expect(screen.getByText("已打开项目 Galxe 每日：2 个账号")).toBeTruthy();

    openProfileSpy.mockRestore();
  });

  test("项目打开完成后会登记最近操作", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              profileIds: ["account-001", "account-002"],
              intervalSeconds: 3
            })
          ]
        )
      )
    );
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    const operationList = screen.getByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("打开项目")).toBeTruthy();
    expect(within(operationList).getByText("成功")).toBeTruthy();
    expect(within(operationList).getByText("2 / 2")).toBeTruthy();
    expect(within(operationList).getByText("Galxe 每日")).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("复用同 ID 的新项目不会被旧项目打开完成回写", async () => {
    const user = userEvent.setup();
    const delayedOpen = deferred<string>();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "旧项目",
              url: "https://old-project.example",
              profileIds: ["account-001"]
            })
          ]
        )
      )
    );
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockReturnValue(delayedOpen.promise);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "打开项目 旧项目" }));
    await waitFor(() => {
      expect(openProfileSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "编辑项目 旧项目" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑项目 旧项目" });
    await user.click(within(editDialog).getByRole("button", { name: "删除项目" }));
    await user.click(within(editDialog).getByRole("button", { name: "确认删除项目" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "打开项目 旧项目" })).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const newProjectDialog = await screen.findByRole("dialog", { name: "新建项目" });
    await user.clear(within(newProjectDialog).getByLabelText("项目名称"));
    await user.type(within(newProjectDialog).getByLabelText("项目名称"), "复用新项目");
    await user.clear(within(newProjectDialog).getByLabelText("项目网址"));
    await user.type(
      within(newProjectDialog).getByLabelText("项目网址"),
      "fresh-project.example"
    );
    await user.click(
      within(newProjectDialog).getByRole("button", {
        name: "绑定账号 主号 account-001"
      })
    );
    await user.click(within(newProjectDialog).getByRole("button", { name: "保存项目" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "打开项目 复用新项目" })).toBeTruthy();
    });

    const replacementBeforeStaleOpen = savedDocument().projects.find(
      (item) => item.id === "project-001"
    );
    expect(replacementBeforeStaleOpen?.name).toBe("复用新项目");
    expect(replacementBeforeStaleOpen?.lastOpenedAt).toBeNull();

    await act(async () => {
      delayedOpen.resolve("/tmp/account-001");
      await delayedOpen.promise;
    });

    await flushPromises();
    const replacementAfterStaleOpen = savedDocument().projects.find(
      (item) => item.id === "project-001"
    );
    expect(replacementAfterStaleOpen?.name).toBe("复用新项目");
    expect(replacementAfterStaleOpen?.createdAt).toBe(
      replacementBeforeStaleOpen?.createdAt
    );
    expect(replacementAfterStaleOpen?.lastOpenedAt).toBeNull();
    openProfileSpy.mockRestore();
  });

  test("项目打开会标记启动中并触发短确认刷新", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              profileIds: ["account-001"]
            })
          ]
        )
      )
    );
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValueOnce([browserSessionSnapshot("account-001", false)])
      .mockResolvedValueOnce([browserSessionSnapshot("account-001", true)]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    const card = screen.getByRole("button", { name: "选择 主号" });

    expect(within(card).getByText("启动中")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushPromises();

    expect(within(card).getByText("运行中")).toBeTruthy();
    expect(snapshotSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenCalledOnce();
    openProfileSpy.mockRestore();
    snapshotSpy.mockRestore();
  });

  test("项目打开全部网址会按账号队列打开每个网址", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              urls: [
                projectUrl({
                  id: "url-001",
                  name: "Galxe",
                  url: "https://galxe.com/quest"
                }),
                projectUrl({
                  id: "url-002",
                  name: "X 帖子",
                  url: "https://x.com/project/status/1"
                })
              ],
              profileIds: ["account-001", "account-002"],
              intervalSeconds: 4
            })
          ]
        )
      )
    );
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));
    });

    expect(openProfileSpy).toHaveBeenCalledTimes(2);
    expect(openProfileSpy).toHaveBeenNthCalledWith(
      1,
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "https://galxe.com/quest"
    );
    expect(openProfileSpy).toHaveBeenNthCalledWith(
      2,
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "https://x.com/project/status/1"
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(4);
    expect(openProfileSpy).toHaveBeenNthCalledWith(
      3,
      "~/MultiChromeProfiles",
      "account-002",
      "/Applications/Google Chrome.app",
      "https://galxe.com/quest"
    );
    expect(openProfileSpy).toHaveBeenNthCalledWith(
      4,
      "~/MultiChromeProfiles",
      "account-002",
      "/Applications/Google Chrome.app",
      "https://x.com/project/status/1"
    );
    expect(screen.getByText("已打开项目 Galxe 每日：2 个账号，2 个网址")).toBeTruthy();

    openProfileSpy.mockRestore();
  });

  test("项目可以只打开选中的单个网址", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              urls: [
                projectUrl({
                  id: "url-001",
                  name: "Galxe",
                  url: "https://galxe.com/quest"
                }),
                projectUrl({
                  id: "url-002",
                  name: "X 帖子",
                  url: "https://x.com/project/status/1"
                })
              ],
              profileIds: ["account-001"]
            })
          ]
        )
      )
    );
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.selectOptions(
      screen.getByLabelText("Galxe 每日 打开网址"),
      "url-002"
    );
    await user.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));

    expect(openProfileSpy).toHaveBeenCalledTimes(1);
    expect(openProfileSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      "/Applications/Google Chrome.app",
      "https://x.com/project/status/1"
    );
    expect(screen.getByText("已打开项目 Galxe 每日：1 个账号，X 帖子")).toBeTruthy();

    openProfileSpy.mockRestore();
  });

  test("项目打开部分失败时会提示失败账号和原因", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              profileIds: ["account-001", "account-002"]
            })
          ]
        )
      )
    );
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockResolvedValueOnce("/tmp/profile")
      .mockRejectedValueOnce(new Error("Chrome 启动失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(
      screen.getByText(
        "已打开项目 Galxe 每日：1 个账号，1 个失败（抽奖号：Chrome 启动失败）"
      )
    ).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("项目账号任一网址失败时该账号整体不算打开成功", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              urls: [
                projectUrl({
                  id: "url-001",
                  name: "Galxe",
                  url: "https://galxe.com/quest"
                }),
                projectUrl({
                  id: "url-002",
                  name: "X 帖子",
                  url: "https://x.com/project/status/1"
                })
              ],
              profileIds: ["account-001"]
            })
          ]
        )
      )
    );
    const openProfileSpy = vi
      .spyOn(profileApi, "openProfile")
      .mockResolvedValueOnce("/tmp/profile")
      .mockRejectedValueOnce(new Error("第二个网址失败"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));

    expect(openProfileSpy).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(
        "已打开项目 Galxe 每日：0 个账号，2 个网址，1 个失败（主号：第二个网址失败）"
      )
    ).toBeTruthy();
    expect(savedDocument().profiles[0].lastOpenedAt).toBeNull();
    openProfileSpy.mockRestore();
  });

  test("项目页可以搜索项目名称、网址和备注", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              notes: "每天签到"
            }),
            project({
              id: "project-002",
              name: "Zealy 抽奖",
              url: "https://zealy.io/campaign",
              notes: "每周任务"
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.type(await screen.findByLabelText("搜索项目"), "galxe");

    expect(screen.getByRole("button", { name: "打开项目 Galxe 每日" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开项目 Zealy 抽奖" })).toBeNull();
  });

  test("项目卡片保持精简，低频资料留在编辑弹窗", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              notes: "每天签到",
              profileIds: ["account-001"],
              intervalSeconds: 7
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));

    expect(screen.getByRole("button", { name: "打开项目 Galxe 每日" })).toBeTruthy();
    expect(screen.getByText("1 个账号")).toBeTruthy();
    expect(screen.getByText("间隔 7 秒")).toBeTruthy();
    expect(screen.queryByText("每天签到")).toBeNull();
    expect(screen.queryByText("主号")).toBeNull();
    expect(screen.queryByRole("button", { name: "复制项目 Galxe 每日" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });

    expect(within(dialog).getByDisplayValue("每天签到")).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("button", { name: "绑定账号 主号 account-001" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(within(dialog).getByRole("button", { name: "复制项目" })).toBeTruthy();
  });

  test("项目编辑弹窗使用统一滚动内容和固定保存栏", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              notes: "每天签到",
              profileIds: ["account-001"]
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });
    const directChildren = Array.from(dialog.children).map((child) => child.className);
    const body = dialog.querySelector(":scope > .modal-body");
    const footer = dialog.querySelector(":scope > .modal-footer");

    expect(directChildren).toEqual(["modal-header", "modal-body", "modal-footer"]);
    expect(body?.contains(within(dialog).getByLabelText("项目名称"))).toBe(true);
    expect(body?.querySelector(".project-edit-actions")).not.toBeNull();
    expect(body?.querySelector(".danger-zone")).not.toBeNull();
    expect(
      footer?.contains(within(dialog).getByRole("button", { name: "保存项目" }))
    ).toBe(true);
  });

  test("可以在编辑弹窗复制项目并保留网址、备注、绑定账号和间隔", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              notes: "每天签到",
              profileIds: ["account-001"],
              intervalSeconds: 7
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });
    await user.click(within(dialog).getByRole("button", { name: "复制项目" }));

    const copied = savedDocument().projects[1];
    expect(copied.name).toBe("Galxe 每日 副本");
    expect(copied.url).toBe("https://galxe.com/quest");
    expect(copied.notes).toBe("每天签到");
    expect(copied.profileIds).toEqual(["account-001"]);
    expect(copied.intervalSeconds).toBe(7);
    expect(await screen.findByRole("button", { name: "打开项目 Galxe 每日 副本" })).toBeTruthy();
  });

  test("可以在编辑弹窗删除项目", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest"
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });
    await user.click(within(dialog).getByRole("button", { name: "删除项目" }));
    await user.click(within(dialog).getByRole("button", { name: "确认删除项目" }));

    expect(savedDocument().projects).toEqual([]);
    expect(screen.queryByRole("button", { name: "打开项目 Galxe 每日" })).toBeNull();
  });

  test("编辑已有项目关闭后会丢弃草稿", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              notes: "每天签到",
              profileIds: ["account-001"],
              intervalSeconds: 4
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });

    await user.clear(within(dialog).getByLabelText("项目名称"));
    await user.type(within(dialog).getByLabelText("项目名称"), "Zealy 打卡");
    await user.clear(within(dialog).getByLabelText("项目网址"));
    await user.type(within(dialog).getByLabelText("项目网址"), "zealy.io");
    await user.clear(within(dialog).getByLabelText("项目打开间隔秒"));
    await user.type(within(dialog).getByLabelText("项目打开间隔秒"), "9");
    await user.clear(within(dialog).getByLabelText("备注"));
    await user.type(within(dialog).getByLabelText("备注"), "每周任务");

    await user.click(within(dialog).getByRole("button", { name: "关闭项目编辑" }));

    const storedProject = savedDocument().projects[0];
    expect(storedProject.name).toBe("Galxe 每日");
    expect(storedProject.url).toBe("https://galxe.com/quest");
    expect(storedProject.intervalSeconds).toBe(4);
    expect(storedProject.notes).toBe("每天签到");
    expect(await screen.findByRole("button", { name: "打开项目 Galxe 每日" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开项目 Zealy 打卡" })).toBeNull();
  });

  test("编辑已有项目点击遮罩关闭也会丢弃草稿", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest"
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });

    await user.clear(within(dialog).getByLabelText("项目名称"));
    await user.type(within(dialog).getByLabelText("项目名称"), "未保存项目");
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);

    expect(savedDocument().projects[0].name).toBe("Galxe 每日");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(await screen.findByRole("button", { name: "打开项目 Galxe 每日" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开项目 未保存项目" })).toBeNull();
  });

  test("编辑已有项目按 Esc 会关闭且丢弃草稿", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [profile({ id: "account-001", name: "主号" })],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest"
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });
    await user.clear(within(dialog).getByLabelText("项目名称"));
    await user.type(within(dialog).getByLabelText("项目名称"), "Esc 项目");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(savedDocument().projects[0].name).toBe("Galxe 每日");
    expect(await screen.findByRole("button", { name: "打开项目 Galxe 每日" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开项目 Esc 项目" })).toBeNull();
  });

  test("编辑已有项目点击保存后才写入修改", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              notes: "每天签到",
              profileIds: ["account-001"],
              intervalSeconds: 4
            })
          ]
        )
      )
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));
    await user.click(screen.getByRole("button", { name: "编辑项目 Galxe 每日" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑项目 Galxe 每日" });

    await user.clear(within(dialog).getByLabelText("项目名称"));
    await user.type(within(dialog).getByLabelText("项目名称"), "Zealy 打卡");
    await user.clear(within(dialog).getByLabelText("项目网址"));
    await user.type(within(dialog).getByLabelText("项目网址"), "zealy.io/campaign");
    await user.clear(within(dialog).getByLabelText("项目打开间隔秒"));
    await user.type(within(dialog).getByLabelText("项目打开间隔秒"), "8");
    await user.click(
      within(dialog).getByRole("button", { name: "绑定账号 抽奖号 account-002" })
    );
    await user.clear(within(dialog).getByLabelText("备注"));
    await user.type(within(dialog).getByLabelText("备注"), "每周任务");

    expect(savedDocument().projects[0].name).toBe("Galxe 每日");

    await user.click(within(dialog).getByRole("button", { name: "保存项目" }));

    const storedProject = savedDocument().projects[0];
    expect(storedProject.name).toBe("Zealy 打卡");
    expect(storedProject.url).toBe("https://zealy.io/campaign");
    expect(storedProject.intervalSeconds).toBe(8);
    expect(storedProject.profileIds).toEqual(["account-001", "account-002"]);
    expect(storedProject.notes).toBe("每周任务");
    expect(await screen.findByRole("button", { name: "打开项目 Zealy 打卡" })).toBeTruthy();
  });

  test("项目打开队列可以中途停止", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              profileIds: ["account-001", "account-002"],
              intervalSeconds: 4
            })
          ]
        )
      )
    );
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));
    });

    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "停止项目 Galxe 每日" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("已停止项目 Galxe 每日，已打开 1 / 2 个账号")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(openProfileSpy).toHaveBeenCalledTimes(1);

    openProfileSpy.mockRestore();
  });

  test("停止项目打开后会把最近操作标记为已取消", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "multichrome.profileDocument",
      JSON.stringify(
        documentWith(
          [
            profile({ id: "account-001", name: "主号" }),
            profile({ id: "account-002", name: "抽奖号" })
          ],
          [
            project({
              id: "project-001",
              name: "Galxe 每日",
              url: "https://galxe.com/quest",
              profileIds: ["account-001", "account-002"],
              intervalSeconds: 4
            })
          ]
        )
      )
    );
    const openProfileSpy = vi.spyOn(profileApi, "openProfile").mockResolvedValue("/tmp/profile");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "项目" }));

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "停止项目 Galxe 每日" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    const operationList = screen.getByRole("list", { name: "最近操作记录" });
    expect(within(operationList).getByText("打开项目")).toBeTruthy();
    expect(within(operationList).getByText("已取消")).toBeTruthy();
    expect(within(operationList).getByText("1 / 2")).toBeTruthy();
    expect(within(operationList).getByText("Galxe 每日")).toBeTruthy();
    openProfileSpy.mockRestore();
  });

  test("编辑弹窗可以设置账号颜色", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.click(within(dialog).getByRole("button", { name: "选择颜色 深蓝" }));

    expect(savedDocument().profiles[0].accentColor).toBeUndefined();

    await user.click(within(dialog).getByRole("button", { name: "保存账号" }));

    await waitFor(() => {
      expect(savedDocument().profiles[0].accentColor).toBe("blue");
    });
  });

  test("设置弹窗点击外部会关闭", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    const backdrop = dialog.parentElement;

    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop as HTMLElement);

    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
  });

  test("设置弹窗关闭会丢弃未保存的 Chrome 路径草稿", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.change(within(dialog).getByLabelText("Chrome 路径"), {
      target: { value: "/tmp/Test Chrome.app" }
    });

    await user.click(within(dialog).getByRole("button", { name: "关闭设置" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: "设置" });

    expect((within(reopenedDialog).getByLabelText("Chrome 路径") as HTMLInputElement).value).toBe(
      "/Applications/Google Chrome.app"
    );
    expect(savedDocument().settings.browserPath).toBe("/Applications/Google Chrome.app");
  });

  test("设置弹窗关闭会丢弃未检测的配置根目录草稿", async () => {
    const user = userEvent.setup();
    const initProfileRootSpy = vi.spyOn(profileApi, "initProfileRoot");
    const loadProfilesSpy = vi.spyOn(profileApi, "loadProfiles");
    render(<App />);

    const dialog = await openSettingsDialog(user);
    initProfileRootSpy.mockClear();
    loadProfilesSpy.mockClear();
    const documentBeforeClose = savedDocument();
    changeRootPathDraft(dialog, "/tmp/other-root");

    await user.click(within(dialog).getByRole("button", { name: "关闭设置" }));
    const reopenedDialog = await openSettingsDialog(user);

    expect((within(reopenedDialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
      "~/MultiChromeProfiles"
    );
    expect(initProfileRootSpy).not.toHaveBeenCalled();
    expect(loadProfilesSpy).not.toHaveBeenCalled();
    expect(savedDocument()).toEqual(documentBeforeClose);
    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
  });

  test("设置弹窗保存会应用配置根目录草稿", async () => {
    const user = userEvent.setup();
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles");
    render(<App />);

    const dialog = await openSettingsDialog(user);
    changeRootPathDraft(dialog, "/tmp/other-root");
    await user.click(within(dialog).getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(saveProfilesSpy).toHaveBeenCalledWith(
        "/tmp/other-root",
        expect.objectContaining({ settings: expect.any(Object) })
      );
    });
    saveProfilesSpy.mockRestore();
  });

  test("旧 root 普通保存返回后不会覆盖新 root 的 UI 和 refs", async () => {
    const user = userEvent.setup();
    const oldRootSave = deferred<void>();
    const targetDocument = documentWith([
      profile({ id: "target-001", name: "目标账号" })
    ]);
    const loadProfilesSpy = vi
      .spyOn(profileApi, "loadProfiles")
      .mockImplementation(async (path) =>
        path === "/tmp/other-root" ? targetDocument : savedDocument()
      );
    const saveProfilesSpy = vi
      .spyOn(profileApi, "saveProfiles")
      .mockImplementation((path) =>
        path === "~/MultiChromeProfiles" ? oldRootSave.promise : Promise.resolve()
      );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(editDialog).getByLabelText("名称"));
    await user.type(within(editDialog).getByLabelText("名称"), "旧根改名");
    await user.click(within(editDialog).getByRole("button", { name: "保存账号" }));
    await waitFor(() => {
      expect(saveProfilesSpy).toHaveBeenCalledWith(
        "~/MultiChromeProfiles",
        expect.any(Object)
      );
    });

    const settingsDialog = await openSettingsDialog(user);
    changeRootPathDraft(settingsDialog, "/tmp/other-root");
    await user.click(within(settingsDialog).getByRole("button", { name: "保存设置" }));
    expect(await screen.findByRole("button", { name: "选择 目标账号" })).toBeTruthy();

    await act(async () => {
      oldRootSave.resolve();
      await oldRootSave.promise;
    });

    expect(screen.getByRole("button", { name: "选择 目标账号" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "选择 旧根改名" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "编辑 目标账号" }));
    const targetDialog = await screen.findByRole("dialog", { name: "编辑 目标账号" });
    await user.clear(within(targetDialog).getByLabelText("名称"));
    await user.type(within(targetDialog).getByLabelText("名称"), "目标根改名");
    await user.click(within(targetDialog).getByRole("button", { name: "保存账号" }));
    await waitFor(() => {
      const targetSaves = saveProfilesSpy.mock.calls.filter(
        ([path]) => path === "/tmp/other-root"
      );
      expect(targetSaves[targetSaves.length - 1]?.[1].profiles).toEqual([
        expect.objectContaining({ id: "target-001", name: "目标根改名" })
      ]);
    });
    loadProfilesSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("设置弹窗检测空白配置根目录不会加载或切换根目录", async () => {
    const user = userEvent.setup();
    const initProfileRootSpy = vi.spyOn(profileApi, "initProfileRoot");
    const loadProfilesSpy = vi.spyOn(profileApi, "loadProfiles");
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    const dialog = await openSettingsDialog(user);
    initProfileRootSpy.mockClear();
    loadProfilesSpy.mockClear();
    saveProfilesSpy.mockClear();
    changeRootPathDraft(dialog, "   ");
    await detectRootPathDraft(user, dialog);

    expect(screen.getByRole("status").textContent).toBe("请先填写配置根目录");
    expect(initProfileRootSpy).not.toHaveBeenCalled();
    expect(loadProfilesSpy).not.toHaveBeenCalled();
    expect(saveProfilesSpy).not.toHaveBeenCalled();

    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("设置弹窗保存空白配置根目录不会加载或保存", async () => {
    const user = userEvent.setup();
    const initProfileRootSpy = vi.spyOn(profileApi, "initProfileRoot");
    const loadProfilesSpy = vi.spyOn(profileApi, "loadProfiles");
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles");
    render(<App />);

    const dialog = await openSettingsDialog(user);
    initProfileRootSpy.mockClear();
    loadProfilesSpy.mockClear();
    saveProfilesSpy.mockClear();
    changeRootPathDraft(dialog, "   ");
    await user.click(within(dialog).getByRole("button", { name: "保存设置" }));

    expect(screen.getByRole("status").textContent).toBe("请先填写配置根目录");
    expect(initProfileRootSpy).not.toHaveBeenCalled();
    expect(loadProfilesSpy).not.toHaveBeenCalled();
    expect(saveProfilesSpy).not.toHaveBeenCalled();

    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("设置弹窗保存切换根目录失败时保留当前根和设置草稿", async () => {
    const user = userEvent.setup();
    const targetDocument = documentWith([profile({ id: "target-001", name: "目标账号" })]);
    const initProfileRootSpy = vi.spyOn(profileApi, "initProfileRoot");
    const loadProfilesSpy = vi.spyOn(profileApi, "loadProfiles");
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    const dialog = await openSettingsDialog(user);
    initProfileRootSpy.mockResolvedValue({ rootExists: true, writable: true, profileCount: 1 });
    loadProfilesSpy.mockResolvedValue(targetDocument);
    saveProfilesSpy.mockRejectedValue(new Error("目标根写入失败"));
    changeRootPathDraft(dialog, "/tmp/other-root");
    fireEvent.change(within(dialog).getByLabelText("Chrome 路径"), {
      target: { value: "/tmp/User Chrome.app" }
    });
    await user.click(within(dialog).getByRole("button", { name: "夜晚" }));
    await user.click(within(dialog).getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("目标根写入失败"));
    expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
      "/tmp/other-root"
    );
    expect((within(dialog).getByLabelText("Chrome 路径") as HTMLInputElement).value).toBe(
      "/tmp/User Chrome.app"
    );
    expect(within(dialog).getByRole("button", { name: "夜晚" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.queryByText("目标账号")).toBeNull();
    expect(screen.getByRole("button", { name: "选择 主号" }).getAttribute("aria-pressed")).toBe(
      "true"
    );

    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("设置弹窗保存切换根目录后 Chrome 检测失败仍保留新根", async () => {
    const user = userEvent.setup();
    const targetDocument = documentWith([profile({ id: "target-001", name: "目标账号" })]);
    targetDocument.settings.browserPath = "/Applications/Target Chrome.app";
    const initProfileRootSpy = vi.spyOn(profileApi, "initProfileRoot");
    const loadProfilesSpy = vi.spyOn(profileApi, "loadProfiles");
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles");
    const detectChromeSpy = vi.spyOn(profileApi, "detectChrome");
    render(<App />);

    const dialog = await openSettingsDialog(user);
    initProfileRootSpy.mockResolvedValue({ rootExists: true, writable: true, profileCount: 1 });
    loadProfilesSpy.mockResolvedValue(targetDocument);
    saveProfilesSpy.mockResolvedValue();
    detectChromeSpy.mockImplementation(async (path) => {
      if (path === "/tmp/User Chrome.app") {
        throw new Error("Chrome 检测失败");
      }
      return { available: true, appPath: path ?? null };
    });
    changeRootPathDraft(dialog, "/tmp/other-root");
    fireEvent.change(within(dialog).getByLabelText("Chrome 路径"), {
      target: { value: "/tmp/User Chrome.app" }
    });
    await user.click(within(dialog).getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Chrome 检测失败"));
    expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
      "/tmp/other-root"
    );
    expect(screen.getByText("目标账号")).toBeTruthy();
    expect(screen.queryByText("主号")).toBeNull();

    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
    saveProfilesSpy.mockRestore();
    detectChromeSpy.mockRestore();
  });

  test("设置弹窗保存切换根目录时合并草稿且保留目标根数据", async () => {
    const user = userEvent.setup();
    const targetDocument = documentWith(
      [profile({ id: "target-001", name: "目标账号" })],
      [project({ id: "target-project", name: "目标项目", profileIds: ["target-001"] })]
    );
    targetDocument.settings = {
      browserPath: "/Applications/Target Chrome.app",
      favoriteUrls: ["https://target.example/favorite"],
      recentUrls: ["https://target.example/recent"],
      urlLibrary: [],
      theme: "light"
    };
    const initProfileRootSpy = vi.spyOn(profileApi, "initProfileRoot");
    const loadProfilesSpy = vi.spyOn(profileApi, "loadProfiles");
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles");
    render(<App />);

    const dialog = await openSettingsDialog(user);
    initProfileRootSpy.mockResolvedValue({ rootExists: true, writable: true, profileCount: 1 });
    loadProfilesSpy.mockResolvedValue(targetDocument);
    saveProfilesSpy.mockResolvedValue();
    changeRootPathDraft(dialog, "/tmp/other-root");
    fireEvent.change(within(dialog).getByLabelText("Chrome 路径"), {
      target: { value: "/tmp/User Chrome.app" }
    });
    await user.click(within(dialog).getByRole("button", { name: "夜晚" }));
    await user.click(within(dialog).getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(saveProfilesSpy).toHaveBeenCalledTimes(1));
    const [savedRootPath, savedDocument] = saveProfilesSpy.mock.calls[0];
    expect(savedRootPath).toBe("/tmp/other-root");
    expect(savedDocument.profiles).toEqual(targetDocument.profiles);
    expect(savedDocument.projects).toEqual(targetDocument.projects);
    expect(savedDocument.settings).toMatchObject({
      browserPath: "/tmp/User Chrome.app",
      theme: "dark",
      favoriteUrls: ["https://target.example/favorite"],
      recentUrls: ["https://target.example/recent"]
    });
    expect(savedDocument.settings).not.toHaveProperty("rootPath");

    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("设置弹窗的主题草稿关闭会丢弃，保存后才持久化", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    expect(document.documentElement.dataset.theme).toBe("light");

    await user.click(within(dialog).getByRole("button", { name: "夜晚" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(savedDocument().settings.theme).toBe("light");

    await user.click(within(dialog).getByRole("button", { name: "关闭设置" }));

    expect(document.documentElement.dataset.theme).toBe("light");

    await user.click(screen.getByRole("button", { name: "设置" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: "设置" });
    await user.click(within(reopenedDialog).getByRole("button", { name: "夜晚" }));
    await user.click(within(reopenedDialog).getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(savedDocument().settings.theme).toBe("dark");
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("设置弹窗关闭会清除备份恢复确认", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.change(within(dialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    fireEvent.change(within(dialog).getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/full-profiles-1" }
    });
    await user.click(within(dialog).getByRole("button", { name: "从备份恢复" }));
    expect(await within(dialog).findByText("确认从备份恢复")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "关闭设置" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: "设置" });

    expect(within(reopenedDialog).queryByText("确认从备份恢复")).toBeNull();
    expect(
      (within(reopenedDialog).getByLabelText("备份文件路径") as HTMLInputElement).value
    ).toBe("/tmp/multichrome-backup.json");
    expect(
      (within(reopenedDialog).getByLabelText("完整备份目录路径") as HTMLInputElement).value
    ).toBe("/tmp/full-profiles-1");
  });

  test("切换根目录会保留轻量备份路径并清除完整备份草稿", async () => {
    const user = userEvent.setup();
    render(<App />);

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    fireEvent.change(within(dialog).getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/full-profiles-1" }
    });
    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);

    await waitFor(() => {
      expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
        "/tmp/other-root"
      );
    });
    expect((within(dialog).getByLabelText("备份文件路径") as HTMLInputElement).value).toBe(
      "/tmp/multichrome-backup.json"
    );
    expect(
      (within(dialog).getByLabelText("完整备份目录路径") as HTMLInputElement).value
    ).toBe("");
  });

  test("切换根目录会使旧健康检查结果失效", async () => {
    const user = userEvent.setup();
    let resolveHealthCheck!: (report: RootHealthReport) => void;
    const checkHealthSpy = vi.spyOn(profileApi, "checkProfileRootHealth").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHealthCheck = resolve;
        })
    );
    render(<App />);

    const dialog = await openSettingsDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "健康检查" }));
    expect((within(dialog).getByRole("button", { name: "检查中" }) as HTMLButtonElement).disabled).toBe(
      true
    );

    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);
    await waitFor(() => {
      expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
        "/tmp/other-root"
      );
    });
    expect((within(dialog).getByRole("button", { name: "健康检查" }) as HTMLButtonElement).disabled).toBe(
      false
    );

    resolveHealthCheck({
      rootPath: "~/MultiChromeProfiles",
      summary: { profileCount: 0, warningCount: 0, errorCount: 1 },
      issues: [
        {
          severity: "error",
          code: "missing_profiles_index",
          title: "旧 root 健康错误",
          detail: "旧 root 专属健康检查结果",
          path: "~/MultiChromeProfiles/old-root-only",
          profileId: null
        }
      ]
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(within(dialog).queryByText("旧 root 健康错误")).toBeNull();
    expect(within(dialog).queryByText("~/MultiChromeProfiles/old-root-only")).toBeNull();
    expect(screen.getByRole("status").textContent).not.toContain("健康检查发现 1 个错误");
    checkHealthSpy.mockRestore();
  });

  test("设置弹窗按 Esc 会关闭并丢弃未保存的 Chrome 路径草稿", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.change(within(dialog).getByLabelText("Chrome 路径"), {
      target: { value: "/tmp/Test Chrome.app" }
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "设置" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: "设置" });
    expect((within(reopenedDialog).getByLabelText("Chrome 路径") as HTMLInputElement).value).toBe(
      "/Applications/Google Chrome.app"
    );
  });

  test("设置弹窗可以运行目录健康检查并显示问题", async () => {
    const user = userEvent.setup();
    const checkHealthSpy = vi
      .spyOn(profileApi, "checkProfileRootHealth")
      .mockResolvedValue({
        rootPath: "~/MultiChromeProfiles",
        summary: {
          profileCount: 2,
          warningCount: 1,
          errorCount: 0
        },
        issues: [
          {
            severity: "warning",
            code: "orphan_profile_dir",
            title: "发现未登记的 Profile 文件夹",
            detail: "该文件夹存在于 profiles 下，但不在账号索引里。",
            path: "~/MultiChromeProfiles/profiles/orphan-001",
            profileId: "orphan-001"
          }
        ]
      });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await user.click(within(dialog).getByRole("button", { name: "健康检查" }));

    expect(await within(dialog).findByText("发现未登记的 Profile 文件夹")).toBeTruthy();
    expect(within(dialog).getByText("1 个提醒")).toBeTruthy();
    expect(checkHealthSpy).toHaveBeenCalledWith("~/MultiChromeProfiles");
    checkHealthSpy.mockRestore();
  });

  test("设置弹窗可以修复可自动处理的健康问题", async () => {
    const user = userEvent.setup();
    const repairHealthSpy = vi
      .spyOn(profileApi, "repairProfileRootHealth")
      .mockResolvedValue({
        repairedCount: 1,
        actions: [
          {
            code: "profile_dir_created",
            title: "已补建 Profile 文件夹",
            detail: "账号索引里存在该账号，已补建缺失的 profile 文件夹。",
            path: "~/MultiChromeProfiles/profiles/account-001",
            profileId: "account-001"
          }
        ],
        health: {
          rootPath: "~/MultiChromeProfiles",
          summary: {
            profileCount: 2,
            warningCount: 0,
            errorCount: 0
          },
          issues: []
        }
      });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await user.click(within(dialog).getByRole("button", { name: "修复可自动处理项" }));

    expect(await screen.findByText("已修复 1 个问题")).toBeTruthy();
    expect(await within(dialog).findByText("已补建 Profile 文件夹")).toBeTruthy();
    expect(within(dialog).getByText("未发现问题")).toBeTruthy();
    expect(repairHealthSpy).toHaveBeenCalledWith("~/MultiChromeProfiles");
    repairHealthSpy.mockRestore();
  });

  test("切换根目录后不会写回旧根的修复结果", async () => {
    const user = userEvent.setup();
    const repairRequest = deferred<Awaited<ReturnType<typeof profileApi.repairProfileRootHealth>>>();
    const repairHealthSpy = vi
      .spyOn(profileApi, "repairProfileRootHealth")
      .mockReturnValue(repairRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "修复可自动处理项" }));
    await waitFor(() => {
      expect(
        (within(dialog).getByRole("button", { name: "修复中" }) as HTMLButtonElement).disabled
      ).toBe(true);
    });

    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);
    await waitFor(() => {
      expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
        "/tmp/other-root"
      );
    });

    repairRequest.resolve({
      repairedCount: 1,
      actions: [
        {
          code: "old_root_repair",
          title: "旧 root 修复动作",
          detail: "旧 root 专属修复结果",
          path: "~/MultiChromeProfiles/old-root-only",
          profileId: null
        }
      ],
      health: {
        rootPath: "~/MultiChromeProfiles",
        summary: { profileCount: 0, warningCount: 0, errorCount: 1 },
        issues: [
          {
            severity: "error",
            code: "old_root_health",
            title: "旧 root 修复后的错误",
            detail: "旧 root 专属健康结果",
            path: "~/MultiChromeProfiles/old-root-only",
            profileId: null
          }
        ]
      }
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(within(dialog).queryByText("旧 root 修复动作")).toBeNull();
    expect(within(dialog).queryByText("旧 root 修复后的错误")).toBeNull();
    expect(screen.getByRole("status").textContent).not.toContain("已修复 1 个问题");
    expect(
      (within(dialog).getByRole("button", { name: "修复可自动处理项" }) as HTMLButtonElement).disabled
    ).toBe(false);
    repairHealthSpy.mockRestore();
  });

  test("设置弹窗可以把未登记的 Profile 文件夹登记为账号", async () => {
    const user = userEvent.setup();
    const checkHealthSpy = vi
      .spyOn(profileApi, "checkProfileRootHealth")
      .mockResolvedValueOnce({
        rootPath: "~/MultiChromeProfiles",
        summary: {
          profileCount: 2,
          warningCount: 1,
          errorCount: 0
        },
        issues: [
          {
            severity: "warning",
            code: "orphan_profile_dir",
            title: "发现未登记的 Profile 文件夹",
            detail: "该文件夹存在于 profiles 下，但不在账号索引里。",
            path: "~/MultiChromeProfiles/profiles/orphan-001",
            profileId: "orphan-001"
          }
        ]
      })
      .mockResolvedValueOnce({
        rootPath: "~/MultiChromeProfiles",
        summary: {
          profileCount: 3,
          warningCount: 0,
          errorCount: 0
        },
        issues: []
      });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await user.click(within(dialog).getByRole("button", { name: "健康检查" }));
    await user.click(await within(dialog).findByRole("button", { name: "登记为账号 orphan-001" }));

    expect(await screen.findByText("已登记 orphan-001")).toBeTruthy();
    expect(await within(dialog).findByText("未发现问题")).toBeTruthy();
    await waitFor(() => {
      const registered = savedDocument().profiles.find(
        (profile) => profile.id === "orphan-001"
      );
      expect(registered?.name).toBe("orphan-001");
      expect(registered?.notes).toBe("从已有 Profile 目录登记");
    });
    expect(checkHealthSpy).toHaveBeenCalledTimes(2);
    checkHealthSpy.mockRestore();
  });

  test("切换根目录后不会写回旧根孤儿登记触发的健康结果", async () => {
    const user = userEvent.setup();
    const orphanHealthRequest = deferred<RootHealthReport>();
    const checkHealthSpy = vi
      .spyOn(profileApi, "checkProfileRootHealth")
      .mockResolvedValueOnce({
        rootPath: "~/MultiChromeProfiles",
        summary: { profileCount: 2, warningCount: 1, errorCount: 0 },
        issues: [
          {
            severity: "warning",
            code: "orphan_profile_dir",
            title: "旧 root 孤儿目录",
            detail: "旧 root 专属孤儿结果",
            path: "~/MultiChromeProfiles/profiles/orphan-001",
            profileId: "orphan-001"
          }
        ]
      })
      .mockReturnValueOnce(orphanHealthRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "健康检查" }));
    await user.click(await within(dialog).findByRole("button", { name: "登记为账号 orphan-001" }));
    await waitFor(() => expect(checkHealthSpy).toHaveBeenCalledTimes(2));

    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);
    await waitFor(() => {
      expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
        "/tmp/other-root"
      );
    });

    orphanHealthRequest.resolve({
      rootPath: "~/MultiChromeProfiles",
      summary: { profileCount: 3, warningCount: 1, errorCount: 0 },
      issues: [
        {
          severity: "warning",
          code: "old_orphan_health",
          title: "旧 root 孤儿登记后的结果",
          detail: "旧 root 专属健康结果",
          path: "~/MultiChromeProfiles/profiles/orphan-001",
          profileId: "orphan-001"
        }
      ]
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(within(dialog).queryByText("旧 root 孤儿登记后的结果")).toBeNull();
    expect(within(dialog).queryByText("~/MultiChromeProfiles/profiles/orphan-001")).toBeNull();
    expect(screen.getByRole("status").textContent).not.toContain("健康检查发现 1 个提醒");
    expect(
      within(dialog).queryByRole("button", { name: "登记中" })
    ).toBeNull();
    checkHealthSpy.mockRestore();
  });

  test("设置弹窗可以创建备份并从备份恢复账号索引", async () => {
    const user = userEvent.setup();
    const createBackupSpy = vi
      .spyOn(profileApi, "createProfilesBackup")
      .mockResolvedValue({
        path: "/tmp/multichrome-backup.json",
        profileCount: 2
      });
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockResolvedValue(
        documentWith([
          profile({
            id: "account-009",
            name: "恢复号",
            notes: "来自备份"
          })
        ])
      );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await user.click(within(dialog).getByRole("button", { name: "创建备份" }));

    expect(await within(dialog).findByDisplayValue("/tmp/multichrome-backup.json")).toBeTruthy();
    expect(await screen.findByText("已创建备份：2 个账号")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/full-profiles-1" }
    });

    await user.click(within(dialog).getByRole("button", { name: "从备份恢复" }));

    expect(restoreBackupSpy).not.toHaveBeenCalled();
    expect(await within(dialog).findByText("确认从备份恢复")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认恢复" }));

    expect(await screen.findByRole("button", { name: "选择 恢复号" })).toBeTruthy();
    expect(restoreBackupSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "/tmp/multichrome-backup.json"
    );
    expect((within(dialog).getByLabelText("备份文件路径") as HTMLInputElement).value).toBe(
      "/tmp/multichrome-backup.json"
    );
    expect(
      (within(dialog).getByLabelText("完整备份目录路径") as HTMLInputElement).value
    ).toBe("/tmp/full-profiles-1");
    createBackupSpy.mockRestore();
    restoreBackupSpy.mockRestore();
  });

  test("切换根目录后不会写回旧的轻量备份结果", async () => {
    const user = userEvent.setup();
    const backupRequest = deferred<{ path: string; profileCount: number }>();
    const createBackupSpy = vi
      .spyOn(profileApi, "createProfilesBackup")
      .mockReturnValue(backupRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "创建备份" }));
    await waitFor(() => {
      expect(createBackupSpy).toHaveBeenCalledWith("~/MultiChromeProfiles");
    });

    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);
    await waitFor(() => {
      expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
        "/tmp/other-root"
      );
    });

    backupRequest.resolve({
      path: "/tmp/old-root-backup.json",
      profileCount: 7
    });
    await act(async () => {
      await backupRequest.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(within(dialog).queryByText("/tmp/old-root-backup.json")).toBeNull();
    expect(
      (within(dialog).getByLabelText("备份文件路径") as HTMLInputElement).value
    ).not.toBe("/tmp/old-root-backup.json");
    expect(screen.getByRole("status").textContent).not.toContain("已创建备份：7 个账号");
    createBackupSpy.mockRestore();
  });

  test("同 root 恢复在 pending 普通保存后仍以恢复文档为最终状态", async () => {
    const user = userEvent.setup();
    const pendingSave = deferred<void>();
    const restoredDocument = documentWith([
      profile({ id: "account-009", name: "恢复号", notes: "来自备份" })
    ]);
    const saveProfilesSpy = vi
      .spyOn(profileApi, "saveProfiles")
      .mockImplementationOnce(() => pendingSave.promise)
      .mockResolvedValue(undefined);
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockResolvedValue(restoredDocument);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "编辑 主号" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(editDialog).getByLabelText("名称"));
    await user.type(within(editDialog).getByLabelText("名称"), "旧保存名称");
    await user.click(within(editDialog).getByRole("button", { name: "保存账号" }));
    await waitFor(() => {
      expect(saveProfilesSpy).toHaveBeenCalledTimes(1);
    });

    const settingsDialog = await openSettingsDialog(user);
    fireEvent.change(within(settingsDialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    await user.click(
      within(settingsDialog).getByRole("button", { name: "从备份恢复" })
    );
    await user.click(
      within(settingsDialog).getByRole("button", { name: "确认恢复" })
    );
    expect(restoreBackupSpy).not.toHaveBeenCalled();

    await act(async () => {
      pendingSave.resolve();
      await pendingSave.promise;
    });

    await waitFor(() => {
      expect(restoreBackupSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "选择 恢复号" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "选择 旧保存名称" })).toBeNull();
    expect(saveProfilesSpy).toHaveBeenCalledTimes(1);
    saveProfilesSpy.mockRestore();
    restoreBackupSpy.mockRestore();
  });

  test("恢复期间切换根目录不会把旧根恢复文档写入新根", async () => {
    const user = userEvent.setup();
    const restoreRequest = deferred<ProfileDocument>();
    const restoredDocument = documentWith([
      profile({ id: "account-009", name: "恢复号", notes: "来自备份" })
    ]);
    const targetDocument = documentWith([
      profile({ id: "target-001", name: "目标账号" })
    ]);
    const saveProfilesSpy = vi
      .spyOn(profileApi, "saveProfiles")
      .mockResolvedValue(undefined);
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockReturnValue(restoreRequest.promise);
    const initProfileRootSpy = vi.spyOn(profileApi, "initProfileRoot");
    const loadProfilesSpy = vi.spyOn(profileApi, "loadProfiles");
    render(<App />);

    const settingsDialog = await openSettingsDialog(user);
    fireEvent.change(within(settingsDialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    await user.click(
      within(settingsDialog).getByRole("button", { name: "从备份恢复" })
    );
    await user.click(
      within(settingsDialog).getByRole("button", { name: "确认恢复" })
    );
    await waitFor(() => {
      expect(restoreBackupSpy).toHaveBeenCalledWith(
        "~/MultiChromeProfiles",
        "/tmp/multichrome-backup.json"
      );
    });

    initProfileRootSpy.mockResolvedValue({
      rootExists: true,
      writable: true,
      profileCount: 1
    });
    loadProfilesSpy.mockResolvedValue(targetDocument);
    changeRootPathDraft(settingsDialog, "/tmp/other-root");
    await user.click(within(settingsDialog).getByRole("button", { name: "保存设置" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "选择 目标账号" })).toBeTruthy();
    });

    const bSave = deferred<void>();
    saveProfilesSpy.mockImplementation(() => bSave.promise);
    await user.click(screen.getByRole("button", { name: "编辑 目标账号" }));
    const targetEditDialog = await screen.findByRole("dialog", { name: "编辑 目标账号" });
    await user.clear(within(targetEditDialog).getByLabelText("名称"));
    await user.type(within(targetEditDialog).getByLabelText("名称"), "目标账号已保存");
    await user.click(within(targetEditDialog).getByRole("button", { name: "保存账号" }));
    await waitFor(() => {
      expect(saveProfilesSpy.mock.calls[saveProfilesSpy.mock.calls.length - 1][0]).toBe(
        "/tmp/other-root"
      );
    });

    await act(async () => {
      restoreRequest.resolve(restoredDocument);
      await restoreRequest.promise;
    });

    await act(async () => {
      bSave.resolve();
      await bSave.promise;
    });

    await waitFor(() => {
      expect(
        saveProfilesSpy.mock.calls.some(
          ([path, document]) =>
            path === "/tmp/other-root" &&
            document.profiles.some((profile) => profile.id === "target-001")
        )
      ).toBe(true);
    });
    expect(
      saveProfilesSpy.mock.calls.some(
        ([path, document]) =>
          path === "/tmp/other-root" &&
          document.profiles.some((profile) => profile.id === "account-009")
      )
    ).toBe(false);
    expect(screen.getByRole("button", { name: "选择 目标账号已保存" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "选择 恢复号" })).toBeNull();
    saveProfilesSpy.mockRestore();
    restoreBackupSpy.mockRestore();
    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
  });

  test("切换根目录后旧轻量恢复失败不会写回错误消息", async () => {
    const user = userEvent.setup();
    const restoreRequest = deferred<ProfileDocument>();
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockReturnValue(restoreRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    await user.click(within(dialog).getByRole("button", { name: "从备份恢复" }));
    await user.click(within(dialog).getByRole("button", { name: "确认恢复" }));
    await waitFor(() => {
      expect(restoreBackupSpy).toHaveBeenCalledTimes(1);
    });

    const initProfileRootSpy = vi
      .spyOn(profileApi, "initProfileRoot")
      .mockResolvedValue({ rootExists: true, writable: true, profileCount: 1 });
    const loadProfilesSpy = vi
      .spyOn(profileApi, "loadProfiles")
      .mockResolvedValue(documentWith([profile({ id: "target-001", name: "目标账号" })]));
    const saveProfilesSpy = vi
      .spyOn(profileApi, "saveProfiles")
      .mockResolvedValue(undefined);
    changeRootPathDraft(dialog, "/tmp/other-root");
    await user.click(within(dialog).getByRole("button", { name: "保存设置" }));
    await screen.findByRole("button", { name: "选择 目标账号" });
    expect(within(dialog).queryByText("确认从备份恢复")).toBeNull();

    restoreRequest.reject(new Error("旧 root 恢复失败"));
    await act(async () => {
      await restoreRequest.promise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("status").textContent).not.toContain("旧 root 恢复失败");
    expect(within(dialog).queryByText("确认从备份恢复")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "恢复中" })).toBeNull();
    expect(screen.queryByRole("button", { name: "选择 恢复号" })).toBeNull();
    expect(loadProfilesSpy).toHaveBeenCalledWith("/tmp/other-root");
    expect(saveProfilesSpy).toHaveBeenCalled();
    restoreBackupSpy.mockRestore();
    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("轻量恢复会等待恢复 API 完成后才清理确认态", async () => {
    const user = userEvent.setup();
    const restoreRequest = deferred<ProfileDocument>();
    const restoredDocument = documentWith([
      profile({ id: "account-009", name: "恢复号", notes: "来自备份" })
    ]);
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockReturnValue(restoreRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    await user.click(within(dialog).getByRole("button", { name: "从备份恢复" }));
    await user.click(within(dialog).getByRole("button", { name: "确认恢复" }));
    await waitFor(() => {
      expect(restoreBackupSpy).toHaveBeenCalledTimes(1);
    });

    expect(within(dialog).getByText("确认从备份恢复")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "恢复中" })
    ).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "选择 恢复号" })).toBeNull();

    await act(async () => {
      restoreRequest.resolve(restoredDocument);
      await restoreRequest.promise;
    });

    expect(await screen.findByRole("button", { name: "选择 恢复号" })).toBeTruthy();
    expect(within(dialog).queryByText("确认从备份恢复")).toBeNull();
    restoreBackupSpy.mockRestore();
  });

  test("轻量恢复失败后会收口 working 并保留确认态", async () => {
    const user = userEvent.setup();
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockRejectedValue(new Error("恢复失败"));
    const saveProfilesSpy = vi.spyOn(profileApi, "saveProfiles");
    render(<App />);

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    await user.click(within(dialog).getByRole("button", { name: "从备份恢复" }));
    await user.click(within(dialog).getByRole("button", { name: "确认恢复" }));

    await waitFor(() => expect(restoreBackupSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("恢复失败")).toBeTruthy();
    expect(await within(dialog).findByText("确认从备份恢复")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "恢复中" })).toBeNull();
    expect(
      (within(dialog).getByRole("button", { name: "确认恢复" }) as HTMLButtonElement).disabled
    ).toBe(false);
    expect(saveProfilesSpy).not.toHaveBeenCalled();
  });

  test("轻量恢复后 Chrome 检测失败仍提交恢复 UI 并提示", async () => {
    const user = userEvent.setup();
    const restoredDocument = documentWith([
      profile({ id: "account-009", name: "恢复号", notes: "来自备份" })
    ]);
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockResolvedValue(restoredDocument);
    render(<App />);
    await screen.findByText("根目录正常");
    const detectChromeSpy = vi
      .spyOn(profileApi, "detectChrome")
      .mockRejectedValue(new Error("Chrome 检测失败"));

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    await user.click(within(dialog).getByRole("button", { name: "从备份恢复" }));
    await user.click(within(dialog).getByRole("button", { name: "确认恢复" }));

    expect(await screen.findByRole("button", { name: "选择 恢复号" })).toBeTruthy();
    expect(
      await screen.findByText("已从备份恢复 1 个账号；Chrome 检测失败")
    ).toBeTruthy();
    expect(within(dialog).queryByText("确认从备份恢复")).toBeNull();
    detectChromeSpy.mockRestore();
    restoreBackupSpy.mockRestore();
  });

  test("恢复落盘后检测延迟期间排队的旧保存不会覆盖恢复结果", async () => {
    const user = userEvent.setup();
    const detectRequest = deferred<Awaited<ReturnType<typeof profileApi.detectChrome>>>();
    const restoredDocument = documentWith([
      profile({ id: "account-009", name: "恢复号", notes: "来自备份" })
    ]);
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockResolvedValue(restoredDocument);
    const saveProfilesSpy = vi
      .spyOn(profileApi, "saveProfiles")
      .mockResolvedValue(undefined);
    render(<App />);
    await screen.findByText("根目录正常");
    const detectChromeSpy = vi
      .spyOn(profileApi, "detectChrome")
      .mockReturnValue(detectRequest.promise);

    const settingsDialog = await openSettingsDialog(user);
    fireEvent.change(within(settingsDialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    await user.click(within(settingsDialog).getByRole("button", { name: "从备份恢复" }));
    await user.click(within(settingsDialog).getByRole("button", { name: "确认恢复" }));
    await waitFor(() => {
      expect(restoreBackupSpy).toHaveBeenCalledTimes(1);
      expect(detectChromeSpy).toHaveBeenCalledTimes(1);
    });

    await user.click(within(settingsDialog).getByRole("button", { name: "关闭设置" }));
    await user.click(screen.getByRole("button", { name: "编辑 主号" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑 主号" });
    await user.clear(within(editDialog).getByLabelText("名称"));
    await user.type(within(editDialog).getByLabelText("名称"), "旧保存名称");
    await user.click(within(editDialog).getByRole("button", { name: "保存账号" }));
    expect(saveProfilesSpy).not.toHaveBeenCalled();

    await act(async () => {
      detectRequest.reject(new Error("Chrome 检测失败"));
      await detectRequest.promise.catch(() => undefined);
    });

    expect(await screen.findByRole("button", { name: "选择 恢复号" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "选择 旧保存名称" })).toBeNull();
    await waitFor(() => {
      expect(saveProfilesSpy).not.toHaveBeenCalled();
    });
    detectChromeSpy.mockRestore();
    restoreBackupSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("设置弹窗可以预览并创建选中账号的完整备份", async () => {
    const user = userEvent.setup();
    const previewSpy = vi
      .spyOn(profileApi, "previewFullProfileBackup")
      .mockResolvedValue({
        destinationDir: "~/MultiChromeProfiles/app-data/backups",
        profileCount: 1,
        profileIds: ["account-001"],
        totalBytes: 1024
      });
    const createSpy = vi
      .spyOn(profileApi, "createFullProfileBackup")
      .mockResolvedValue({
        path: "~/MultiChromeProfiles/app-data/backups/full-profiles-1",
        profileCount: 1,
        profileIds: ["account-001"],
        totalBytes: 2048
      });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await user.click(within(dialog).getByRole("button", { name: "选中账号" }));
    await user.click(within(dialog).getByRole("button", { name: "预览完整备份" }));

    expect(previewSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", ["account-001"]);
    expect(await within(dialog).findByText("预计 1.00 KB")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "创建完整备份" }));

    expect(createSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", ["account-001"]);
    expect(await screen.findByText("完整备份已创建：1 个账号")).toBeTruthy();
    expect(await within(dialog).findByText("~/MultiChromeProfiles/app-data/backups/full-profiles-1")).toBeTruthy();
    previewSpy.mockRestore();
    createSpy.mockRestore();
  });

  test("切换根目录后不会写回旧的完整备份预览", async () => {
    const user = userEvent.setup();
    const previewRequest = deferred<{
      destinationDir: string;
      profileCount: number;
      profileIds: string[];
      totalBytes: number;
    }>();
    const previewSpy = vi
      .spyOn(profileApi, "previewFullProfileBackup")
      .mockReturnValue(previewRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "预览完整备份" }));
    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", []);
    });

    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);
    await waitFor(() => {
      expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
        "/tmp/other-root"
      );
    });

    previewRequest.resolve({
      destinationDir: "/tmp/old-root-backups",
      profileCount: 8,
      profileIds: ["old-account"],
      totalBytes: 9216
    });
    await act(async () => {
      await previewRequest.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(within(dialog).queryByText("/tmp/old-root-backups")).toBeNull();
    expect(within(dialog).queryByText("预计 9.00 KB")).toBeNull();
    expect(screen.getByRole("status").textContent).not.toContain("已预览完整备份：8 个账号");
    previewSpy.mockRestore();
  });

  test("切换根目录后不会写回旧的完整备份结果", async () => {
    const user = userEvent.setup();
    const backupRequest = deferred<{
      path: string;
      profileCount: number;
      profileIds: string[];
      totalBytes: number;
    }>();
    const createSpy = vi
      .spyOn(profileApi, "createFullProfileBackup")
      .mockReturnValue(backupRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "创建完整备份" }));
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", []);
    });

    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);
    await waitFor(() => {
      expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
        "/tmp/other-root"
      );
    });

    backupRequest.resolve({
      path: "/tmp/old-root-full-backup",
      profileCount: 6,
      profileIds: ["old-account"],
      totalBytes: 2048
    });
    await act(async () => {
      await backupRequest.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(within(dialog).queryByText("/tmp/old-root-full-backup")).toBeNull();
    expect(within(dialog).queryByText("2.00 KB")).toBeNull();
    expect(
      (within(dialog).getByLabelText("完整备份目录路径") as HTMLInputElement).value
    ).not.toBe("/tmp/old-root-full-backup");
    expect(screen.getByRole("status").textContent).not.toContain("完整备份已创建：6 个账号");
    createSpy.mockRestore();
  });

  test("完整备份恢复需要扫描预览和独立确认弹窗", async () => {
    const user = userEvent.setup();
    const previewSpy = vi
      .spyOn(profileApi, "previewFullProfileRestore")
      .mockResolvedValue({
        path: "/tmp/full-profiles-1",
        profileCount: 2,
        profileIds: ["account-001", "account-009"],
        newProfileIds: ["account-009"],
        overwriteProfileIds: ["account-001"],
        totalBytes: 4096
      });
    const restoreSpy = vi
      .spyOn(profileApi, "restoreFullProfileBackup")
      .mockResolvedValue(
        documentWith([
          profile({ id: "account-001", name: "主号恢复" }),
          profile({ id: "account-009", name: "备份号" })
        ])
      );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    fireEvent.change(within(dialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    fireEvent.change(within(dialog).getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/full-profiles-1" }
    });
    await user.click(within(dialog).getByRole("button", { name: "扫描完整备份" }));

    expect(previewSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "/tmp/full-profiles-1");
    expect(await within(dialog).findByText("新增 1 个")).toBeTruthy();
    expect(within(dialog).getByText("覆盖 1 个")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "恢复完整备份" }));

    expect(restoreSpy).not.toHaveBeenCalled();
    const confirmDialog = await screen.findByRole("dialog", { name: "确认恢复完整备份" });
    await user.click(within(confirmDialog).getByRole("button", { name: "确认恢复" }));

    expect(await screen.findByRole("button", { name: "选择 备份号" })).toBeTruthy();
    expect(restoreSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "/tmp/full-profiles-1", true);
    expect((within(dialog).getByLabelText("备份文件路径") as HTMLInputElement).value).toBe(
      "/tmp/multichrome-backup.json"
    );
    expect(
      (within(dialog).getByLabelText("完整备份目录路径") as HTMLInputElement).value
    ).toBe("/tmp/full-profiles-1");
    previewSpy.mockRestore();
    restoreSpy.mockRestore();
  });

  test("切换根目录后不会写回旧的完整恢复预览", async () => {
    const user = userEvent.setup();
    const previewRequest = deferred<{
      path: string;
      profileCount: number;
      profileIds: string[];
      newProfileIds: string[];
      overwriteProfileIds: string[];
      totalBytes: number;
    }>();
    const previewSpy = vi
      .spyOn(profileApi, "previewFullProfileRestore")
      .mockReturnValue(previewRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/old-root-full-profiles" }
    });
    await user.click(within(dialog).getByRole("button", { name: "扫描完整备份" }));
    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalledWith(
        "~/MultiChromeProfiles",
        "/tmp/old-root-full-profiles"
      );
    });

    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);
    await waitFor(() => {
      expect((within(dialog).getByLabelText("配置根目录") as HTMLInputElement).value).toBe(
        "/tmp/other-root"
      );
    });
    expect(within(dialog).queryByRole("button", { name: "恢复完整备份" })).toBeNull();

    previewRequest.resolve({
      path: "/tmp/old-root-full-profiles",
      profileCount: 9,
      profileIds: ["old-account"],
      newProfileIds: ["old-account"],
      overwriteProfileIds: [],
      totalBytes: 4096
    });
    await act(async () => {
      await previewRequest.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(within(dialog).queryByText("/tmp/old-root-full-profiles")).toBeNull();
    expect(within(dialog).queryByText("新增 1 个")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "恢复完整备份" })).toBeNull();
    expect(screen.getByRole("status").textContent).not.toContain("已扫描完整备份：9 个账号");
    previewSpy.mockRestore();
  });

  test("完整恢复会等待 pending 导入复制完成后再替换目录", async () => {
    const user = userEvent.setup();
    const importCopy = deferred<void>();
    vi.spyOn(profileApi, "scanProfileImportCandidates").mockResolvedValue([
      importCandidate({
        path: "/Volumes/SATA/profiles/twitter-main",
        suggestedName: "推特主号"
      })
    ]);
    const importSpy = vi
      .spyOn(profileApi, "importProfileData")
      .mockReturnValue(importCopy.promise);
    const previewSpy = vi
      .spyOn(profileApi, "previewFullProfileRestore")
      .mockResolvedValue({
        path: "/tmp/full-profiles-1",
        profileCount: 1,
        profileIds: ["account-009"],
        newProfileIds: ["account-009"],
        overwriteProfileIds: [],
        totalBytes: 4096
      });
    const restoreSpy = vi
      .spyOn(profileApi, "restoreFullProfileBackup")
      .mockResolvedValue(
        documentWith([
          profile({ id: "account-009", name: "备份号" })
        ])
      );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "导入" }));
    fireEvent.change(screen.getByLabelText("导入来源目录"), {
      target: { value: "/Volumes/SATA/profiles" }
    });
    await user.click(screen.getByRole("button", { name: "扫描导入目录" }));
    await user.click(await screen.findByRole("button", { name: "导入选中 1 个" }));
    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/full-profiles-1" }
    });
    await user.click(within(dialog).getByRole("button", { name: "扫描完整备份" }));
    await user.click(await within(dialog).findByRole("button", { name: "恢复完整备份" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "确认恢复完整备份" });
    await user.click(within(confirmDialog).getByRole("button", { name: "确认恢复" }));

    expect(restoreSpy).not.toHaveBeenCalled();
    await act(async () => {
      importCopy.resolve();
      await importCopy.promise;
    });

    await waitFor(() => {
      expect(restoreSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "/tmp/full-profiles-1", true);
      expect(screen.getByRole("button", { name: "选择 备份号" })).toBeTruthy();
    });
    previewSpy.mockRestore();
    restoreSpy.mockRestore();
  });

  test("轻量恢复进行中不会并发启动完整恢复", async () => {
    const user = userEvent.setup();
    const restoreRequest = deferred<ProfileDocument>();
    const restoredDocument = documentWith([
      profile({ id: "account-009", name: "恢复号" })
    ]);
    const restoreBackupSpy = vi
      .spyOn(profileApi, "restoreProfilesBackup")
      .mockReturnValue(restoreRequest.promise);
    const previewSpy = vi
      .spyOn(profileApi, "previewFullProfileRestore")
      .mockResolvedValue({
        path: "/tmp/full-profiles-1",
        profileCount: 1,
        profileIds: ["account-009"],
        newProfileIds: ["account-009"],
        overwriteProfileIds: [],
        totalBytes: 4096
      });
    const restoreFullSpy = vi
      .spyOn(profileApi, "restoreFullProfileBackup")
      .mockResolvedValue(restoredDocument);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("备份文件路径"), {
      target: { value: "/tmp/multichrome-backup.json" }
    });
    await user.click(within(dialog).getByRole("button", { name: "从备份恢复" }));
    await user.click(within(dialog).getByRole("button", { name: "确认恢复" }));
    await waitFor(() => {
      expect(restoreBackupSpy).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(within(dialog).getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/full-profiles-1" }
    });
    await user.click(within(dialog).getByRole("button", { name: "扫描完整备份" }));
    await user.click(await within(dialog).findByRole("button", { name: "恢复完整备份" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "确认恢复完整备份" });
    await user.click(within(confirmDialog).getByRole("button", { name: "确认恢复" }));

    expect(await screen.findByText("恢复正在进行，请稍候")).toBeTruthy();
    expect(restoreFullSpy).not.toHaveBeenCalled();

    await act(async () => {
      restoreRequest.resolve(restoredDocument);
      await restoreRequest.promise;
    });
    await screen.findByRole("button", { name: "选择 恢复号" });
    previewSpy.mockRestore();
    restoreBackupSpy.mockRestore();
    restoreFullSpy.mockRestore();
  });

  test("切换根目录后旧完整恢复失败不会写回错误消息", async () => {
    const user = userEvent.setup();
    const restoreRequest = deferred<ProfileDocument>();
    const previewSpy = vi
      .spyOn(profileApi, "previewFullProfileRestore")
      .mockResolvedValue({
        path: "/tmp/full-profiles-1",
        profileCount: 1,
        profileIds: ["account-009"],
        newProfileIds: ["account-009"],
        overwriteProfileIds: [],
        totalBytes: 4096
      });
    const restoreFullSpy = vi
      .spyOn(profileApi, "restoreFullProfileBackup")
      .mockReturnValue(restoreRequest.promise);
    render(<App />);

    const dialog = await openSettingsDialog(user);
    fireEvent.change(within(dialog).getByLabelText("完整备份目录路径"), {
      target: { value: "/tmp/full-profiles-1" }
    });
    await user.click(within(dialog).getByRole("button", { name: "扫描完整备份" }));
    await user.click(await within(dialog).findByRole("button", { name: "恢复完整备份" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "确认恢复完整备份" });
    await user.click(within(confirmDialog).getByRole("button", { name: "确认恢复" }));
    await waitFor(() => {
      expect(restoreFullSpy).toHaveBeenCalledTimes(1);
    });

    const initProfileRootSpy = vi
      .spyOn(profileApi, "initProfileRoot")
      .mockResolvedValue({ rootExists: true, writable: true, profileCount: 1 });
    const loadProfilesSpy = vi
      .spyOn(profileApi, "loadProfiles")
      .mockResolvedValue(documentWith([profile({ id: "target-001", name: "目标账号" })]));
    const saveProfilesSpy = vi
      .spyOn(profileApi, "saveProfiles")
      .mockResolvedValue(undefined);
    changeRootPathDraft(dialog, "/tmp/other-root");
    await user.click(within(dialog).getByRole("button", { name: "保存设置" }));
    await screen.findByRole("button", { name: "选择 目标账号" });
    expect(screen.queryByRole("dialog", { name: "确认恢复完整备份" })).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复中" })).toBeNull();

    restoreRequest.reject(new Error("旧 root 完整恢复失败"));
    await act(async () => {
      await restoreRequest.promise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("status").textContent).not.toContain("旧 root 完整恢复失败");
    expect(screen.queryByRole("dialog", { name: "确认恢复完整备份" })).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复中" })).toBeNull();
    expect(loadProfilesSpy).toHaveBeenCalledWith("/tmp/other-root");
    expect(saveProfilesSpy).toHaveBeenCalled();
    previewSpy.mockRestore();
    restoreFullSpy.mockRestore();
    initProfileRootSpy.mockRestore();
    loadProfilesSpy.mockRestore();
    saveProfilesSpy.mockRestore();
  });

  test("设置弹窗可以打开数据目录和备份目录", async () => {
    const user = userEvent.setup();
    const revealPathSpy = vi.spyOn(profileApi, "revealPath").mockResolvedValue();
    const revealBackupsSpy = vi
      .spyOn(profileApi, "revealProfileBackupsDir")
      .mockResolvedValue("~/MultiChromeProfiles/app-data/backups");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await user.click(within(dialog).getByRole("button", { name: "打开数据目录" }));

    expect(await screen.findByText("已打开数据目录")).toBeTruthy();
    expect(revealPathSpy).toHaveBeenCalledWith("~/MultiChromeProfiles");

    await user.click(within(dialog).getByRole("button", { name: "打开备份目录" }));

    expect(await screen.findByText("已打开备份目录")).toBeTruthy();
    expect(revealBackupsSpy).toHaveBeenCalledWith("~/MultiChromeProfiles");
    revealPathSpy.mockRestore();
    revealBackupsSpy.mockRestore();
  });

  test("开发诊断可以读取单选运行账号的 Runtime 标签页", async () => {
    const user = userEvent.setup();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ]);
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "0123456789abcdef",
        type: "page",
        url: "https://example.com/runtime",
        title: "Runtime Home",
        webSocketDebuggerUrl: "ws://127.0.0.1:19222/devtools/page/0123456789abcdef",
        checkedAt: 1000
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, dialog);

    expect(within(dialog).getByText("开发诊断")).toBeTruthy();
    expect(within(dialog).getByText("调试端口：19222")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "读取标签页" }));

    expect(listTabsSpy).toHaveBeenCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await within(dialog).findByText("Runtime Home")).toBeTruthy();
    expect(within(dialog).getByText("https://example.com/runtime")).toBeTruthy();
    snapshotSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("开发诊断可以导航并轮询第一个 page 标签页直到 URL 更新", async () => {
    const user = userEvent.setup();
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", false)
      ]);
    const navigateSpy = vi.spyOn(profileApi, "navigateRuntimeTab").mockResolvedValue({
      profileId: "account-001",
      targetId: "page-1",
      url: "https://example.com",
      navigatedAt: 1000
    });
    const listTabsSpy = vi
      .spyOn(profileApi, "listRuntimeTabs")
      .mockResolvedValueOnce([
        {
          targetId: "page-1",
          type: "page",
          url: "https://example.com/previous",
          title: "Previous page",
          webSocketDebuggerUrl: null,
          checkedAt: 1001
        }
      ])
      .mockResolvedValueOnce([
        {
          targetId: "page-1",
          type: "page",
          url: "https://example.com/",
          title: "Dashboard",
          webSocketDebuggerUrl: null,
          checkedAt: 1002
        }
      ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, dialog);
    await user.type(
      within(dialog).getByLabelText("导航 URL"),
      "https://example.com"
    );
    await user.click(within(dialog).getByRole("button", { name: "导航标签页" }));

    expect(navigateSpy).toHaveBeenCalledWith(
      "~/MultiChromeProfiles",
      "account-001",
      "https://example.com"
    );
    expect(
      await within(dialog).findByText(
        "已导航第一个 page 标签页：https://example.com"
      )
    ).toBeTruthy();
    await waitFor(() => expect(listTabsSpy).toHaveBeenCalledTimes(2));
    expect(listTabsSpy).toHaveBeenLastCalledWith("~/MultiChromeProfiles", "account-001");
    expect(await within(dialog).findByText("Dashboard")).toBeTruthy();
    expect(within(dialog).getByText("https://example.com/")).toBeTruthy();
    snapshotSpy.mockRestore();
    navigateSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("开发诊断导航后未确认更新时保留成功文案和最后一次标签页", async () => {
    const user = userEvent.setup();
    const navigateSpy = vi.spyOn(profileApi, "navigateRuntimeTab").mockResolvedValue({
      profileId: "account-001",
      targetId: "page-1",
      url: "https://example.com/dashboard",
      navigatedAt: 1000
    });
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "other-page",
        type: "page",
        url: "https://example.com/dashboard",
        title: "Other target page",
        webSocketDebuggerUrl: null,
        checkedAt: 1001
      },
      {
        targetId: "page-1",
        type: "page",
        url: "https://example.com/previous",
        title: "Stale target page",
        webSocketDebuggerUrl: null,
        checkedAt: 1002
      }
    ]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, dialog);
    await user.type(
      within(dialog).getByLabelText("导航 URL"),
      "https://example.com/dashboard"
    );
    await user.click(within(dialog).getByRole("button", { name: "导航标签页" }));

    expect(
      await within(dialog).findByText(
        "已导航第一个 page 标签页：https://example.com/dashboard"
      )
    ).toBeTruthy();
    expect(
      await within(dialog).findByText("导航成功，但暂未确认标签页已更新。")
    ).toBeTruthy();
    expect(listTabsSpy).toHaveBeenCalledTimes(3);
    expect(within(dialog).getByText("Stale target page")).toBeTruthy();
    expect(within(dialog).getByText("https://example.com/previous")).toBeTruthy();
    navigateSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("开发诊断导航后在轮询等待中卸载会停止旧请求", async () => {
    const user = userEvent.setup();
    const navigateSpy = vi.spyOn(profileApi, "navigateRuntimeTab").mockResolvedValue({
      profileId: "account-001",
      targetId: "page-1",
      url: "https://example.com/dashboard",
      navigatedAt: 1000
    });
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([
      {
        targetId: "page-1",
        type: "page",
        url: "https://example.com/previous",
        title: "Stale target page",
        webSocketDebuggerUrl: null,
        checkedAt: 1001
      }
    ]);
    const { unmount } = render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, dialog);
    await user.type(
      within(dialog).getByLabelText("导航 URL"),
      "https://example.com/dashboard"
    );
    await user.click(within(dialog).getByRole("button", { name: "导航标签页" }));
    await waitFor(() => expect(listTabsSpy).toHaveBeenCalledTimes(1));
    unmount();

    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    expect(listTabsSpy).toHaveBeenCalledTimes(1);
    navigateSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("开发诊断导航失败时展示错误且不刷新标签页", async () => {
    const user = userEvent.setup();
    const navigateSpy = vi
      .spyOn(profileApi, "navigateRuntimeTab")
      .mockRejectedValue(new Error("CDP 导航失败"));
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, dialog);
    await user.type(within(dialog).getByLabelText("导航 URL"), "https://example.com");
    await user.click(within(dialog).getByRole("button", { name: "导航标签页" }));

    expect(await within(dialog).findByText("CDP 导航失败")).toBeTruthy();
    expect(listTabsSpy).not.toHaveBeenCalled();
    navigateSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("开发诊断导航成功但刷新标签页失败时展示组合错误", async () => {
    const user = userEvent.setup();
    const navigateSpy = vi.spyOn(profileApi, "navigateRuntimeTab").mockResolvedValue({
      profileId: "account-001",
      targetId: "page-1",
      url: "https://example.com",
      navigatedAt: 1000
    });
    const listTabsSpy = vi
      .spyOn(profileApi, "listRuntimeTabs")
      .mockRejectedValue(new Error("Browser Runtime 不可用"));
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, dialog);
    await user.type(within(dialog).getByLabelText("导航 URL"), "https://example.com");
    await user.click(within(dialog).getByRole("button", { name: "导航标签页" }));

    expect(
      await within(dialog).findByText(
        "导航成功，但刷新标签页失败：Browser Runtime 不可用"
      )
    ).toBeTruthy();
    expect(
      within(dialog).getByText("已导航第一个 page 标签页：https://example.com")
    ).toBeTruthy();
    navigateSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("开发诊断会忽略 rootPath 变化后返回的旧导航请求", async () => {
    const user = userEvent.setup();
    let resolveNavigation: (
      result: Awaited<ReturnType<typeof profileApi.navigateRuntimeTab>>
    ) => void = () => {};
    const navigationPromise = new Promise<
      Awaited<ReturnType<typeof profileApi.navigateRuntimeTab>>
    >((resolve) => {
      resolveNavigation = resolve;
    });
    const navigateSpy = vi
      .spyOn(profileApi, "navigateRuntimeTab")
      .mockReturnValue(navigationPromise);
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([]);
    const initProfileRootSpy = vi.spyOn(profileApi, "initProfileRoot");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, dialog);
    await user.type(within(dialog).getByLabelText("导航 URL"), "https://old.example");
    await user.click(within(dialog).getByRole("button", { name: "导航标签页" }));
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(
        "~/MultiChromeProfiles",
        "account-001",
        "https://old.example"
      )
    );

    changeRootPathDraft(dialog, "/tmp/other-root");
    await detectRootPathDraft(user, dialog);
    await waitFor(() => expect(initProfileRootSpy).toHaveBeenLastCalledWith("/tmp/other-root"));

    resolveNavigation({
      profileId: "account-001",
      targetId: "old-page",
      url: "https://old.example",
      navigatedAt: 1000
    });
    await flushPromises();

    const navigateUrl = (within(dialog).getByLabelText("导航 URL") as HTMLInputElement)
      .value;
    const oldSuccess = within(dialog).queryByText(
      "已导航第一个 page 标签页：https://old.example"
    );
    const listTabsCallCount = listTabsSpy.mock.calls.length;
    navigateSpy.mockRestore();
    listTabsSpy.mockRestore();
    initProfileRootSpy.mockRestore();

    expect(navigateUrl).toBe("");
    expect(oldSuccess).toBeNull();
    expect(listTabsCallCount).toBe(0);
  });

  test("开发诊断会忽略关闭设置后返回的旧导航请求", async () => {
    const user = userEvent.setup();
    let resolveNavigation: (
      result: Awaited<ReturnType<typeof profileApi.navigateRuntimeTab>>
    ) => void = () => {};
    const navigationPromise = new Promise<
      Awaited<ReturnType<typeof profileApi.navigateRuntimeTab>>
    >((resolve) => {
      resolveNavigation = resolve;
    });
    const navigateSpy = vi
      .spyOn(profileApi, "navigateRuntimeTab")
      .mockReturnValue(navigationPromise);
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([]);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "选择 主号" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const firstDialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, firstDialog);
    await user.type(within(firstDialog).getByLabelText("导航 URL"), "https://old.example");
    await user.click(within(firstDialog).getByRole("button", { name: "导航标签页" }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));

    await user.click(within(firstDialog).getByRole("button", { name: "关闭设置" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    const secondDialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, secondDialog);

    resolveNavigation({
      profileId: "account-001",
      targetId: "old-page",
      url: "https://old.example",
      navigatedAt: 1000
    });
    await flushPromises();

    expect(
      within(secondDialog).queryByText("已导航第一个 page 标签页：https://old.example")
    ).toBeNull();
    expect(listTabsSpy).not.toHaveBeenCalled();
    navigateSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("开发诊断会忽略 Settings 打开期间切换账号后返回的旧导航请求", async () => {
    const user = userEvent.setup();
    let resolveNavigation: (
      result: Awaited<ReturnType<typeof profileApi.navigateRuntimeTab>>
    ) => void = () => {};
    const navigationPromise = new Promise<
      Awaited<ReturnType<typeof profileApi.navigateRuntimeTab>>
    >((resolve) => {
      resolveNavigation = resolve;
    });
    const navigateSpy = vi
      .spyOn(profileApi, "navigateRuntimeTab")
      .mockReturnValue(navigationPromise);
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockResolvedValue([]);
    render(<App />);

    const firstCard = await screen.findByRole("button", { name: "选择 主号" });
    const secondCard = await screen.findByRole("button", { name: "选择 抽奖号" });
    await user.click(firstCard);
    await user.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, dialog);
    await user.type(within(dialog).getByLabelText("导航 URL"), "https://old.example");
    await user.click(within(dialog).getByRole("button", { name: "导航标签页" }));
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(
        "~/MultiChromeProfiles",
        "account-001",
        "https://old.example"
      )
    );

    await user.click(firstCard);
    await user.click(secondCard);
    await waitFor(() => expect(within(dialog).getByText("抽奖号")).toBeTruthy());
    expect((within(dialog).getByLabelText("导航 URL") as HTMLInputElement).value).toBe("");

    resolveNavigation({
      profileId: "account-001",
      targetId: "old-page",
      url: "https://old.example",
      navigatedAt: 1000
    });
    await flushPromises();

    expect(within(dialog).getByText("抽奖号")).toBeTruthy();
    expect(
      within(dialog).queryByText("已导航第一个 page 标签页：https://old.example")
    ).toBeNull();
    expect(within(dialog).queryByText("https://old.example")).toBeNull();
    expect(listTabsSpy).not.toHaveBeenCalled();
    navigateSpy.mockRestore();
    listTabsSpy.mockRestore();
  });

  test("开发诊断会忽略关闭后返回的旧 Runtime 标签页请求", async () => {
    const user = userEvent.setup();
    let resolveTabs: (tabs: Awaited<ReturnType<typeof profileApi.listRuntimeTabs>>) => void =
      () => {};
    const tabsPromise = new Promise<Awaited<ReturnType<typeof profileApi.listRuntimeTabs>>>(
      (resolve) => {
        resolveTabs = resolve;
      }
    );
    const snapshotSpy = vi
      .spyOn(profileApi, "snapshotBrowserSessions")
      .mockResolvedValue([
        browserSessionSnapshot("account-001", true),
        browserSessionSnapshot("account-002", true)
      ]);
    const listTabsSpy = vi.spyOn(profileApi, "listRuntimeTabs").mockReturnValue(tabsPromise);
    render(<App />);

    const firstCard = await screen.findByRole("button", { name: "选择 主号" });
    const secondCard = await screen.findByRole("button", { name: "选择 抽奖号" });
    await user.click(firstCard);
    await user.click(screen.getByRole("button", { name: "设置" }));
    const firstDialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, firstDialog);
    await user.click(within(firstDialog).getByRole("button", { name: "读取标签页" }));
    await waitFor(() => expect(listTabsSpy).toHaveBeenCalledTimes(1));

    await user.click(within(firstDialog).getByRole("button", { name: "关闭设置" }));
    await user.click(firstCard);
    await user.click(secondCard);
    await user.click(screen.getByRole("button", { name: "设置" }));
    const secondDialog = await screen.findByRole("dialog", { name: "设置" });
    await expandDevDiagnostics(user, secondDialog);

    resolveTabs([
      {
        targetId: "aaaaaaaaaaaaaaaa",
        type: "page",
        url: "https://example.com/old-account",
        title: "旧账号标签页",
        webSocketDebuggerUrl: "ws://127.0.0.1:19222/devtools/page/aaaaaaaaaaaaaaaa",
        checkedAt: 1000
      }
    ]);
    await flushPromises();

    expect(within(secondDialog).getByText("抽奖号")).toBeTruthy();
    expect(within(secondDialog).queryByText("旧账号标签页")).toBeNull();
    expect(within(secondDialog).queryByText("https://example.com/old-account")).toBeNull();
    snapshotSpy.mockRestore();
    listTabsSpy.mockRestore();
  });
});

function savedDocument(): ProfileDocument & { projects: TestProject[] } {
  const raw = localStorage.getItem("multichrome.profileDocument");
  if (!raw) {
    throw new Error("profile document was not saved");
  }
  return JSON.parse(raw) as ProfileDocument & { projects: TestProject[] };
}

function documentWith(
  profiles: ChromeProfile[],
  projects: TestProject[] = []
): ProfileDocument & { projects: TestProject[] } {
  return {
    version: 1,
    settings: {
      browserPath: "/Applications/Google Chrome.app",
      favoriteUrls: [],
      recentUrls: [],
      urlLibrary: [],
      theme: "light"
    },
    profiles,
    projects
  };
}

function profile(overrides: Partial<ChromeProfile>): ChromeProfile {
  return {
    id: "account-001",
    name: "账号",
    tags: [],
    notes: "",
    status: "active",
    accountPlatforms: [],
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

function project(overrides: Partial<TestProject>): TestProject {
  const url = overrides.url ?? "https://example.com";
  return {
    id: "project-001",
    name: "项目",
    url,
    urls: [
      projectUrl({
        id: "url-001",
        name: "主入口",
        url
      })
    ],
    notes: "",
    profileIds: [],
    intervalSeconds: 3,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

function projectUrl(overrides: Partial<TestProjectUrl>): TestProjectUrl {
  return {
    id: "url-001",
    name: "网址",
    url: "https://example.com",
    notes: "",
    ...overrides
  };
}

function browserSessionSnapshot(
  profileId: string,
  running: boolean
): BrowserSessionSnapshot {
  return {
    profileId,
    status: running ? "running" : "stopped",
    running,
    pid: running ? 1201 : null,
    debugPort: running ? 19222 : null,
    cdpStatus: running ? "available" : "unknown",
    runtimeError: null,
    windowCount: running ? null : 0,
    windows: [],
    windowError: null,
    checkedAt: 1000
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function expandDevDiagnostics(
  user: { click: (element: Element) => Promise<unknown> },
  scope: HTMLElement
) {
  const summary = within(scope).getByText("开发诊断");
  const details = summary.closest("details") as HTMLDetailsElement | null;
  if (!details) {
    throw new Error("开发诊断不在 details 内");
  }
  if (!details.open) {
    await user.click(summary);
  }
}

async function openSettingsDialog(user: { click: (element: Element) => Promise<unknown> }) {
  await user.click(await screen.findByRole("button", { name: "设置" }));
  return screen.findByRole("dialog", { name: "设置" });
}

function changeRootPathDraft(dialog: HTMLElement, value: string) {
  fireEvent.change(within(dialog).getByLabelText("配置根目录"), { target: { value } });
}

async function detectRootPathDraft(
  user: { click: (element: Element) => Promise<unknown> },
  dialog: HTMLElement
) {
  const rootPathInput = within(dialog).getByLabelText("配置根目录");
  const rootPathRow = rootPathInput.parentElement;
  if (!rootPathRow) {
    throw new Error("配置根目录输入框不在行容器内");
  }
  await user.click(within(rootPathRow).getByRole("button", { name: "检测" }));
}

async function openBulkMore(user: { click: (element: Element) => Promise<unknown> }) {
  await user.click(screen.getByRole("button", { name: "更多操作" }));
}

function importCandidate(overrides: {
  path: string;
  folderName?: string;
  suggestedName?: string;
  suggestedTags?: string[];
  suggestedNotes?: string;
  duplicateProfileId?: string | null;
  duplicateProfileName?: string | null;
  duplicateReason?: string | null;
}) {
  const pathParts = overrides.path.split("/");
  const folderName = overrides.folderName ?? pathParts[pathParts.length - 1] ?? "profile";
  return {
    path: overrides.path,
    folderName,
    suggestedName: overrides.suggestedName ?? folderName,
    suggestedTags: overrides.suggestedTags ?? [],
    suggestedNotes: overrides.suggestedNotes ?? "",
    sizeBytes: 4096,
    confidence: "ready" as const,
    evidence: ["发现 Default/Preferences"],
    skippedReason: null,
    profileUid: null,
    duplicateProfileId: overrides.duplicateProfileId ?? null,
    duplicateProfileName: overrides.duplicateProfileName ?? null,
    duplicateReason: overrides.duplicateReason ?? null
  };
}

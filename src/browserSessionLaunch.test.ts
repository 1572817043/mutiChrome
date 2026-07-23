import { describe, expect, test } from "vitest";
import {
  appendBrowserLaunchEvents,
  browserLaunchEventFromResult,
  browserLaunchFailed,
  browserLaunchSucceeded,
  formatBulkLaunchQueueMessage,
  formatBrowserLaunchFailureDetails,
  formatProjectLaunchQueueMessage,
  normalizeBrowserLaunchEvents,
  selectRetryableBrowserLaunchProfileIds,
  summarizeBrowserLaunchQueue,
  summarizeBrowserLaunchResults,
  shouldMarkStartingAfterLaunch
} from "./browserSessionLaunch";

describe("browserSessionLaunch", () => {
  test("成功启动结果允许标记 starting", () => {
    const result = browserLaunchSucceeded(
      "account-001",
      "~/MultiChromeProfiles/profiles/account-001",
      1000
    );

    expect(result).toEqual({
      ok: true,
      profileId: "account-001",
      profilePath: "~/MultiChromeProfiles/profiles/account-001",
      finishedAt: 1000
    });
    expect(shouldMarkStartingAfterLaunch(result)).toBe(true);
  });

  test("失败启动结果不允许标记 starting", () => {
    const result = browserLaunchFailed(
      "account-001",
      new Error("Chrome not found"),
      1000
    );

    expect(result).toEqual({
      ok: false,
      profileId: "account-001",
      message: "Chrome not found",
      finishedAt: 1000
    });
    expect(shouldMarkStartingAfterLaunch(result)).toBe(false);
  });

  test("汇总启动结果时保留失败账号名称和原因", () => {
    const summary = summarizeBrowserLaunchResults(
      [
        browserLaunchSucceeded("account-001", "/tmp/account-001", 1000),
        browserLaunchFailed("account-002", new Error("Chrome 启动失败"), 1001)
      ],
      new Map([
        ["account-001", "主号"],
        ["account-002", "抽奖号"]
      ])
    );

    expect(summary).toEqual({
      totalCount: 2,
      successCount: 1,
      failureCount: 1,
      failures: [
        {
          profileId: "account-002",
          profileName: "抽奖号",
          message: "Chrome 启动失败"
        }
      ]
    });
    expect(formatBrowserLaunchFailureDetails(summary)).toBe(
      "1 个失败（抽奖号：Chrome 启动失败）"
    );
  });

  test("汇总启动结果时账号名称缺失会回退到 profileId 并限制展示数量", () => {
    const summary = summarizeBrowserLaunchResults(
      [
        browserLaunchFailed("account-001", new Error("失败 A"), 1000),
        browserLaunchFailed("account-002", new Error("失败 B"), 1001),
        browserLaunchFailed("account-003", new Error("失败 C"), 1002)
      ],
      new Map([["account-001", "主号"]])
    );

    expect(summary.successCount).toBe(0);
    expect(summary.failureCount).toBe(3);
    expect(summary.failures[1]).toEqual({
      profileId: "account-002",
      profileName: "account-002",
      message: "失败 B"
    });
    expect(formatBrowserLaunchFailureDetails(summary, 2)).toBe(
      "3 个失败（主号：失败 A；account-002：失败 B；另 1 个失败）"
    );
  });

  test("空启动结果会返回空摘要", () => {
    const summary = summarizeBrowserLaunchResults([], new Map());

    expect(summary).toEqual({
      totalCount: 0,
      successCount: 0,
      failureCount: 0,
      failures: []
    });
    expect(formatBrowserLaunchFailureDetails(summary)).toBe("");
  });

  test("队列启动摘要会保留排队数量和停止状态", () => {
    const summary = summarizeBrowserLaunchQueue(
      [browserLaunchSucceeded("account-001", "/tmp/account-001", 1000)],
      new Map([["account-001", "主号"]]),
      3,
      true
    );

    expect(summary).toEqual({
      totalCount: 1,
      queuedCount: 3,
      successCount: 1,
      failureCount: 0,
      stopped: true,
      failures: []
    });
  });

  test("批量启动队列会格式化成功、部分失败、全部失败和停止消息", () => {
    const profileNames = new Map([
      ["account-001", "主号"],
      ["account-002", "抽奖号"]
    ]);

    const success = summarizeBrowserLaunchQueue(
      [
        browserLaunchSucceeded("account-001", "/tmp/account-001", 1000),
        browserLaunchSucceeded("account-002", "/tmp/account-002", 1001)
      ],
      profileNames,
      2,
      false
    );
    const partialFailure = summarizeBrowserLaunchQueue(
      [
        browserLaunchSucceeded("account-001", "/tmp/account-001", 1000),
        browserLaunchFailed("account-002", new Error("Chrome 启动失败"), 1001)
      ],
      profileNames,
      2,
      false
    );
    const allFailure = summarizeBrowserLaunchQueue(
      [
        browserLaunchFailed("account-001", new Error("失败 A"), 1000),
        browserLaunchFailed("account-002", new Error("失败 B"), 1001)
      ],
      profileNames,
      2,
      false
    );
    const stopped = summarizeBrowserLaunchQueue(
      [browserLaunchSucceeded("account-001", "/tmp/account-001", 1000)],
      profileNames,
      2,
      true
    );

    expect(formatBulkLaunchQueueMessage(success)).toBe("已为 2 个账号打开网址");
    expect(formatBulkLaunchQueueMessage(partialFailure)).toBe(
      "已为 1 个账号打开网址，1 个失败（抽奖号：Chrome 启动失败）"
    );
    expect(formatBulkLaunchQueueMessage(allFailure)).toBe(
      "打开网址失败：2 个失败（主号：失败 A；抽奖号：失败 B）"
    );
    expect(formatBulkLaunchQueueMessage(stopped)).toBe(
      "已停止，已打开 1 / 2 个账号"
    );
  });

  test("项目启动队列会格式化项目名称和网址后缀", () => {
    const summary = summarizeBrowserLaunchQueue(
      [
        browserLaunchSucceeded("account-001", "/tmp/account-001", 1000),
        browserLaunchFailed("account-002", new Error("Chrome 启动失败"), 1001)
      ],
      new Map([
        ["account-001", "主号"],
        ["account-002", "抽奖号"]
      ]),
      2,
      false
    );

    expect(
      formatProjectLaunchQueueMessage(summary, "Galxe", "，2 个网址")
    ).toBe(
      "已打开项目 Galxe：1 个账号，2 个网址，1 个失败（抽奖号：Chrome 启动失败）"
    );
  });

  test("启动失败结果可以按原队列顺序生成重试账号", () => {
    const retryIds = selectRetryableBrowserLaunchProfileIds(
      [
        browserLaunchFailed("account-003", new Error("失败 C"), 1000),
        browserLaunchSucceeded("account-002", "/tmp/account-002", 1001),
        browserLaunchFailed("account-001", new Error("失败 A"), 1002)
      ],
      ["account-001", "account-002", "account-003", "account-004"]
    );

    expect(retryIds).toEqual(["account-001", "account-003"]);
  });

  test("同一账号后续成功后不会再进入重试账号", () => {
    const retryIds = selectRetryableBrowserLaunchProfileIds(
      [
        browserLaunchFailed("account-001", new Error("首次失败"), 1000),
        browserLaunchFailed("account-002", new Error("仍失败"), 1001),
        browserLaunchSucceeded("account-001", "/tmp/account-001", 1002)
      ],
      ["account-001", "account-002"]
    );

    expect(retryIds).toEqual(["account-002"]);
  });

  test("启动结果可以转为最近启动事件", () => {
    const successEvent = browserLaunchEventFromResult(
      browserLaunchSucceeded("account-001", "/tmp/account-001", 1000),
      {
        profileName: "主号",
        sourceLabel: "批量打开",
        url: "https://galxe.com"
      }
    );
    const failureEvent = browserLaunchEventFromResult(
      browserLaunchFailed("account-002", new Error("Chrome 启动失败"), 1001),
      {
        profileName: "抽奖号",
        sourceLabel: "批量打开",
        url: "https://galxe.com"
      }
    );

    expect(successEvent).toEqual({
      profileId: "account-001",
      profileName: "主号",
      sourceLabel: "批量打开",
      url: "https://galxe.com",
      ok: true,
      message: "已启动",
      finishedAt: 1000
    });
    expect(failureEvent).toEqual({
      profileId: "account-002",
      profileName: "抽奖号",
      sourceLabel: "批量打开",
      url: "https://galxe.com",
      ok: false,
      message: "Chrome 启动失败",
      finishedAt: 1001
    });
  });

  test("最近启动事件会把新事件放前面并限制数量", () => {
    const existingEvents = Array.from({ length: 29 }, (_, index) =>
      browserLaunchEventFromResult(
        browserLaunchSucceeded(
          `account-${String(index).padStart(3, "0")}`,
          `/tmp/${index}`,
          index
        ),
        {
          profileName: `账号 ${index}`,
          sourceLabel: "账号",
          url: "chrome://newtab/"
        }
      )
    );
    const incomingEvents = [
      browserLaunchEventFromResult(
        browserLaunchFailed("account-new-a", new Error("失败 A"), 100),
        {
          profileName: "新账号 A",
          sourceLabel: "项目 Galxe",
          url: "2 个网址"
        }
      ),
      browserLaunchEventFromResult(
        browserLaunchSucceeded("account-new-b", "/tmp/new-b", 101),
        {
          profileName: "新账号 B",
          sourceLabel: "项目 Galxe",
          url: "2 个网址"
        }
      )
    ];

    const events = appendBrowserLaunchEvents(existingEvents, incomingEvents);

    expect(events).toHaveLength(30);
    expect(events[0]).toMatchObject({
      profileId: "account-new-b",
      finishedAt: 101
    });
    expect(events[1]).toMatchObject({
      profileId: "account-new-a",
      finishedAt: 100
    });
    expect(events[events.length - 1]).toMatchObject({
      profileId: "account-001"
    });
  });

  test("持久化启动事件加载时会按时间排序并限制数量", () => {
    const storedEvents = Array.from({ length: 32 }, (_, index) => ({
      profileId: `account-${String(index).padStart(3, "0")}`,
      profileName: `账号 ${index}`,
      sourceLabel: "批量打开",
      url: "https://galxe.com",
      ok: true,
      message: "已启动",
      finishedAt: index
    }));

    const events = normalizeBrowserLaunchEvents(storedEvents);

    expect(events).toHaveLength(30);
    expect(events[0].finishedAt).toBe(31);
    expect(events[events.length - 1].finishedAt).toBe(2);
  });
});

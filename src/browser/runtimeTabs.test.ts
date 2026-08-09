import { describe, expect, it } from "vitest";
import type {
  BrowserRuntimeTabSnapshot,
  BrowserSessionSnapshot
} from "../api";
import type { ChromeProfile } from "../types";
import { buildRuntimeTabsPanelModel } from "./runtimeTabs";

const profile: ChromeProfile = {
  id: "profile-1",
  name: "工作账号",
  tags: [],
  notes: "",
  status: "active",
  accountPlatforms: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastOpenedAt: null
};

function createSession(
  overrides: Partial<BrowserSessionSnapshot> = {}
): BrowserSessionSnapshot {
  return {
    profileId: profile.id,
    status: "running",
    running: true,
    pid: 123,
    debugPort: 9222,
    cdpStatus: "available",
    runtimeError: null,
    windowCount: 0,
    windows: [],
    windowError: null,
    checkedAt: 1000,
    ...overrides
  };
}

function createTab(
  overrides: Partial<BrowserRuntimeTabSnapshot> = {}
): BrowserRuntimeTabSnapshot {
  return {
    targetId: "target-1",
    type: "page",
    url: "https://example.com",
    title: "Example",
    webSocketDebuggerUrl: null,
    checkedAt: 2000,
    ...overrides
  };
}

function createInput(
  overrides: Partial<Parameters<typeof buildRuntimeTabsPanelModel>[0]> = {}
) {
  return {
    selectedProfile: profile,
    selectedProfileCount: 1,
    session: createSession(),
    status: "succeeded" as const,
    tabs: [],
    error: null,
    ...overrides
  };
}

describe("buildRuntimeTabsPanelModel", () => {
  it("允许读取可用 session，并格式化标签页 fallback", () => {
    const model = buildRuntimeTabsPanelModel(
      createInput({
        tabs: [
          createTab({ title: "  ", url: "  " }),
          createTab({
            targetId: "target-2",
            title: "第二个标签页",
            url: "https://example.org",
            checkedAt: 3000
          })
        ]
      })
    );

    expect(model.canReadTabs).toBe(true);
    expect(model.profileName).toBe("工作账号");
    expect(model.debugPortLabel).toBe("9222");
    expect(model.rows).toEqual([
      {
        targetId: "target-1",
        title: "未命名标签页",
        url: "about:blank",
        checkedAt: 2000
      },
      {
        targetId: "target-2",
        title: "第二个标签页",
        url: "https://example.org",
        checkedAt: 3000
      }
    ]);
  });

  it("missing-port 时禁用并提示重新打开账号", () => {
    const model = buildRuntimeTabsPanelModel(
      createInput({
        session: createSession({ cdpStatus: "missing-port", debugPort: null })
      })
    );

    expect(model.canReadTabs).toBe(false);
    expect(model.disabledReason).toBe("重新打开账号以启用标签页读取");
    expect(model.cdpStatusLabel).toBe("缺少调试端口");
  });

  it("未选择账号或账号未运行时禁用", () => {
    expect(
      buildRuntimeTabsPanelModel(createInput({ selectedProfile: null, selectedProfileCount: 0 }))
    ).toMatchObject({
      canReadTabs: false,
      disabledReason: "请选择一个账号"
    });

    expect(
      buildRuntimeTabsPanelModel(
        createInput({
          session: null
        })
      )
    ).toMatchObject({
      canReadTabs: false,
      disabledReason: "账号未运行"
    });

    expect(
      buildRuntimeTabsPanelModel(
        createInput({
          session: createSession({ status: "stopped", running: false })
        })
      )
    ).toMatchObject({
      canReadTabs: false,
      disabledReason: "账号未运行"
    });
  });

  it("loading 时禁止重复读取但不输出错误", () => {
    const model = buildRuntimeTabsPanelModel(
      createInput({ status: "loading", error: "不应显示" })
    );

    expect(model.canReadTabs).toBe(false);
    expect(model.disabledReason).toBeNull();
    expect(model.errorMessage).toBeNull();
  });

  it("failed 状态输出读取错误文案", () => {
    expect(
      buildRuntimeTabsPanelModel(createInput({ status: "failed", error: "CDP 连接超时" }))
    ).toMatchObject({
      canReadTabs: true,
      errorMessage: "CDP 连接超时"
    });

    expect(
      buildRuntimeTabsPanelModel(createInput({ status: "failed", error: null }))
    ).toMatchObject({
      errorMessage: "读取标签页失败"
    });
  });

  it("succeeded 且没有 tabs 时输出空态", () => {
    const model = buildRuntimeTabsPanelModel(createInput());

    expect(model.emptyMessage).toBe("未发现可读取的标签页");
    expect(model.errorMessage).toBeNull();
  });
});

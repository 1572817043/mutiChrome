import type {
  BrowserRuntimeTabSnapshot,
  BrowserSessionCdpStatus,
  BrowserSessionSnapshot
} from "../api";
import type { ChromeProfile } from "../types";

export interface RuntimeTabsPanelInput {
  selectedProfile: ChromeProfile | null;
  selectedProfileCount: number;
  session: BrowserSessionSnapshot | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  tabs: BrowserRuntimeTabSnapshot[];
  error: string | null;
}

export interface RuntimeTabsPanelRow {
  targetId: string;
  title: string;
  rawTitle?: string;
  url: string;
  checkedAt: number;
}

export interface RuntimeTabsPanelModel {
  profileName: string | null;
  canReadTabs: boolean;
  disabledReason: string | null;
  cdpStatusLabel: string;
  debugPortLabel: string;
  rows: RuntimeTabsPanelRow[];
  emptyMessage: string | null;
  errorMessage: string | null;
}

const cdpStatusLabels: Record<BrowserSessionCdpStatus, string> = {
  unknown: "未知",
  available: "可用",
  "missing-port": "缺少调试端口",
  failed: "不可用"
};

function formatTab(tab: BrowserRuntimeTabSnapshot): RuntimeTabsPanelRow {
  return {
    targetId: tab.targetId,
    title: tab.title.trim() || "未命名标签页",
    rawTitle: tab.title,
    url: tab.url.trim() || "about:blank",
    checkedAt: tab.checkedAt
  };
}

export function buildRuntimeTabsPanelModel(
  input: RuntimeTabsPanelInput
): RuntimeTabsPanelModel {
  const session = input.session;
  const profileSelected = input.selectedProfile !== null && input.selectedProfileCount === 1;
  const isRunning = session !== null && session.status !== "stopped" && session.running;
  const cdpStatus = session?.cdpStatus ?? "unknown";

  let disabledReason: string | null = null;
  if (!profileSelected) {
    disabledReason = "请选择一个账号";
  } else if (!isRunning) {
    disabledReason = "账号未运行";
  } else if (cdpStatus === "missing-port") {
    disabledReason = "重新打开账号以启用标签页读取";
  } else if (cdpStatus === "failed") {
    disabledReason = session.runtimeError ?? "Browser Runtime 不可用";
  } else if (cdpStatus !== "available") {
    disabledReason = "Browser Runtime 不可用";
  } else if (input.status === "loading") {
    disabledReason = null;
  }

  const rows = input.tabs.map(formatTab);
  const canReadTabs =
    profileSelected &&
    isRunning &&
    cdpStatus === "available" &&
    input.status !== "loading";

  return {
    profileName: input.selectedProfile?.name ?? null,
    canReadTabs,
    disabledReason,
    cdpStatusLabel: cdpStatusLabels[cdpStatus],
    debugPortLabel: session?.debugPort === null || session?.debugPort === undefined
      ? "未发现"
      : String(session.debugPort),
    rows,
    emptyMessage:
      input.status === "succeeded" && rows.length === 0
        ? "未发现可读取的标签页"
        : null,
    errorMessage:
      input.status === "failed" ? input.error ?? "读取标签页失败" : null
  };
}

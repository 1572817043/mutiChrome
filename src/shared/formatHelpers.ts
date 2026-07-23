import type { ChromeWindowInfo } from "../api";

export const DEFAULT_BULK_OPEN_INTERVAL_SECONDS = "3";

export function normalizeBulkOpenIntervalSeconds(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return Number.parseInt(DEFAULT_BULK_OPEN_INTERVAL_SECONDS, 10);
  }

  return Math.min(60, Math.max(1, parsed));
}

export function formatWindowInspectionSummary(
  profileName: string,
  windows: ChromeWindowInfo[]
): string {
  const firstWindow = windows[0];
  const minimizedText = firstWindow?.minimized ? "，已最小化" : "";
  const firstWindowDetail = firstWindow
    ? `（${firstWindow.width}x${firstWindow.height} @ ${firstWindow.x},${firstWindow.y}${minimizedText}）`
    : "";

  return `${profileName} ${windows.length} 个窗口${firstWindowDetail}`;
}
